#!/usr/bin/env python3
"""Cron job: Weekly data integrity check for FinanceOS.

Validates all CSV data files for consistency and correctness. Runs weekly
via cron on the Pi and writes a report file if issues are found.

Checks performed:
    1. Orphaned pass-through entries — every expense on a pass-through account must
       have a matching income counter-entry (same date, account, amount)
    2. Unknown categories — all categories in transactions.csv must exist
       in categories.csv
    3. Unknown accounts — all accounts/transfer_to_accounts in transactions.csv
       must exist in accounts.csv
    4. Duplicate import_ids — every import_id must be unique
    5. Overdue scheduled entries — active entries with next_run > 7 days
       in the past (likely missed by cron_sched.py)

Output:
    - Console: check results with PASS/FAIL status
    - data/integrity_report.txt: written only if issues are found,
      deleted automatically when all checks pass (clean state)

Exit codes:
    0 = all checks passed
    1 = issues found (report written)
    2 = unhandled error

Typical cron entry (Pi):
    0 7 * * 1 cd /srv/financeos && python scripts/cron_integrity.py >> logs/cron_integrity.log 2>&1

Usage:
    python scripts/cron_integrity.py
"""

from __future__ import annotations

import csv
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

# Ensure sibling modules are importable
sys.path.insert(0, str(Path(__file__).parent))

import tx_engine

# ── Constants ───────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
REPORT_PATH = DATA_DIR / "integrity_report.txt"  # Only exists when issues are found


