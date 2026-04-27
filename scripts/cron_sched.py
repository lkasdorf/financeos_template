#!/usr/bin/env python3
"""Cron job: Execute due scheduled (recurring) transactions.

This script runs daily via cron on the Raspberry Pi. It checks
data/scheduled.csv for entries where active=true AND next_run <= today,
writes them as real transactions to transactions.csv, generates
pass-through counter-entries where applicable, and rolls each entry's
next_run date forward to the next occurrence.

Typical cron entry (Pi):
    0 6 * * * cd /srv/financeos && python scripts/cron_sched.py >> logs/cron_sched.log 2>&1

Safety features:
    - Backs up both transactions.csv and scheduled.csv before writing
    - Validates all generated lines before appending
    - Single atomic git commit for all changes
    - --dry flag for preview without side effects

Usage:
    python scripts/cron_sched.py          # Execute all due scheduled TXs
    python scripts/cron_sched.py --dry    # Preview only, no writes
"""

from __future__ import annotations

import calendar
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Ensure sibling modules (tx_engine, backup) are importable
sys.path.insert(0, str(Path(__file__).parent))

import tx_engine
from backup import backup_file, BACKUP_TARGETS

# ── Frequency Parsing ───────────────────────────────────────────────────────

# Maps weekday names/abbreviations to Python's weekday numbers (0=Monday)
WEEKDAY_MAP = {
    "mon": 0, "monday": 0,
    "tue": 1, "tuesday": 1,
    "wed": 2, "wednesday": 2,
    "thu": 3, "thursday": 3,
    "fri": 4, "friday": 4,
    "sat": 5, "saturday": 5,
    "sun": 6, "sunday": 6,
}


