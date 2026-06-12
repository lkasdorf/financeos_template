"""Host-role fencing for the primary/standby host pair (O-H3, CODE_REVIEW_2026-06-12).

Problem closed here: after an outage-failover (primary unreachable, standby
promoted), the old primary boots straight back into its primary crontab and
systemd service — scheduled TX fire on BOTH hosts and concurrent CSV
commits produce a permanent rebase-conflict loop on the losing host.

Mechanism (two layers):

1. ``~/.fos-role`` — a host-local marker file containing ``primary`` or
   ``standby``. Written by the failover/failback scripts (locally and via
   SSH on the peer when reachable). Read by every cron entry point and by
   serve.py's write gate. A missing file means ``primary`` so dev machines
   and template forks are never fenced.

2. ``config/active_primary.json`` — a git-TRACKED statement of which host
   type ("vps" / "pi") is currently primary. The failover scripts commit
   and push it, so it propagates through the existing git sync. A
   recovering ex-primary cannot receive an SSH pacify while it is down,
   but its very first ``cron_commit`` tick fetches origin — and
   :func:`demote_if_peer_primary` compares the fetched statement against
   the host's own type and persists ``standby`` into ``~/.fos-role``.
   Demote-only by design: promotion back to primary is always an explicit
   failover/failback-script action, never automatic.

Host identity comes from the ``FINANCEOS_HOST_TYPE`` env var (set in the
systemd units and crontab templates) with a hostname fallback against
``host.pi_hostnames`` / ``host.vps_hostnames`` in config/defaults.json.
Hosts with no resolvable type (dev PCs, fresh forks) are never fenced.
"""

from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ROLE_FILE = Path.home() / ".fos-role"
ACTIVE_PRIMARY_REL = "config/active_primary.json"

# Suppress the per-subprocess console flash on Windows (same pattern as
# cron_commit). No-op on POSIX.
_NO_WINDOW_KWARGS: dict = {"creationflags": 0x08000000} if sys.platform == "win32" else {}


def my_host_type() -> str:
    """Return this host's failover identity: 'vps', 'pi', or '' (unknown).

    Order: FINANCEOS_HOST_TYPE env var (systemd units / crontab templates),
    then hostname match against host.*_hostnames in config/defaults.json.
    Unknown hosts ('') are exempt from all fencing.
    """
    env = os.environ.get("FINANCEOS_HOST_TYPE", "").strip().lower()
    if env:
        return env
    try:
        from config_loader import get_default
        node = platform.node().strip().lower()
        if not node:
            return ""
        for host_type, key in (("pi", "host.pi_hostnames"), ("vps", "host.vps_hostnames")):
            names = get_default(key, []) or []
            for name in names:
                name = str(name).strip().lower()
                # startswith covers FQDN-expanded hostnames (myhost.example.com).
                if name and (node == name or node.startswith(name + ".")):
                    return host_type
    except Exception:
        pass
    return ""


def get_role() -> str:
    """Return 'primary' or 'standby'. Missing/invalid marker → 'primary'."""
    env = os.environ.get("FOS_ROLE", "").strip().lower()
    if env in ("primary", "standby"):
        return env
    try:
        val = ROLE_FILE.read_text(encoding="utf-8").strip().lower()
        if val in ("primary", "standby"):
            return val
    except OSError:
        pass
    return "primary"


def is_standby() -> bool:
    return get_role() == "standby"


def set_role(role: str) -> None:
    """Persist the host-local role marker (used by self-pacify and tests)."""
    if role not in ("primary", "standby"):
        raise ValueError(f"invalid role: {role!r}")
    ROLE_FILE.write_text(role + "\n", encoding="utf-8")


def active_primary_on_origin(timeout: int = 15) -> str | None:
    """Read the host_type from origin/main:config/active_primary.json.

    Uses the local ref state — callers that need freshness must ``git
    fetch`` first (cron_commit already does). Returns None when the file
    or ref is unavailable (pre-rollout repos, detached clones, errors).
    """
    try:
        res = subprocess.run(
            ["git", "show", f"origin/main:{ACTIVE_PRIMARY_REL}"],
            capture_output=True, text=True, cwd=REPO_ROOT,
            timeout=timeout, **_NO_WINDOW_KWARGS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0:
        return None
    try:
        host_type = (json.loads(res.stdout).get("host_type") or "").strip().lower()
        return host_type or None
    except (json.JSONDecodeError, AttributeError):
        return None


def fetch_origin(timeout: int = 20) -> bool:
    """Best-effort `git fetch origin main` so active_primary_on_origin()
    reflects current remote truth. Returns False on any failure — callers
    treat that as 'no fresh information', never as a fence."""
    try:
        res = subprocess.run(
            ["git", "fetch", "origin", "main"],
            capture_output=True, text=True, cwd=REPO_ROOT,
            timeout=timeout, **_NO_WINDOW_KWARGS,
        )
        return res.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def demote_if_peer_primary(log_prefix: str = "host_role") -> bool:
    """Self-pacify: persist 'standby' when origin says another host leads.

    Returns True when this host is (now) fenced — callers should bail out
    of any write work. Returns False for unknown host types, unreadable
    origin state, or when this host IS the active primary.
    """
    me = my_host_type()
    if not me:
        return False
    active = active_primary_on_origin()
    if active is None or active == me:
        return False
    if not is_standby():
        try:
            set_role("standby")
            print(
                f"[{log_prefix}] origin/main says active primary is "
                f"'{active}' but this host is '{me}' — self-pacified to "
                f"standby (O-H3 fencing). Run failback to promote.",
                file=sys.stderr,
            )
        except OSError as exc:
            print(f"[{log_prefix}] could not persist standby role: {exc}",
                  file=sys.stderr)
    return True
