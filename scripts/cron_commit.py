#!/usr/bin/env python3
"""Bidirectional git sync for FinanceOS, run every 5 minutes from cron.

This is the single sync entry point on every host (PC and Pi). Each run
serializes against tx_engine writes via a shared lockfile and then:

1. Fetches origin/main (always — picks up remote data + code updates).
2. Rebases local commits onto FETCH_HEAD if anything new came in.
3. Commits any pending data/ changes as a batch commit.
4. Pushes if local is ahead of origin (best-effort, retries next run).
5. Restarts the financeos service when the pulled commits touched any
   non-data file (sudo entry for `systemctl restart financeos` required
   on the Pi; on the PC there is no such service so this is a no-op
   when the sudo call fails). Override the unit name via the
   FINANCEOS_SERVICE_NAME env var when forking under a different name.

Replaces the earlier two-cron split (this script + a bash one-liner that
ran `git fetch + pull + systemctl restart`). Both ran on the same `*/5`
schedule and raced on `.git/FETCH_HEAD`, which produced repeated
`rebase failed: invalid upstream 'FETCH_HEAD'` errors and silent data
loss via the destructive `reset --hard ORIG_HEAD` recovery fallback —
ORIG_HEAD is sticky from earlier git operations and could point to a
commit before the cron's own batch commit, so the reset would wipe the
just-written transactions. Both recovery paths now refuse to fall back
on `reset --hard ORIG_HEAD`; stuck states are surfaced in the log and
left for manual operator recovery.
"""
from __future__ import annotations

import os
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCK_PATH = REPO_ROOT / "data" / ".transactions.lock"

# systemd unit name to restart when a code/config commit was pulled.
# Override via FINANCEOS_SERVICE_NAME for forks that ship under a different
# unit name; default keeps the upstream Pi deployment working unchanged.
SERVICE_NAME = os.environ.get("FINANCEOS_SERVICE_NAME", "financeos")


# Cross-platform exclusive file lock matching tx_engine.tx_write_lock().
# Holding this for the duration of cron_commit's run prevents tx_engine writes
# from interleaving with our git operations — closing the race window where
# a fresh CSV append could be wiped by a later rebase abort or hard reset.
if sys.platform == "win32":
    import msvcrt

    def _lock_fh(fh) -> None:
        msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)

    def _unlock_fh(fh) -> None:
        try:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
else:
    import fcntl

    def _lock_fh(fh) -> None:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)

    def _unlock_fh(fh) -> None:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass


@contextmanager
def tx_write_lock():
    """Hold an exclusive cross-process lock on the transactions lockfile.

    Mirrors tx_engine.tx_write_lock() so cron_commit and tx_engine writes
    serialize on the same lock. Cron blocks while a TX write is in flight,
    and TX writes block while cron is mid-rebase — eliminating the window
    where a destructive git op (rebase abort, hard reset) can wipe an
    uncommitted CSV append.
    """
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK_PATH, "a") as fh:
        _lock_fh(fh)
        try:
            yield
        finally:
            _unlock_fh(fh)


def run(cmd: list[str], check: bool = False, timeout: int = 30):
    """Run a command in the repo root, return CompletedProcess."""
    return subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=check,
        timeout=timeout,
    )


def _data_has_uncommitted_changes() -> bool:
    """True if data/ has any modified, staged, or untracked changes."""
    result = run(["git", "status", "--porcelain", "data/"])
    return bool(result.stdout.strip())


def has_pending_changes() -> bool:
    """Check if there are uncommitted changes under data/."""
    result = run(["git", "status", "--porcelain", "data/"])
    return bool(result.stdout.strip())


