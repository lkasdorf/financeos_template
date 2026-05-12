#!/usr/bin/env python3
"""v1.5.1 migration: add `subscription_id` column to data/scheduled.csv.

Idempotent — running twice is a no-op. Detects whether the column already
exists by inspecting the live header; if missing, loads all rows via the
old header and rewrites the file with the new SCHEDULED_FIELDS header
(empty `subscription_id` for every legacy row).

Backs up scheduled.csv before the rewrite and uses the same atomic-write
helper as the rest of the engine, so a crash during migration cannot
truncate the file.

Run once locally and once on the Pi after `git pull`.

Usage:
    python scripts/migrate_v151_sched_subscription.py
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

# Allow running from repo root or scripts/
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import tx_engine  # noqa: E402  — sys.path tweak above is intentional
from backup import backup_file, BACKUP_TARGETS  # noqa: E402


NEW_COLUMN = "subscription_id"


def current_header(path: Path) -> list[str]:
    """Return the live CSV header, or an empty list if the file is missing."""
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        try:
            return next(reader)
        except StopIteration:
            return []


def main() -> int:
    sched_path = tx_engine.DATA_DIR / "scheduled.csv"
    header = current_header(sched_path)

    if not header:
        print(f"[migrate-v151] {sched_path} missing or empty — nothing to migrate.")
        return 0

    if NEW_COLUMN in header:
        print(f"[migrate-v151] '{NEW_COLUMN}' already in header — already migrated.")
        return 0

    # Sanity-check: the new SCHEDULED_FIELDS must include the new column,
    # otherwise this migration is being run against an inconsistent codebase
    # and would silently drop the column on the next save.
    if NEW_COLUMN not in tx_engine.SCHEDULED_FIELDS:
        print(
            f"[migrate-v151] FATAL: tx_engine.SCHEDULED_FIELDS does not contain "
            f"'{NEW_COLUMN}'. Pull the v1.5.1 code first.",
            file=sys.stderr,
        )
        return 2

    # Backup before rewrite — Backup-Pflicht per CLAUDE.md.
    backup_path = backup_file("scheduled", BACKUP_TARGETS["scheduled"])
    if not backup_path:
        print("[migrate-v151] FATAL: backup failed, aborting.", file=sys.stderr)
        return 2

    rows = tx_engine.load_scheduled()
    # Existing rows lack the key entirely — DictWriter writes '' for missing
    # keys (restval default), so this is safe. We touch every row explicitly
    # to keep the intent obvious for future readers.
    for row in rows:
        row.setdefault(NEW_COLUMN, "")

    tx_engine.save_scheduled(rows)

    print(
        f"[migrate-v151] OK — added '{NEW_COLUMN}' column to {sched_path} "
        f"({len(rows)} row{'s' if len(rows) != 1 else ''} preserved, backup at "
        f"{backup_path})."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