def calculate_next_run(frequency: str, from_date: date) -> date:
    """Calculate the next run date based on frequency string.

    Supported formats:
      monthly:<day>   — day 1-31 or 'last' for last day of month
      weekly:<weekday> — mon/tue/wed/thu/fri/sat/sun
    """
    if frequency.startswith("weekly:"):
        day_name = frequency.split(":", 1)[1].strip().lower()
        target_weekday = WEEKDAY_MAP.get(day_name)
        if target_weekday is None:
            raise ValueError(f"Unknown weekday: {day_name}")
        days_ahead = (target_weekday - from_date.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7  # Always advance to NEXT week, never fire same day again
        return from_date + timedelta(days=days_ahead)

    if not frequency.startswith("monthly:"):
        raise ValueError(f"Unsupported frequency: {frequency}")

    day_spec = frequency.split(":", 1)[1].strip()

    # Advance to next month (handle December -> January year rollover)
    if from_date.month == 12:
        next_month = 1
        next_year = from_date.year + 1
    else:
        next_month = from_date.month + 1
        next_year = from_date.year

    last_day = calendar.monthrange(next_year, next_month)[1]

    if day_spec == "last":
        # "last" = always the last day of the month (28/29/30/31)
        return date(next_year, next_month, last_day)
    else:
        day = int(day_spec)
        # Cap to actual month length (e.g. day=31 in February -> day=28)
        day = min(day, last_day)
        return date(next_year, next_month, day)


def main() -> int:
    """Main entry point: find due scheduled entries and execute them.

    Returns:
        0 on success (including 'nothing due'), 2 on unhandled exception
        (caught by the wrapper in __main__).
    """
    dry_run = "--dry" in sys.argv
    now = datetime.now()
    today = date.today()
    ts = now.strftime("%Y-%m-%d %H:%M:%S")

    print(f"[{ts}] cron_sched: checking for due scheduled transactions...")

    # ── Load reference data ─────────────────────────────────────────────
    scheduled = tx_engine.load_scheduled()
    accounts = tx_engine.load_accounts()
    categories = tx_engine.load_categories()
    existing_ids = tx_engine.load_existing_import_ids()

    # ── Filter for due entries (active=true AND next_run <= today) ───────
    due = []
    for entry in scheduled:
        if entry.get("active", "").lower() != "true":
            continue
        next_run = entry.get("next_run", "").strip()
        if not next_run:
            continue
        try:
            run_date = date.fromisoformat(next_run)
        except ValueError:
            print(f"  [warn] Invalid next_run date for {entry['sched_id']}: {next_run}")
            continue
        if run_date <= today:
            due.append(entry)

    if not due:
        print(f"  No scheduled transactions due today ({today.isoformat()}).")
        return 0

    print(f"  Found {len(due)} due entry/entries.")

    if dry_run:
        print("  [DRY RUN] Would execute:")
        for entry in due:
            print(f"    {entry['sched_id']}: {entry['name']} — {entry['amount']} {entry['currency']} to {entry['payee']}")
        return 0

    # ── Backup before writing (mandatory) ──────────────────────────────
    backup_file("transactions", BACKUP_TARGETS["transactions"])
    backup_file("scheduled", BACKUP_TARGETS["scheduled"])

    # ── Build transaction lines from due entries ────────────────────────
    all_tx_lines = []
    summaries = []

    for entry in due:
        # Build the primary expense line from the scheduled template
        account_alias = entry.get("account", "")
        amount_str = entry.get("amount", "0")
        currency = entry.get("currency", "")
        payee = entry.get("payee", "")
        category = entry.get("category", "")
        note = entry.get("note", "")

        # Fall back to account's default currency if not explicitly set
        if not currency and account_alias in accounts:
            currency = accounts[account_alias]["currency"]

        # Merge explicit tags from the scheduled template with auto-tags
        manual_tags = [t.strip() for t in entry.get("manual_tags", "").split(";") if t.strip()]
        all_tags = tx_engine.apply_auto_tags(account_alias, payee, manual_tags)

        # Derive TX type from the category's declared type. Scheduled templates
        # are most commonly expenses (bills, subscriptions), but income
        # templates like monthly salary also need to book as income — the
        # category_type drives the direction.
        cat_info = categories.get(category, {})
        tx_type = cat_info.get("type", "expense")
        if tx_type not in ("income", "expense"):
            tx_type = "expense"

        line = {
            "date": today.isoformat(),
            "account": account_alias,
            "type": tx_type,
            "amount": amount_str,
            "currency": currency,
            "payee": payee,
            "category": category,
            "note": note,
            "raw_note": "",
            "transfer_to_account": "",
            "transfer_to_amount": "",
            "receipt_group": "",
            "receipt_url": "",
            "tags": ";".join(all_tags),
            "third_party_id": "",
        }

        line["import_id"] = tx_engine.generate_import_id(
            line["date"], line["account"], float(line["amount"]),
            line["payee"], line["category"], line["note"], existing_ids,
        )
        existing_ids.add(line["import_id"])
        all_tx_lines.append(line)

        # Generate automatic income counter-entry for pass-through accounts.
        # Only applies to expense templates — income on a pass-through is an
        # unusual setup and would otherwise double-count as income.
        acc_info = accounts.get(account_alias, {})
        if acc_info.get("pass_through_payee") and tx_type == "expense":
            pt_line = tx_engine.generate_pass_through_line(line, acc_info, existing_ids)
            if pt_line:
                existing_ids.add(pt_line["import_id"])
                # Remove is_auto_generated flag (internal only, not a CSV column)
                pt_line.pop("is_auto_generated", None)
                all_tx_lines.append(pt_line)

        summaries.append(f"{entry['name']} ({payee})")

        # Roll the scheduled entry forward to its next occurrence
        entry["last_run"] = today.isoformat()
        try:
            entry["next_run"] = calculate_next_run(entry["frequency"], today).isoformat()
        except ValueError as e:
            print(f"  [warn] Could not calculate next_run for {entry['sched_id']}: {e}")
            # Fallback: advance by ~30 days to avoid re-firing immediately
            entry["next_run"] = (today + timedelta(days=30)).isoformat()

    # ── Write results ─────────────────────────────────────────────────
    tx_engine.append_transactions(all_tx_lines)

    # Save scheduled.csv with updated last_run and next_run dates
    tx_engine.save_scheduled(scheduled)

    # Single atomic git commit for both changed files
    n_booked = len(due)
    summary_str = ", ".join(summaries[:5])
    if len(summaries) > 5:
        summary_str += f" +{len(summaries) - 5} more"
    commit_msg = f"SCHED cron: {n_booked} Buchungen ({summary_str})"

    tx_engine.git_commit(commit_msg, files=[
        "data/transactions.csv",
        "data/scheduled.csv",
    ])

    # Report
    print(f"  Executed {n_booked} scheduled transaction(s):")
    for line in all_tx_lines:
        direction = "+" if line["type"] == "income" else "-"
        print(f"    {direction} {line['amount']} {line['currency']} | {line['payee']} | {line['category']} | ID: {line['import_id']}")
    print(f"  Committed: {commit_msg}")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] cron_sched ERROR: {e}", file=sys.stderr)
        sys.exit(2)