def recover_stuck_rebase() -> bool:
    """Detect and clean up a stale rebase state from a previous failed run.

    If `.git/rebase-merge` or `.git/rebase-apply` exists on entry, a prior
    invocation died mid-rebase and `--abort` never completed.

    Both `git rebase --abort` and `git reset --hard ORIG_HEAD` reset the
    working tree, which would wipe any uncommitted data/ changes (e.g. a
    fresh tx_engine append that landed between the prior crash and this
    run). To avoid silent data loss we refuse to run either op while data/
    is dirty — the next cron run retries, and the operator can resolve
    manually if the situation persists. Returns True if cleanup succeeded
    or was not needed, False if recovery was refused or failed.
    """
    git_dir = REPO_ROOT / ".git"
    if not ((git_dir / "rebase-merge").exists() or (git_dir / "rebase-apply").exists()):
        return True
    print("[cron_commit] detected stale rebase state, attempting recovery", file=sys.stderr)
    if _data_has_uncommitted_changes():
        print(
            "[cron_commit] REFUSING recovery: stale rebase + uncommitted data/ changes detected. "
            "Either rebase conflict markers or unsaved transactions are in the working tree, "
            "and rebase --abort / reset --hard would wipe them. "
            "Manual intervention required: SSH to the host, inspect `git status` under data/, "
            "preserve any real TX rows, then run `git rebase --abort`.",
            file=sys.stderr,
        )
        return False
    abort = run(["git", "rebase", "--abort"])
    if abort.returncode == 0:
        return True
    # Do NOT fall back to `reset --hard ORIG_HEAD` here. ORIG_HEAD is sticky
    # from earlier operations and may point to a commit older than the
    # current HEAD, so a hard reset would silently destroy any local commits
    # that landed between then and now (e.g. a cron-created commit from the
    # crashed run that left this stuck state). Surface the failure and bail;
    # an operator can resolve manually.
    print(
        f"[cron_commit] abort failed: {abort.stderr.strip()}; "
        "leaving stuck rebase state for manual recovery (refusing reset --hard ORIG_HEAD to protect local commits)",
        file=sys.stderr,
    )
    return False


def abort_rebase_safely() -> None:
    """Abort a stuck rebase. No-op when no rebase state exists.

    Called after our own `git rebase` returned non-zero. Two failure modes:

    1. Rebase started, conflict mid-way → `.git/rebase-merge` or `rebase-apply`
       exists. Run `git rebase --abort` to unwind.
    2. Rebase failed before starting (e.g. invalid upstream from a concurrent
       fetch race) → no rebase state was created, working tree untouched.
       Nothing to abort.

    The previous version blindly fell back to `git reset --hard ORIG_HEAD`
    if `--abort` failed. ORIG_HEAD is sticky from earlier git operations and
    is NOT updated when rebase fails before reaching its setup phase, so the
    fallback would reset HEAD to a pre-this-run commit and silently destroy
    the local commit cron_commit just made. We never want that — leave the
    state for next run's recovery and surface the failure in the log.
    """
    git_dir = REPO_ROOT / ".git"
    rebase_in_progress = (
        (git_dir / "rebase-merge").exists()
        or (git_dir / "rebase-apply").exists()
    )
    if not rebase_in_progress:
        # Rebase failed before starting; no destructive cleanup needed.
        return
    abort = run(["git", "rebase", "--abort"])
    if abort.returncode == 0:
        return
    # Genuine stuck state. Do NOT fall back to `reset --hard ORIG_HEAD` —
    # it can wipe local commits when ORIG_HEAD is stale. Leave the state
    # intact for manual operator recovery.
    print(
        f"[cron_commit] rebase --abort failed: {abort.stderr.strip()}; "
        "leaving stuck rebase state for manual recovery (refusing reset --hard ORIG_HEAD to protect local commits)",
        file=sys.stderr,
    )


def summarize_changes() -> str:
    """Build a short commit-message summary from git status output."""
    result = run(["git", "status", "--porcelain", "data/"])
    files = [line[3:] for line in result.stdout.strip().split("\n") if line.strip()]
    count = len(files)
    # Group by filename stem for a concise list
    stems = sorted({Path(f).stem for f in files})
    head = f"{count} file{'s' if count != 1 else ''}"
    return f"{head} ({', '.join(stems[:5])}{'...' if len(stems) > 5 else ''})"


