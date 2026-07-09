"""One-shot migration: populate ``counter_entry_id`` for historical
pass-through reimbursement pairs in ``data/transactions.csv``.

Background (H-15 from CODE_REVIEW_2026-05-12)
=============================================
Pass-through accounts (business transfer accounts) produce paired
expense+income rows in ``transactions.csv`` so the account balance
nets to zero. Before this fix, the income leg had no explicit link
to its expense — :func:`fuel.find_reimbursement_id` and the matching
helper in utilities.py rebuilt the pair on the fly by matching
``(date, account, amount, payee, category)``. Any user edit to one
of those fields (re-dating an old reimbursement, fat-fingering an
amount, renaming a payee) broke the lookup and left the
counter-entry orphaned.

The fix added a ``counter_entry_id`` FK column to TX_COLUMNS. NEW
pass-through writes (after the migration commit) populate it
automatically via :func:`tx_engine.generate_pass_through_line`. This
script handles the EXISTING rows — walks the historical pairs and
backfills the FK so subsequent edits stay synchronised.

Usage
=====

    python scripts/backfill_counter_entry_id.py            # dry-run by default
    python scripts/backfill_counter_entry_id.py --apply    # actually rewrite the CSV

The dry-run prints a summary of what would be linked. ``--apply``
takes the tx_write_lock, makes a fresh backup of transactions.csv,
then rewrites the file atomically with the new FK column populated.
The pass-through pair matching uses the same (date, account,
amount, payee, category) tuple the legacy find_reimbursement_id
used — once-only — so existing well-formed pairs all migrate.

Idempotent: re-running after a successful pass is a no-op (rows that
already have a counter_entry_id are left alone).
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import tx_engine  # noqa: E402
from backup import backup_file, BACKUP_TARGETS  # noqa: E402


def _match_pairs(rows: list[dict], accounts: dict) -> list[tuple[int, int]]:
    """Return [(income_row_index, expense_row_index), ...] for every
    pass-through pair that still needs an FK link.

    An income row qualifies if:
        - It has no existing ``counter_entry_id``.
        - Its account is pass-through with a non-empty pass_through_payee.
        - Its category matches the configured reimbursement category
          for that payee (or the dynamic fallback).
        - There's a matching expense on the same (date, account, amount)
          on the same pass-through account.
    """
    pairs: list[tuple[int, int]] = []
    # Index expenses by (date, account, amount) for O(1) lookup. Multiple
    # expenses on the same key fall back to first-come-first-serve, which
    # mirrors the legacy field-tuple match semantics — not perfect for
    # the splits-on-same-day case but the legacy code had the same
    # limitation and the orphan rate was acceptable.
    by_key: dict[tuple, list[int]] = {}
    for i, row in enumerate(rows):
        if row.get("type") != "expense":
            continue
        acc = accounts.get(row.get("account", ""), {})
        if acc.get("type") != "pass_through":
            continue
        try:
            amt = f"{float(row['amount']):.2f}"
        except (TypeError, ValueError):
            continue
        key = (row["date"], row["account"], amt)
        by_key.setdefault(key, []).append(i)

    for j, row in enumerate(rows):
        if row.get("type") != "income":
            continue
        if (row.get("counter_entry_id") or "").strip():
            continue  # already linked
        acc = accounts.get(row.get("account", ""), {})
        if acc.get("type") != "pass_through":
            continue
        ptp = acc.get("pass_through_payee", "").strip()
        if not ptp:
            continue
        reimb_cat = tx_engine.REIMBURSEMENT_CATEGORIES.get(
            ptp, f"Income:{ptp} Reimbursement",
        )
        if row.get("payee") != ptp:
            continue
        if row.get("category") != reimb_cat:
            continue
        try:
            amt = f"{float(row['amount']):.2f}"
        except (TypeError, ValueError):
            continue
        key = (row["date"], row["account"], amt)
        expense_indices = by_key.get(key, [])
        if not expense_indices:
            continue
        # Pair greedily with the first unmatched expense on that key.
        expense_i = expense_indices.pop(0)
        pairs.append((j, expense_i))
    return pairs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--apply", action="store_true",
        help="Actually rewrite transactions.csv. Default is dry-run.",
    )
    args = parser.parse_args()

    tx_path = tx_engine.DATA_DIR / "transactions.csv"
    accounts = tx_engine.load_accounts()
    with open(tx_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    print(f"Loaded {len(rows)} transactions from {tx_path.name}.")

    pairs = _match_pairs(rows, accounts)
    print(f"Found {len(pairs)} unlinked pass-through pair(s) to backfill.")
    if not pairs:
        print("Nothing to do.")
        return 0

    # Show a sample so the operator can spot-check before --apply.
    print("\nFirst 5 proposed links:")
    for j, expense_i in pairs[:5]:
        print(
            f"  income {rows[j].get('import_id', '?')[:12]} -> "
            f"expense {rows[expense_i].get('import_id', '?')[:12]}  "
            f"({rows[j].get('date')} {rows[j].get('account')} "
            f"{rows[j].get('amount')} {rows[j].get('payee')})"
        )

    if not args.apply:
        print("\nDry-run. Re-run with --apply to write the changes.")
        return 0

    # Backup + atomic rewrite under the lock. Reentrant via C-02.
    with tx_engine.tx_write_lock():
        backup_file("transactions", BACKUP_TARGETS["transactions"])
        for j, expense_i in pairs:
            rows[j]["counter_entry_id"] = rows[expense_i]["import_id"]
        tx_engine._atomic_csv_rewrite(tx_path, tx_engine.TX_COLUMNS, rows)
    print(f"\nApplied — {len(pairs)} row(s) updated. Backup saved.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
