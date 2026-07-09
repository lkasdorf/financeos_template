"""HTTP Basic-Auth middleware + admin CLI for the FinanceOS server.

Block F of the OSS-template roadmap. The persistence layer ships with
Block C: ``setup_core.write_auth`` produces ``config/auth.json`` in
one of two shapes::

    {"mode": "none"}
    {"mode": "basic", "user": "admin", "password_bcrypt": "$2b$12$..."}

This module adds the runtime guard. :func:`check_request` is called
at the top of every request handler in :mod:`serve`. It returns
``True`` when the request may proceed (no auth configured, exempt
path, or valid credentials) and ``False`` after sending a ``401``
challenge so the handler can return early.

Default behaviour:
    * No ``config/auth.json`` ........ middleware no-ops
    * ``mode == "none"`` ............. middleware no-ops
    * ``mode == "basic"`` ............ HTTP Basic Auth enforced
    * ``mode == "locked"`` ........... derived, never written to disk:
      the file exists but is corrupt/unknown — fail-closed, every
      non-exempt request gets 401 (BE-M2)

Exempt paths (always reachable):
    * ``/api/health`` — monitoring / Pi cron pings

Exempt paths (only while ``data/.setup_state.json`` reports the repo
as not yet initialized — chicken-and-egg for first-time setup):
    * ``/dashboard/setup.html``, ``/dashboard/setup.js``,
      ``/dashboard/setup.css``
    * ``/api/setup/status``, ``/api/setup/mmex-upload``,
      ``/api/setup/finalize``

Admin CLI::

    python scripts/auth.py --set-password           # interactive
    python scripts/auth.py --set-password --user X  # non-interactive user
    python scripts/auth.py --disable                # switch to mode=none
    python scripts/auth.py --status                 # show current mode
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hmac
import json
import os
import sys
import tempfile
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

# Repo root = two levels above this file (``scripts/auth.py`` → repo root).
_REPO_ROOT = Path(__file__).resolve().parent.parent
_AUTH_PATH = _REPO_ROOT / "config" / "auth.json"
_SETUP_STATE_PATH = _REPO_ROOT / "data" / ".setup_state.json"

# Paths that are reachable even when authentication is enabled.
_ALWAYS_EXEMPT: frozenset[str] = frozenset({
    "/api/health",
})

# Paths reachable only while the repo is still in the "fresh install"
# state. Once setup is finalized, these require auth like everything else.
_PRE_INIT_EXEMPT: frozenset[str] = frozenset({
    "/dashboard/setup.html",
    "/dashboard/setup.js",
    "/dashboard/setup.css",
    "/api/setup/status",
    "/api/setup/mmex-upload",
    "/api/setup/finalize",
})

# Realm string sent in the WWW-Authenticate challenge header.
_REALM = "FinanceOS"


# ── Config loaders ────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def load_auth_config() -> dict[str, Any]:
    """Read ``config/auth.json`` once and cache it.

    A MISSING file is ``mode=none`` — the private repo keeps running
    with auth disabled by default. BE-M2: a file that EXISTS but is
    corrupt/unreadable (or carries an unknown mode) used to fall back
    to ``mode=none`` as well, silently disabling auth — e.g. after a
    crash mid ``--set-password`` truncated the file. It now degrades to
    ``mode=locked`` instead, which refuses every non-exempt request
    with 401 until the file is fixed, rewritten via
    ``auth.py --set-password``, or deleted. Restart the server after
    editing the file (``lru_cache`` keeps the value).
    """
    try:
        with _AUTH_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and data.get("mode") in ("none", "basic"):
            return data
        reason = (
            f"unknown mode {data.get('mode')!r}" if isinstance(data, dict)
            else "top-level value is not a JSON object"
        )
    except FileNotFoundError:
        return {"mode": "none"}
    except (json.JSONDecodeError, OSError) as exc:
        reason = f"{type(exc).__name__}: {exc}"
    print(
        f"[auth.error] {_AUTH_PATH} exists but is unusable ({reason}) — "
        f"failing CLOSED: every non-exempt request gets 401 until the "
        f"file is fixed or deleted. Rewrite it with "
        f"'python scripts/auth.py --set-password' (or --disable).",
        file=sys.stderr,
    )
    return {"mode": "locked"}


def reload_auth_config() -> dict[str, Any]:
    """Drop the cached config and re-read it (for the admin CLI)."""
    load_auth_config.cache_clear()
    return load_auth_config()


def is_auth_required() -> bool:
    """``True`` when requests must be gated.

    Covers ``mode=basic`` (credentials verified) and ``mode=locked``
    (BE-M2 fail-closed: corrupt config — verify_credentials never
    succeeds, so every non-exempt request is refused with 401).
    """
    cfg = load_auth_config()
    return cfg.get("mode") in ("basic", "locked")


def is_initialized() -> bool:
    """Decide whether the repo has been through the setup wizard.

    Multi-signal check (C-01 from CODE_REVIEW_2026-05-12): the old
    implementation looked only at ``data/.setup_state.json`` and
    returned False on any read/parse error. That made it trivial for
    a stale or corrupt marker file to silently re-open the setup
    wizard — which is auth-exempt and can overwrite
    ``config/auth.json`` + accounts.csv + categories.csv on
    POST /api/setup/finalize. An attacker on the LAN/Tailscale subnet
    who could delete the marker (or just catch the moment after a
    botched deploy) had a no-auth path to wipe the box.

    Fail-closed contract:
        - Marker says ``{"initialized": true}`` → accept (happy path).
        - Marker missing/corrupt BUT we observe artefacts that only
          exist after a successful setup (``config/auth.json`` or a
          populated ``data/accounts.csv``) → treat as initialized.
          Better to refuse the wizard once unnecessarily than to let
          an attacker re-run it on a configured box.
        - Only return False when every signal points to "fresh install".
    """
    # Primary signal: the explicit marker file.
    try:
        if _SETUP_STATE_PATH.exists():
            state = json.loads(_SETUP_STATE_PATH.read_text(encoding="utf-8"))
            if state.get("initialized") is True:
                return True
    except (OSError, json.JSONDecodeError):
        # Marker unreadable — don't return early. Fall through to the
        # corroborating signals so a corrupt marker can't re-open the
        # wizard on a fully-configured install.
        pass

    # Corroborating signal #1: auth.json exists. The wizard writes this
    # at the end of /api/setup/finalize; its presence means a wizard run
    # completed at some point even if the marker was later lost.
    auth_config_path = _REPO_ROOT / "config" / "auth.json"
    if auth_config_path.exists():
        return True

    # Corroborating signal #2: accounts.csv has data rows beyond the
    # header. A fresh install ships with header-only; a configured one
    # has at least the seeded accounts.
    accounts_csv = _REPO_ROOT / "data" / "accounts.csv"
    try:
        if accounts_csv.exists():
            with accounts_csv.open("r", encoding="utf-8") as fh:
                line_count = sum(1 for _ in fh)
            if line_count > 1:  # header + at least one row
                return True
    except OSError:
        pass

    return False


# ── Path classification ───────────────────────────────────────────────────

def is_exempt(path: str) -> bool:
    """``True`` if ``path`` should bypass the auth middleware.

    Strips the query string before matching so ``/api/health?ping=1``
    still hits the always-exempt set.
    """
    bare = path.split("?", 1)[0]
    if bare in _ALWAYS_EXEMPT:
        return True
    if not is_initialized() and bare in _PRE_INIT_EXEMPT:
        return True
    return False


# ── Credential verification ───────────────────────────────────────────────

def _decode_basic(header_value: str) -> tuple[str, str] | None:
    """Decode a ``Authorization: Basic <b64>`` header into ``(user, pass)``.

    Returns ``None`` for any malformed input — caller treats that as a
    failed authentication.
    """
    if not header_value or not header_value.lower().startswith("basic "):
        return None
    try:
        raw = base64.b64decode(header_value[6:].strip(), validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None
    if ":" not in raw:
        return None
    user, _, password = raw.partition(":")
    return user, password


def verify_credentials(user: str, password: str) -> bool:
    """Constant-time-ish bcrypt verify against ``config/auth.json``."""
    cfg = load_auth_config()
    if cfg.get("mode") != "basic":
        return False
    expected_user = cfg.get("user", "")
    expected = cfg.get("password_bcrypt", "")
    if not expected_user or not expected:
        return False
    # hmac.compare_digest avoids leaking the username via timing — the
    # password check below is already constant-time via bcrypt.
    if not hmac.compare_digest(user.encode("utf-8"), expected_user.encode("utf-8")):
        return False
    try:
        import bcrypt
    except ImportError:
        # Mode=basic was configured but bcrypt isn't available — treat
        # as mis-configured and refuse access rather than silently
        # letting requests through.
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), expected.encode("ascii"))
    except (ValueError, TypeError) as exc:
        # M-S6 (Sprint 16) — surface corrupt-hash / malformed-input on
        # stderr instead of silently returning False. Previously the two
        # cases were indistinguishable from a wrong password, so an
        # admin staring at a stuck 401 loop had no signal whether the
        # auth.json hash was the problem. The user-facing response is
        # unchanged (fail-closed) — this is purely a diagnostic improvement.
        import sys as _sys
        print(
            f"[auth.warn] bcrypt.checkpw raised {type(exc).__name__}: {exc} "
            f"(corrupt hash in config/auth.json, or malformed password input)",
            file=_sys.stderr,
        )
        return False


# ── Brute-force throttle ──────────────────────────────────────────────────
# In-memory per-IP failure counter. Each consecutive failure on the same
# IP delays the 401 response by 0.5 s × n_fails (capped at 5 s), giving a
# bcrypt-rate of ~0.2 attempts/s after a handful of misses without ever
# hard-locking a real user out (Tailscale subnet sharing means we cannot
# trust 1 IP == 1 person). State drops on server restart and after
# _FAILURE_TTL of inactivity. Thread-safe via _failure_lock since serve.py
# uses ThreadingHTTPServer.
_failure_state: dict[str, dict[str, float]] = {}
_failure_lock = threading.Lock()
_FAILURE_TTL = 3600.0
_FAILURE_DELAY_STEP = 0.5
_FAILURE_DELAY_MAX = 5.0


def _record_failure(ip: str) -> float:
    """Increment failure count for ``ip`` and return the delay to apply."""
    now = time.monotonic()
    with _failure_lock:
        # Lazy GC of stale entries so a long-running server doesn't grow
        # the dict unbounded under scan traffic.
        for key in list(_failure_state):
            if now - _failure_state[key]["last"] > _FAILURE_TTL:
                _failure_state.pop(key, None)
                _ip_locks.pop(key, None)
        entry = _failure_state.setdefault(ip, {"fails": 0.0, "last": now})
        entry["fails"] += 1
        entry["last"] = now
        return min(entry["fails"] * _FAILURE_DELAY_STEP, _FAILURE_DELAY_MAX)


def _record_success(ip: str) -> None:
    """Reset failure count for ``ip`` after a successful authentication."""
    with _failure_lock:
        _failure_state.pop(ip, None)
        _ip_locks.pop(ip, None)


# M-S5 (Sprint 16) — per-IP serialization lock. Without this, ThreadingHTTPServer
# lets N concurrent attempts from the same IP each call verify_credentials,
# get their increment-and-sleep delay, and then sleep IN PARALLEL — so the
# effective rate-limit collapses to bcrypt cost (~100 ms with rounds=12)
# instead of the documented 0.5 s × n_fails. With this lock, all auth
# attempts from the same IP queue, the sleep actually slows the sequence,
# and N parallel attackers see the per-IP rate-limit they were supposed to.
# Locks are cleaned up alongside _failure_state in _record_failure's GC.
_ip_locks: dict[str, threading.Lock] = {}


def _acquire_ip_lock(ip: str) -> threading.Lock:
    """Return (creating if needed) the per-IP serialization lock."""
    with _failure_lock:
        lock = _ip_locks.get(ip)
        if lock is None:
            lock = threading.Lock()
            _ip_locks[ip] = lock
        return lock


# ── Middleware ────────────────────────────────────────────────────────────

def check_request(handler) -> bool:
    """Gate a single HTTP request.

    Returns ``True`` when the handler may proceed. Returns ``False``
    after sending a ``401`` response (so the caller must ``return``).
    """
    if not is_auth_required():
        return True
    if is_exempt(handler.path):
        return True

    client_ip = "unknown"
    addr = getattr(handler, "client_address", None)
    if addr:
        client_ip = addr[0] or "unknown"

    auth_header = handler.headers.get("Authorization", "")
    # M-S5 (Sprint 16) — hold the per-IP lock across the verify + sleep
    # so concurrent attempts from one source serialize. Without this the
    # documented "0.5 s × n_fails" throttle collapses to bcrypt cost for
    # any attacker willing to fire requests in parallel from one IP.
    ip_lock = _acquire_ip_lock(client_ip)
    with ip_lock:
        creds = _decode_basic(auth_header)
        if creds is not None and verify_credentials(*creds):
            _record_success(client_ip)
            return True

        delay = _record_failure(client_ip)
        if delay > 0:
            time.sleep(delay)
        _send_challenge(handler)
        return False


def _send_challenge(handler) -> None:
    """Reply with ``401 Unauthorized`` + ``WWW-Authenticate`` header."""
    body = b'{"error":"authentication required"}'
    handler.send_response(401)
    handler.send_header("WWW-Authenticate", f'Basic realm="{_REALM}"')
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


# ── Admin CLI ─────────────────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    """Bcrypt-hash a password (mirrors ``setup_core._hash_password``)."""
    try:
        import bcrypt
    except ImportError:
        sys.exit("bcrypt is required for basic auth. Install with: pip install bcrypt")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def _write_config(payload: dict[str, Any]) -> None:
    """Atomically write ``config/auth.json`` (temp + fsync + replace).

    BE-M2: the previous ``Path.write_text`` could leave a truncated
    file behind on a crash mid-write; combined with the old fail-open
    loader that meant the next server start ran without auth. Same
    pattern as config_loader.save_reports_config.
    """
    _AUTH_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_name = tempfile.mkstemp(
        dir=str(_AUTH_PATH.parent),
        prefix=f".{_AUTH_PATH.name}.",
        suffix=".tmp",
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8", newline="") as f:
            json.dump(payload, f, indent=2, sort_keys=True)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, _AUTH_PATH)
    except Exception:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise
    reload_auth_config()


def _cli_set_password(user: str | None) -> None:
    """Interactive: ask for username + password, write basic-auth config."""
    cfg = load_auth_config()
    default_user = user or cfg.get("user") or "admin"
    chosen_user = input(f"Username [{default_user}]: ").strip() or default_user

    while True:
        p1 = getpass.getpass("Password (min 8 chars): ")
        if len(p1) < 8:
            print("  Password must be at least 8 characters.")
            continue
        p2 = getpass.getpass("Repeat: ")
        if p1 != p2:
            print("  Passwords do not match.")
            continue
        break

    _write_config({
        "mode": "basic",
        "user": chosen_user,
        "password_bcrypt": _hash_password(p1),
    })
    print(f"✓ Basic auth enabled for user '{chosen_user}'.")
    print(f"  Wrote {_AUTH_PATH.relative_to(_REPO_ROOT)}.")
    print("  Restart the server (scripts/serve.py) to pick up the new config.")


def _cli_disable() -> None:
    """Switch to ``mode=none`` (still leaves the file in place)."""
    _write_config({"mode": "none"})
    print("✓ Authentication disabled (mode=none).")
    print(f"  Wrote {_AUTH_PATH.relative_to(_REPO_ROOT)}.")
    print("  Restart the server (scripts/serve.py) to pick up the new config.")


def _cli_status() -> None:
    """Print the active mode without leaking the password hash."""
    cfg = load_auth_config()
    mode = cfg.get("mode", "none")
    if mode == "basic":
        print(f"mode: basic\nuser: {cfg.get('user', '?')}\nfile: {_AUTH_PATH}")
    elif mode == "locked":
        print(
            f"mode: locked (config/auth.json exists but is corrupt or "
            f"carries an unknown mode — every request is refused)\n"
            f"file: {_AUTH_PATH}\n"
            f"fix:  python scripts/auth.py --set-password  (or --disable)"
        )
    else:
        print(f"mode: {mode}\nfile: {_AUTH_PATH}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="auth.py",
        description="FinanceOS authentication admin (Block F).",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--set-password",
        action="store_true",
        help="Enable basic auth: prompt for username + password and write config/auth.json.",
    )
    group.add_argument(
        "--disable",
        action="store_true",
        help="Switch auth.json to mode=none (no authentication).",
    )
    group.add_argument(
        "--status",
        action="store_true",
        help="Print the current auth mode without leaking the hash.",
    )
    parser.add_argument(
        "--user",
        help="Username default for --set-password (skips the prompt's existing value).",
    )
    args = parser.parse_args(argv)

    if args.set_password:
        _cli_set_password(args.user)
    elif args.disable:
        _cli_disable()
    elif args.status:
        _cli_status()
    return 0


if __name__ == "__main__":
    sys.exit(main())
