"""Built-in scheduler for FinanceOS — replaces host-cron wiring on
Docker / Synology / Unraid / Windows hosts where setting up a system
cron is awkward.

Architecture:
    serve.py main() calls scheduler.start_scheduler() right after the
    HTTP server is bound. If `apscheduler` is installed AND the schedule
    is enabled (via auto-detect or explicit config), a daemon-thread
    BackgroundScheduler launches the four FinanceOS cron jobs as
    subprocesses — same scripts that the host-cron would have called,
    so behavior stays identical.

Auto-detect logic:
    * Docker: enabled when `/.dockerenv` exists (the canonical
      "we're inside a container" marker).
    * Env var: enabled when `FINANCEOS_BUILTIN_SCHEDULER=on`.
    * Bare Pi / Linux: disabled — the host cron is authoritative there
      and we don't want two schedulers fighting over the same jobs.

Override:
    `config/scheduler.json` accepts `{enabled: "auto"|true|false, jobs: {<name>: {hour, minute, enabled}}}`.
    `enabled: true` forces it on regardless of auto-detect.

Job set (mirrors host crontab on the Pi as of 2026-05-10):
    cron_fx        daily 06:00 — FX snapshot
    cron_metals    daily 08:00 — gold/silver spot price
    cron_sched     daily 09:00 — notify on due scheduled TX
    cron_integrity daily 02:00 — schema/balance integrity check

`cron_commit` is NOT included on purpose — `tx_engine.git_commit()`
already spawns it as a detached background subprocess after every data
mutation (v2026-04-29.1), and a clock-driven tick would double-publish.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
CONFIG_PATH = REPO_ROOT / "config" / "scheduler.json"

# Default schedule — pinned to the same wall-clock times as the historical
# host crontab so behavior matches a Pi switching to docker doesn't shift.
DEFAULT_JOBS = {
    "cron_fx":        {"hour": 6, "minute": 0, "enabled": True},
    "cron_metals":    {"hour": 8, "minute": 0, "enabled": True},
    "cron_sched":     {"hour": 9, "minute": 0, "enabled": True},
    "cron_integrity": {"hour": 2, "minute": 0, "enabled": True},
}


def _auto_detect() -> bool:
    """Decide whether to start the built-in scheduler when config says 'auto'.

    Inside containers there is no host cron, so we own scheduling. On bare
    metal we step aside in favor of the host crontab.
    """
    if os.path.exists("/.dockerenv"):
        return True
    if os.environ.get("FINANCEOS_BUILTIN_SCHEDULER", "").lower() in ("1", "on", "true", "yes"):
        return True
    return False


def _load_config() -> dict:
    """Read `config/scheduler.json` if it exists, else fall back to defaults."""
    if not CONFIG_PATH.exists():
        return {"enabled": "auto", "jobs": dict(DEFAULT_JOBS)}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"enabled": "auto", "jobs": dict(DEFAULT_JOBS)}
    if not isinstance(raw, dict):
        return {"enabled": "auto", "jobs": dict(DEFAULT_JOBS)}
    enabled = raw.get("enabled", "auto")
    jobs = dict(DEFAULT_JOBS)
    user_jobs = raw.get("jobs") if isinstance(raw.get("jobs"), dict) else {}
    for name, spec in user_jobs.items():
        if name in jobs and isinstance(spec, dict):
            jobs[name].update({k: spec[k] for k in ("hour", "minute", "enabled") if k in spec})
    return {"enabled": enabled, "jobs": jobs}


def _resolve_enabled(cfg: dict) -> bool:
    """Translate the config `enabled` value (auto/bool) into an effective bool."""
    val = cfg.get("enabled", "auto")
    if isinstance(val, bool):
        return val
    if isinstance(val, str) and val.lower() == "auto":
        return _auto_detect()
    return False


def _run_cron(script_name: str) -> None:
    """Spawn one cron-job subprocess and log its outcome.

    Failures are intentionally swallowed — the existing host-cron approach
    behaves the same way (cron mails the operator, the next tick retries).
    APScheduler would otherwise surface a job exception to its own logger,
    which is fine, but stdout/stderr from the subprocess would be lost
    without an explicit pipe.
    """
    script = SCRIPTS_DIR / f"{script_name}.py"
    if not script.exists():
        print(f"[scheduler] {script_name}: script not found, skipping", file=sys.stderr)
        return
    print(f"[scheduler] running {script_name}", flush=True)
    try:
        result = subprocess.run(
            [sys.executable, str(script)],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            print(
                f"[scheduler] {script_name} exited {result.returncode}\n"
                f"  stdout: {result.stdout.strip()[:500]}\n"
                f"  stderr: {result.stderr.strip()[:500]}",
                file=sys.stderr, flush=True,
            )
        else:
            print(f"[scheduler] {script_name}: ok", flush=True)
    except subprocess.TimeoutExpired:
        print(f"[scheduler] {script_name}: timed out after 10 min", file=sys.stderr, flush=True)
    except Exception as exc:
        print(f"[scheduler] {script_name}: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)


_scheduler_singleton = None
_scheduler_lock = threading.Lock()


def start_scheduler() -> object | None:
    """Boot the built-in scheduler if enabled.

    Idempotent — calling twice from the same process is a no-op (returns
    the existing scheduler instance). Returns the BackgroundScheduler
    instance on success, or None if disabled / apscheduler missing.
    """
    global _scheduler_singleton
    with _scheduler_lock:
        if _scheduler_singleton is not None:
            return _scheduler_singleton

        cfg = _load_config()
        if not _resolve_enabled(cfg):
            return None

        try:
            from apscheduler.schedulers.background import BackgroundScheduler
            from apscheduler.triggers.cron import CronTrigger
        except ImportError:
            print(
                "[scheduler] apscheduler not installed — host cron will own job scheduling.\n"
                "            Install with: pip install apscheduler",
                file=sys.stderr,
            )
            return None

        sched = BackgroundScheduler(daemon=True, timezone="UTC")
        added = []
        for name, spec in cfg["jobs"].items():
            if not spec.get("enabled", True):
                continue
            hour = int(spec.get("hour", 0))
            minute = int(spec.get("minute", 0))
            sched.add_job(
                _run_cron,
                trigger=CronTrigger(hour=hour, minute=minute),
                args=[name],
                id=name,
                replace_existing=True,
                misfire_grace_time=3600,
            )
            added.append(f"{name}@{hour:02d}:{minute:02d}")

        if not added:
            print("[scheduler] no jobs enabled — nothing to start.", file=sys.stderr)
            return None

        sched.start()
        _scheduler_singleton = sched
        print(
            f"[scheduler] built-in scheduler running (UTC) — jobs: {', '.join(added)}",
            flush=True,
        )
        return sched
