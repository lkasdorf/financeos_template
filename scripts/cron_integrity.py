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

    Matching rules:
      * Expenses sharing the same (date, account, receipt_group) are aggregated
        into one group before matching — split receipts get a single
        reimbursement booking for the total, not one per split line.
      * Same-day transfer-outs from the pass-through account are folded into
        the group for that date too. A salary booking plus a same-day savings
        transfer is reimbursed as one combined amount, not two.
      * The match is found if an income row on the same pass-through account
        exists with the aggregated amount and a date within ±14 days of the
        expense date. The wider tolerance covers sammelausgleich-style
        reimbursements that are booked a few days after the actual spend.
    """
    from datetime import date as _dt_date

    issues = []

    pt_accounts = {alias for alias, info in accounts.items() if info.get("pass_through_payee")}
    if not pt_accounts:
        return issues

    TOLERANCE_DAYS = 14

    # Collect pass-through rows. Expenses are bucketed by receipt_group (or
    # one bucket per row if no split); transfer-outs are tracked per day so
    # they can be folded into the matching as a fallback.
    expense_buckets: dict[tuple[str, str, str], dict] = {}
    transfers_by_day: dict[tuple[str, str], list[tuple[float, str]]] = {}
    incomes_by_key: dict[tuple[str, str], set[str]] = {}

    for tx in transactions:
        account = tx.get("account", "")
        if account not in pt_accounts:
            continue
        tx_type = tx.get("type", "")
        try:
            amount = float(tx.get("amount", 0))
        except (ValueError, TypeError):
            continue
        dt = tx.get("date", "")
        import_id = tx.get("import_id", "")

        if tx_type == "expense":
            receipt_group = (tx.get("receipt_group") or "").strip()
            bucket_key = (
                dt,
                account,
                receipt_group if receipt_group else f"__solo__{import_id}",
            )
            bucket = expense_buckets.setdefault(bucket_key, {"amount": 0.0, "import_ids": []})
            bucket["amount"] += amount
            bucket["import_ids"].append(import_id)
        elif tx_type == "transfer":
            transfers_by_day.setdefault((dt, account), []).append((amount, import_id))
        elif tx_type == "income":
            incomes_by_key.setdefault((account, f"{amount:.2f}"), set()).add(dt)

    def _within_tolerance(target_iso: str, candidate_dates: set[str]) -> bool:
        try:
            target = _dt_date.fromisoformat(target_iso)
        except (TypeError, ValueError):
            return False
        for candidate in candidate_dates:
            try:
                c = _dt_date.fromisoformat(candidate)
            except (TypeError, ValueError):
                continue
            if abs((c - target).days) <= TOLERANCE_DAYS:
                return True
        return False

    # Stage 1 — direct match: expense (or split-aggregated bucket) amount
    # equals an income on the same account within ±TOLERANCE_DAYS.
    # Stage 2 — same-day bundle: if a bucket is unmatched and there are
    # transfer-outs on the same account on the same date, try bundling
    # bucket-amount + any combination of those transfer-outs against an
    # income amount. Salary + same-day savings transfer pattern.
    for (dt, account, _gid), info in expense_buckets.items():
        income_dates = incomes_by_key.get((account, f"{info['amount']:.2f}"), set())
        if _within_tolerance(dt, income_dates):
            continue

        bundled = False
        same_day_transfers = transfers_by_day.get((dt, account), [])
        if same_day_transfers:
            # Brute-force subset sum over same-day transfer-outs (typically 1–2).
            n = len(same_day_transfers)
            for mask in range(1, 1 << n):
                extra = 0.0
                for i in range(n):
                    if mask & (1 << i):
                        extra += same_day_transfers[i][0]
                combined = f"{info['amount'] + extra:.2f}"
                if _within_tolerance(dt, incomes_by_key.get((account, combined), set())):
                    bundled = True
                    break
        if bundled:
            continue

        ids = ", ".join(info["import_ids"])
        issues.append(
            f"Orphaned pass-through expense: {dt} | {account} | {info['amount']:.2f} | import_id={ids}"
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


def check_stale_push_heartbeat() -> list[str]:
    """Flag a stale `data/.last_successful_push` heartbeat (L-PD4, Sprint 23).

    `cron_commit` writes this ISO-timestamp file on every successful push.
    If the file is missing or older than 24 hours, cron_commit hasn't
    landed a push in a day — the usual cause is the SSH-passphrase bug
    or a network outage (see deploy/README-pi-setup.md §2 recovery).
    Below 24h the silence is normal (no changes to commit, or push ring
    is doing throttled retries per M-PD2).
    """
    from datetime import datetime, timedelta
    issues: list[str] = []
    heartbeat = DATA_DIR / ".last_successful_push"
    if not heartbeat.exists():
        # First-run state — not an issue. Real outage shows up after
        # the first push has happened and the file gets stale.
        return issues
    try:
        ts_text = heartbeat.read_text(encoding="utf-8").strip()
        last_push = datetime.fromisoformat(ts_text)
    except (OSError, ValueError) as exc:
        issues.append(f"Push heartbeat unreadable: {exc}")
        return issues
    age = datetime.now() - last_push
    if age > timedelta(hours=24):
        issues.append(
            f"Push heartbeat stale: last successful push {last_push.isoformat()}, "
            f"{age.total_seconds() / 3600:.1f}h ago — check cron_commit "
            f"(SSH passphrase? network?)."
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
        ("Stale push heartbeat", check_stale_push_heartbeat()),
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
