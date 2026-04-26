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

import shutil
import sys
from datetime import datetime
from pathlib import Path

# Local config loader (sibling module). Path append keeps direct script execution working.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from config_loader import get_default  # noqa: E402

# ── Path Constants ──────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
BACKUP_DIR = DATA_DIR / "backups"
MAX_BACKUPS_PER_FILE = get_default("backup.max_per_file", 30)  # Oldest backups beyond this limit are auto-deleted

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
    backup_path = BACKUP_DIR / f"{stem}_{timestamp}.csv"
    # copy2 preserves metadata (timestamps, permissions)
    shutil.copy2(source, backup_path)

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

    # Sort newest-first so slicing beyond the limit gives the oldest files
    backups = sorted(
        BACKUP_DIR.glob(f"{stem}_*.csv"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old in backups[MAX_BACKUPS_PER_FILE:]:
        old.unlink()
        print(f"[prune] Geloescht: {old.name}")


def list_backups() -> None:
    """Display all existing backups grouped by data file.

    Shows the 10 most recent backups per target with file sizes.
    Used by the --list CLI flag for quick overview.
    """
    if not BACKUP_DIR.exists():
        print("Keine Backups vorhanden.")
        return

    for stem in BACKUP_TARGETS:
        backups = sorted(BACKUP_DIR.glob(f"{stem}_*.csv"), reverse=True)
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
