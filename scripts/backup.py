"""Automatic backup for FinanceOS CSV data files.

This script is a mandatory pre-write safety net: it MUST be called before
any modification to data/*.csv files (transactions, scheduled, etc.).
It creates timestamped copies in data/backups/ and auto-prunes old backups
to keep at most MAX_BACKUPS_PER_FILE (30) copies per data file.

Usage:
    python scripts/backup.py                # Backup ALL registered CSV files
    python scripts/backup.py transactions   # Backup only transactions.csv
    python scripts/backup.py scheduled      # Backup only scheduled.csv
    python scripts/backup.py --list         # List existing backups (most recent first)

Backup targets are registered in the BACKUP_TARGETS dict. Adding a new CSV
to the system only requires adding one entry there.

Called by:
    - serve.py (before /api/tx/confirm writes)
    - cron_sched.py (before executing due scheduled TXs)
    - Claude Code CLI (before any TX write via CLAUDE.md rules)
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Local config loader (sibling module). Path append keeps direct script execution working.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from config_loader import get_default  # noqa: E402

# ── Path Constants ──────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
BACKUP_DIR = DATA_DIR / "backups"
MAX_BACKUPS_PER_FILE = get_default("backup.max_per_file", 30)  # Oldest backups beyond this limit are auto-deleted
# O-L4 (CODE_REVIEW_2026-06-12): a count-only ring is a time bomb on a busy
# day — 30 copies written within an hour push out every snapshot from the
# days before, which are exactly the ones worth restoring after a mistake
# that went unnoticed overnight. On top of the count, the newest copy of
# each of the last N days survives.
DAILY_FLOOR_DAYS = get_default("backup.daily_floor_days", 7)

# ── Backup Targets ──────────────────────────────────────────────────────────
# Maps a short stem name to the source CSV path. The stem is used both
# as the CLI argument and as the filename prefix for backup files
# (e.g., "transactions_20260412_153000.csv").

BACKUP_TARGETS = {
    "transactions": DATA_DIR / "transactions.csv",
    "third_party": DATA_DIR / "third_party.csv",
    "prompt_log": DATA_DIR / "prompt_log.csv",
    "scheduled": DATA_DIR / "scheduled.csv",
    "custom_reports": DATA_DIR / "custom_reports.json",
    "categories": DATA_DIR / "categories.csv",
    "accounts": DATA_DIR / "accounts.csv",
    "fuel_log": DATA_DIR / "fuel_log.csv",
    "vehicles": DATA_DIR / "vehicles.csv",
    "fuel_recon_dismissed": DATA_DIR / "fuel_recon_dismissed.csv",
    "recon_dismissed": DATA_DIR / "recon_dismissed.csv",
    "receipt_scan_log": DATA_DIR / "receipt_scan_log.csv",
    "alert_acks": DATA_DIR / "alert_acks.csv",
    "properties": DATA_DIR / "properties.csv",
    "luku_log": DATA_DIR / "luku_log.csv",
    "water_log": DATA_DIR / "water_log.csv",
    "cash_count_log": DATA_DIR / "cash_count_log.csv",
    "subscriptions": DATA_DIR / "subscriptions.csv",
    "subscription_log": DATA_DIR / "subscription_log.csv",
    "debt_payments": DATA_DIR / "debt_payments.csv",
    "fx_rates": DATA_DIR / "fx_rates.csv",
    "fx_rates_history": DATA_DIR / "fx_rates_history.csv",
    "metal_price_history": DATA_DIR / "metal_price_history.csv",
    "metal_spot_fallback": DATA_DIR / "metal_spot_fallback.csv",
    # B-M6 (CODE_REVIEW_2026-06-12) — the Settings domain files. They are
    # rewritten wholesale by the save_* helpers in tx_engine and were
    # never registered here, so nothing in the ring could restore them.
    "payees": DATA_DIR / "payees.json",
    "budgets": DATA_DIR / "budgets.json",
    "savings_goals": DATA_DIR / "savings_goals.json",
    "tags": DATA_DIR / "tags.csv",
    "quick_expenses": DATA_DIR / "quick_expenses.csv",
    "atm_fees": DATA_DIR / "atm_fees.csv",
}


def human_size(num_bytes: int) -> str:
    """Convert byte count to human-readable string (e.g. '12.3 KB', '1.1 MB').

    Args:
        num_bytes: File size in bytes.

    Returns:
        Formatted size string with appropriate unit.
    """
    for unit in ("B", "KB", "MB", "GB"):
        if num_bytes < 1024:
            return f"{num_bytes:.1f} {unit}" if unit != "B" else f"{num_bytes} B"
        num_bytes /= 1024
    return f"{num_bytes:.1f} TB"


def backup_file(stem: str, source: Path) -> Path | None:
    """Create a timestamped backup copy of a data CSV file.

    The backup filename includes second-precision timestamps to avoid
    collisions even when multiple writes happen in quick succession.

    Args:
        stem: Short name key (e.g. "transactions") used as filename prefix.
        source: Path to the source CSV file to back up.

    Returns:
        Path to the newly created backup file, or None if source doesn't exist.
    """
    if not source.exists():
        print(f"[skip] {source.name} existiert nicht")
        return None

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    # Keep the source's own suffix: a payees.json copy named
    # payees_<ts>.csv is JSON wearing a CSV name, and restoring it by
    # hand goes wrong. Defaults to .csv for suffix-less sources.
    suffix = source.suffix or ".csv"
    backup_path = BACKUP_DIR / f"{stem}_{timestamp}{suffix}"
    # B-L3 (CODE_REVIEW_2026-06-12): the timestamp is second-precision, and
    # a split booking writes several times inside one second — the later
    # copy silently replaced the earlier one, which is the copy you would
    # have wanted. Disambiguate with a counter the prune regex knows.
    if backup_path.exists():
        n = 2
        while True:
            candidate = BACKUP_DIR / f"{stem}_{timestamp}-{n}{suffix}"
            if not candidate.exists():
                backup_path = candidate
                break
            n += 1
    # copy2 preserves metadata (timestamps, permissions)
    shutil.copy2(source, backup_path)
    # B-L3: ...including the source's mtime, which is what prune sorts on.
    # A settings file untouched for months produced a "new" backup that
    # looked older than everything else and got pruned first. The copy is
    # stamped with when it was taken.
    os.utime(backup_path, None)

    size = human_size(backup_path.stat().st_size)
    print(f"[ok]   Backup erstellt: {backup_path.name} ({size})")

    # Remove old backups beyond the retention limit
    prune_old_backups(stem)
    return backup_path


def prune_old_backups(stem: str) -> None:
    """Delete old backups so only the most recent MAX_BACKUPS_PER_FILE remain.

    Backups are sorted by modification time (newest first); anything
    beyond the retention limit is permanently removed.

    Args:
        stem: Backup filename prefix to filter on (e.g. "transactions").
    """
    if not BACKUP_DIR.exists():
        return

    # Sort newest-first so slicing beyond the limit gives the oldest files.
    # L-PD2 (Sprint 23) — the glob `{stem}_*.csv` overmatches when one
    # stem is a prefix of another (e.g. `fuel_log_*` swallowed
    # `fuel_log_recon_dismissed_*`). The timestamp-anchored regex below
    # accepts only the actual backup suffix shape `YYYYMMDD_HHMMSS.<ext>`,
    # so prefix-sharing stems stay isolated. The extension is open —
    # JSON settings files keep their own suffix in the ring.
    suffix_re = re.compile(
        rf"^{re.escape(stem)}_(\d{{8}})_\d{{6}}(?:-\d+)?\.[A-Za-z0-9]+$")
    matched = [(p, m.group(1)) for p, m in
               ((p, suffix_re.match(p.name)) for p in BACKUP_DIR.glob(f"{stem}_*"))
               if m]
    backups = sorted(matched, key=lambda pair: pair[0].stat().st_mtime, reverse=True)

    keep = {p for p, _ in backups[:MAX_BACKUPS_PER_FILE]}
    # O-L4: plus the newest copy of each of the last DAILY_FLOOR_DAYS days.
    # The day comes from the filename, not the mtime — a restored or copied
    # backup keeps its own name and should still count for its own day.
    cutoff = (datetime.now() - timedelta(days=DAILY_FLOOR_DAYS)).strftime("%Y%m%d")
    seen_days: set[str] = set()
    for path, day in backups:
        if day < cutoff or day in seen_days:
            continue
        seen_days.add(day)
        keep.add(path)

    for path, _ in backups:
        if path in keep:
            continue
        path.unlink()
        print(f"[prune] Geloescht: {path.name}")


def list_backups() -> None:
    """Display all existing backups grouped by data file.

    Shows the 10 most recent backups per target with file sizes.
    Used by the --list CLI flag for quick overview.
    """
    if not BACKUP_DIR.exists():
        print("Keine Backups vorhanden.")
        return

    # L-PD2 (Sprint 23) — same prefix-collision guard as prune_old_backups
    # above. Without the timestamp-anchor regex, `fuel_log` would list
    # the backups of `fuel_log_recon_dismissed` too.
    import re as _re_local
    for stem in BACKUP_TARGETS:
        # Extension open, same as prune_old_backups — JSON settings
        # backups must be listed, not silently hidden.
        suffix_re = _re_local.compile(
            rf"^{_re_local.escape(stem)}_\d{{8}}_\d{{6}}\.[A-Za-z0-9]+$")
        backups = sorted(
            (p for p in BACKUP_DIR.glob(f"{stem}_*") if suffix_re.match(p.name)),
            reverse=True,
        )
        print(f"\n{stem} ({len(backups)}):")
        for b in backups[:10]:
            size = human_size(b.stat().st_size)
            print(f"  {b.name:45} {size}")
        if len(backups) > 10:
            print(f"  ... {len(backups) - 10} weitere")


def backup_all() -> list[Path]:
    """Backup all registered CSV files. Returns list of created backup paths.

    Skips files that don't exist (e.g. prompt_log.csv on a fresh install).
    """
    return [p for stem, src in BACKUP_TARGETS.items() if (p := backup_file(stem, src))]


def main(argv: list[str]) -> int:
    """CLI entry point. Parses argv to decide what to back up.

    Returns:
        0 on success, 1 on error (unknown target or missing source file).
    """
    # --list: show existing backups without creating new ones
    if len(argv) > 1 and argv[1] == "--list":
        list_backups()
        return 0

    # Single target mode: back up only the specified file
    if len(argv) > 1:
        stem = argv[1]
        if stem not in BACKUP_TARGETS:
            print(f"Unbekanntes Ziel: {stem}. Verfuegbar: {list(BACKUP_TARGETS)}")
            return 1
        result = backup_file(stem, BACKUP_TARGETS[stem])
        return 0 if result else 1

    # No arguments: back up everything
    backup_all()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