def _rev_parse(ref: str) -> str:
    """Resolve a git ref to its commit SHA. Returns empty string on failure."""
    result = run(["git", "rev-parse", ref])
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def main() -> int:
    """One consolidated sync run: pull remote, commit local data, push, optionally restart.

    Replaces the prior split of `cron_commit.py` (data push only, fast-exit when
    no local changes) plus a separate cron-line one-liner (`git fetch + pull +
    systemctl restart`). Both ran on the same `*/5` schedule and raced on
    FETCH_HEAD, which is what produced the long history of
    `rebase failed: invalid upstream 'FETCH_HEAD'` log entries and silent
    transaction loss via the destructive ORIG_HEAD fallback.

    Steps, all under the cross-process tx_write_lock so user TX writes cannot
    interleave with any git operation:

    1. recover_stuck_rebase() — bail if a previous crash left rebase state behind
       and data/ is dirty (refuses to wipe user data).
    2. fetch origin/main — always, even with no local changes, so PC→Pi data
       and code updates land on the Pi.
    3. rebase FETCH_HEAD — integrate any remote commits. No-op when local is
       already up-to-date or ahead.
    4. commit local data/ changes — Pi→PC sync direction.
    5. push if ahead — best-effort; failure is logged but next run retries.
    6. restart financeos if non-data files were pulled — picks up code/config
       updates without a separate auto-deploy script.
    """
    with tx_write_lock():
        if not recover_stuck_rebase():
            print("[cron_commit] cannot recover from stale rebase state, bailing", file=sys.stderr)
            return 1

        try:
            # ── Step 1: fetch remote (always) ────────────────────────────
            fetch_result = run(["git", "fetch", "origin", "main"], timeout=15)
            if fetch_result.returncode != 0:
                print(f"[cron_commit] fetch failed: {fetch_result.stderr.strip()}", file=sys.stderr)
                return 1

            head_before = _rev_parse("HEAD")
            fetch_head = _rev_parse("FETCH_HEAD")
            if not head_before or not fetch_head:
                print(
                    f"[cron_commit] could not resolve HEAD ({head_before!r}) or "
                    f"FETCH_HEAD ({fetch_head!r}); bailing",
                    file=sys.stderr,
                )
                return 1

            # ── Step 2: rebase to integrate remote (skip when no-op) ─────
            if head_before != fetch_head:
                rebase_result = run(["git", "rebase", "FETCH_HEAD"], timeout=15)
                if rebase_result.returncode != 0:
                    print(f"[cron_commit] rebase failed: {rebase_result.stderr.strip()}", file=sys.stderr)
                    abort_rebase_safely()
                    return 1

            head_after_pull = _rev_parse("HEAD")
            pulled_changes = head_after_pull != head_before

            # ── Step 3: commit local data/ changes (if any) ──────────────
            if has_pending_changes():
                summary = summarize_changes()
                ts = datetime.now().strftime("%Y-%m-%d %H:%M")
                message = f"batch: {summary} [{ts}]"
                add_result = run(["git", "add", "data/"])
                if add_result.returncode != 0:
                    print(f"[cron_commit] add failed: {add_result.stderr.strip()}", file=sys.stderr)
                    return 1
                commit_result = run(["git", "commit", "-m", message])
                if commit_result.returncode == 0:
                    print(f"[cron_commit] {message}")
                else:
                    # Race: another process staged/committed already, or no
                    # actual diff after staging. Not fatal.
                    print(f"[cron_commit] commit skipped: {commit_result.stderr.strip()}", file=sys.stderr)

            # ── Step 4: push if we are ahead of origin ───────────────────
            head_now = _rev_parse("HEAD")
            if head_now and head_now != fetch_head:
                push_result = run(["git", "push", "origin", "main"], timeout=15)
                if push_result.returncode != 0:
                    # Best-effort. Next run retries. Don't bail — we still
                    # want to honour any code-pull restart below.
                    print(f"[cron_commit] push failed: {push_result.stderr.strip()}", file=sys.stderr)

            # ── Step 5: restart service if non-data files were pulled ────
            if pulled_changes:
                diff_result = run(["git", "diff", "--name-only", head_before, head_after_pull])
                files = [f.strip() for f in diff_result.stdout.split("\n") if f.strip()]
                code_changed = any(not f.startswith("data/") for f in files)
                if code_changed:
                    print(
                        f"[cron_commit] code update pulled, restarting {SERVICE_NAME} service",
                        file=sys.stderr,
                    )
                    restart_result = run(
                        ["sudo", "-n", "systemctl", "restart", SERVICE_NAME],
                        timeout=30,
                    )
                    if restart_result.returncode != 0:
                        print(
                            f"[cron_commit] service restart failed: {restart_result.stderr.strip()} "
                            f"(check sudoers entry for systemctl restart {SERVICE_NAME})",
                            file=sys.stderr,
                        )

            return 0
        except subprocess.TimeoutExpired as e:
            print(f"[cron_commit] timeout: {e}", file=sys.stderr)
            return 1
        except Exception as e:
            print(f"[cron_commit] error: {e}", file=sys.stderr)
            return 1


if __name__ == "__main__":
    sys.exit(main())
