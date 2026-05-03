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
import os
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


def _parse_md(spec: str) -> tuple[int, int]:
    """Parse an `MM-DD` token, raising ValueError on malformed input.

    Used by yearly:/quarterly: where the spec encodes both the anchor
    month and the day-of-month. Day capping for short months happens
    later, when we know which calendar month the next run lands in.
    """
    parts = spec.split("-")
    if len(parts) != 2:
        raise ValueError(f"expected MM-DD, got {spec!r}")
    month, day = int(parts[0]), int(parts[1])
    if not (1 <= month <= 12):
        raise ValueError(f"month out of range: {month}")
    if not (1 <= day <= 31):
        raise ValueError(f"day out of range: {day}")
    return month, day


def calculate_next_run(frequency: str, from_date: date) -> date:
    """Calculate the next run date based on frequency string.

    Supported formats:
      monthly:<day>     — day 1-31 or 'last' for last day of month
      weekly:<weekday>  — mon/tue/wed/thu/fri/sat/sun
      yearly:MM-DD      — once a year on MM-DD (e.g. yearly:09-15)
      quarterly:MM-DD   — every 3 months on day DD; MM anchors the
                          quarter set (e.g. quarterly:03-15 fires on
                          Mar/Jun/Sep/Dec, quarterly:01-01 on
                          Jan/Apr/Jul/Oct). Day capped per month length
                          (e.g. quarterly:03-31 → Mar 31, Jun 30, Sep 30,
                          Dec 31).
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

    if frequency.startswith("yearly:"):
        target_month, target_day = _parse_md(frequency.split(":", 1)[1].strip())
        # Try this calendar year first; if the target has already passed
        # (or is today), roll over to next year. Day capped to month
        # length so yearly:02-29 in a non-leap year lands on Feb 28.
        for year in (from_date.year, from_date.year + 1):
            last_day = calendar.monthrange(year, target_month)[1]
            candidate = date(year, target_month, min(target_day, last_day))
            if candidate > from_date:
                return candidate
        # Unreachable in practice (year+1 always strictly after from_date).
        raise RuntimeError(f"yearly: could not advance past {from_date}")

    if frequency.startswith("quarterly:"):
        anchor_month, target_day = _parse_md(frequency.split(":", 1)[1].strip())
        # MM anchors the set of 4 months that share the same offset
        # within a quarter. Sort so we walk forward chronologically when
        # searching for the next candidate strictly after from_date.
        anchor_months = sorted(
            {((anchor_month - 1 + 3 * k) % 12) + 1 for k in range(4)}
        )
        for year in (from_date.year, from_date.year + 1):
            for month in anchor_months:
                last_day = calendar.monthrange(year, month)[1]
                candidate = date(year, month, min(target_day, last_day))
                if candidate > from_date:
                    return candidate
        raise RuntimeError(f"quarterly: could not advance past {from_date}")

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

    # Force synchronous git commit+push so a silent push-fail is visible
    # to cron (non-zero exit) instead of leaving the appended TXs in a
    # mid-state where transactions.csv and scheduled.csv are written but
    # the commit/push never lands. The dashboard's interactive path keeps
    # the async default; this opt-in is per-process via env var.
    os.environ["GIT_COMMIT_SYNC"] = "1"
    commit_ok = tx_engine.git_commit(commit_msg, files=[
        "data/transactions.csv",
        "data/scheduled.csv",
    ])

    # Report
    print(f"  Executed {n_booked} scheduled transaction(s):")
    for line in all_tx_lines:
        direction = "+" if line["type"] == "income" else "-"
        print(f"    {direction} {line['amount']} {line['currency']} | {line['payee']} | {line['category']} | ID: {line['import_id']}")
    if commit_ok:
        print(f"  Committed: {commit_msg}")
        return 0
    print(f"  [error] git_commit returned False — TXs appended but not pushed.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] cron_sched ERROR: {e}", file=sys.stderr)
        sys.exit(2)