def load_transactions() -> list[dict]:
    """Load all transactions from transactions.csv."""
    tx_path = DATA_DIR / "transactions.csv"
    if not tx_path.exists():
        return []
    rows = []
    with open(tx_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def check_orphaned_pass_through(transactions: list[dict], accounts: dict) -> list[str]:
    """Check that every expense on a pass-through account has a matching income counter-entry.

    Pass-through accounts should always have paired entries:
    one expense (the actual spend) and one income (the reimbursement).
    An orphaned expense means the counter-entry was somehow missed.

    Matching is done by (date, account, normalized_amount) — the same
    criteria used when generating counter-entries in tx_engine.
    """
    issues = []

    # Identify which accounts are pass-through type
    pt_accounts = {alias for alias, info in accounts.items() if info.get("pass_through_payee")}
    if not pt_accounts:
        return issues

    # Build lookup sets: expenses to verify, incomes as proof of counter-entry
    expenses = []
    incomes = set()

    for tx in transactions:
        account = tx.get("account", "")
        if account not in pt_accounts:
            continue
        tx_type = tx.get("type", "")
        try:
            # Normalize amount to 2 decimals for reliable matching
            amount = f"{float(tx.get('amount', 0)):.2f}"
        except (ValueError, TypeError):
            continue
        key = (tx.get("date", ""), account, amount)

        if tx_type == "expense":
            expenses.append((key, tx.get("import_id", "")))
        elif tx_type == "income":
            incomes.add(key)

    # Flag expenses that have no matching income counter-entry. Allow a
    # ±1 day tolerance on the date so a manual edit that shifts the
    # expense or its auto-generated counter-entry by one day (common
    # when the user back-dates a posting) doesn't show up as orphaned.
    from datetime import date as _dt_date, timedelta as _dt_td

    def _shift_iso(iso_date: str, delta_days: int) -> str:
        try:
            d = _dt_date.fromisoformat(iso_date)
        except (TypeError, ValueError):
            return iso_date
        return (d + _dt_td(days=delta_days)).isoformat()

    for key, import_id in expenses:
        dt, acct, amt = key
        candidates = (
            (dt, acct, amt),
            (_shift_iso(dt, -1), acct, amt),
            (_shift_iso(dt, 1), acct, amt),
        )
        if any(c in incomes for c in candidates):
            continue
        issues.append(
            f"Orphaned pass-through expense: {dt} | {acct} | {amt} | import_id={import_id}"
            )

    return issues


def check_unknown_categories(transactions: list[dict], categories: dict) -> list[str]:
    """Check that all categories in transactions exist in categories.csv.

    Reports each unknown category only once (with the first import_id
    where it appears) to keep the output manageable.
    """
    issues = []
    unknown = set()  # Track already-reported categories to avoid duplicates

    for tx in transactions:
        cat = tx.get("category", "").strip()
        if not cat:
            continue
        if cat not in categories and cat not in unknown:
            unknown.add(cat)
            issues.append(f"Unknown category: '{cat}' (used in import_id={tx.get('import_id', '?')})")

    return issues


def check_unknown_accounts(transactions: list[dict], accounts: dict) -> list[str]:
    """Check that all accounts in transactions exist in accounts.csv.

    Validates both the primary 'account' field and 'transfer_to_account'
    (used by transfer transactions). Reports each unknown account once.
    """
    issues = []
    unknown = set()  # Track already-reported accounts to avoid duplicates

    for tx in transactions:
        acct = tx.get("account", "").strip()
        if not acct:
            continue
        if acct not in accounts and acct not in unknown:
            unknown.add(acct)
            issues.append(f"Unknown account: '{acct}' (used in import_id={tx.get('import_id', '?')})")

        # Also validate the destination account for transfers
        tta = tx.get("transfer_to_account", "").strip()
        if tta and tta not in accounts and tta not in unknown:
            unknown.add(tta)
            issues.append(f"Unknown transfer_to_account: '{tta}' (used in import_id={tx.get('import_id', '?')})")

    return issues


def check_duplicate_import_ids(transactions: list[dict]) -> list[str]:
    """Flag any duplicate import_id values.

    Import IDs are supposed to be unique (enforced by generate_import_id's
    tiebreaker logic). Duplicates indicate a bug or manual CSV editing.
    """
    issues = []
    counter = Counter(tx.get("import_id", "") for tx in transactions)

    for import_id, count in counter.items():
        if count > 1 and import_id:
            issues.append(f"Duplicate import_id: '{import_id}' appears {count} times")

    return issues


def check_overdue_scheduled() -> list[str]:
    """Flag scheduled entries where next_run is more than 7 days in the past.

    Overdue entries suggest that cron_sched.py is not running (Pi offline,
    cron misconfigured, etc.). The 7-day grace period avoids false alarms
    from brief Pi downtime.
    """
    issues = []
    today = date.today()
    scheduled = tx_engine.load_scheduled()

    for entry in scheduled:
        if entry.get("active", "").lower() != "true":
            continue
        next_run = entry.get("next_run", "").strip()
        if not next_run:
            continue
        try:
            run_date = date.fromisoformat(next_run)
        except ValueError:
            issues.append(f"Invalid next_run for {entry['sched_id']}: '{next_run}'")
            continue

        days_overdue = (today - run_date).days
        if days_overdue > 7:
            issues.append(
                f"Overdue scheduled: {entry['sched_id']} ({entry['name']}) — "
                f"next_run={next_run}, {days_overdue} days overdue"
            )

    return issues


def main() -> int:
    """Run all integrity checks and produce a report.

    Returns:
        0 if all checks pass, 1 if any issues found, 2 on unhandled error.
    """
    now = datetime.now()
    ts = now.strftime("%Y-%m-%d %H:%M:%S")

    print(f"[{ts}] cron_integrity: running data integrity checks...")
    print()

    # ── Load all data needed for checks ─────────────────────────────────
    transactions = load_transactions()
    accounts = tx_engine.load_accounts()
    categories = tx_engine.load_categories()

    all_issues: list[tuple[str, list[str]]] = []

    # ── Execute all checks ──────────────────────────────────────────────
    checks = [
        ("Orphaned pass-through entries", check_orphaned_pass_through(transactions, accounts)),
        ("Unknown categories", check_unknown_categories(transactions, categories)),
        ("Unknown accounts", check_unknown_accounts(transactions, accounts)),
        ("Duplicate import_ids", check_duplicate_import_ids(transactions)),
        ("Overdue scheduled entries", check_overdue_scheduled()),
    ]

    total_issues = 0
    report_lines = [
        f"FinanceOS Integrity Report — {now.strftime('%Y-%m-%d %H:%M:%S')}",
        f"Transactions checked: {len(transactions)}",
        "",
    ]

    for name, issues in checks:
        count = len(issues)
        total_issues += count
        status = "PASS" if count == 0 else f"FAIL ({count})"
        line = f"  [{status}] {name}"
        print(line)
        report_lines.append(line)

        if issues:
            all_issues.append((name, issues))
            for issue in issues:
                detail = f"         {issue}"
                print(detail)
                report_lines.append(detail)

    print()
    report_lines.append("")

    if total_issues == 0:
        summary = "All checks passed. No issues found."
        print(summary)
        report_lines.append(summary)
        # Clean slate: remove the report file so its absence signals "all good"
        if REPORT_PATH.exists():
            REPORT_PATH.unlink()
            print(f"  (Removed old {REPORT_PATH.name})")
        return 0
    else:
        summary = f"Found {total_issues} issue(s) across {len(all_issues)} check(s)."
        print(summary)
        report_lines.append(summary)

        # Write report file
        REPORT_PATH.write_text("\n".join(report_lines) + "\n", encoding="utf-8")
        print(f"  Report written to {REPORT_PATH.name}")

        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] cron_integrity ERROR: {e}", file=sys.stderr)
        sys.exit(2)
