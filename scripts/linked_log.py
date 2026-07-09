"""Shared plumbing for TX-linked side logs (fuel_log, luku_log, water_log).

fuel.py and utilities.py each maintain a CSV side log whose rows are
linked to transactions.csv via ``tx_import_id`` (the expense row, plus an
auto-generated pass-through reimbursement where applicable). The
load/append/rewrite helpers, the sequential-ID scanners and the
reimbursement counter-entry lookup used to be duplicated per log
(OPT-14, CODE_REVIEW_2026-06-12) — every fix to the counter-entry logic
had to be applied twice. They live here now; the domain modules keep
thin wrappers so their public API (and the tests / importers built on
it) stays unchanged.

Path handling: functions take explicit ``csv_path`` / ``tx_path``
arguments instead of reading a module-level DATA_DIR, so the callers'
monkeypatched globals (tests patch ``fuel.DATA_DIR`` etc.) keep working.
"""

from __future__ import annotations

import csv
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tx_engine  # noqa: E402


# ── CSV side-log helpers ────────────────────────────────────────────────────

def load_log(csv_path: Path) -> list[dict]:
    """Load all rows of a side-log CSV in insertion order."""
    if not csv_path.exists():
        return []
    with open(csv_path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def append_log(csv_path: Path, columns: list[str], row: dict) -> None:
    """Append a single row (creates the header if missing).

    Durability: flush + fsync force the buffered append to disk before
    the handle closes, so a power loss between the TX commit and the next
    sync cannot leave a torn final row.
    """
    new_file = not csv_path.exists() or csv_path.stat().st_size == 0
    with open(csv_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        if new_file:
            writer.writeheader()
        writer.writerow({c: row.get(c, "") for c in columns})
        f.flush()
        os.fsync(f.fileno())


def write_log(csv_path: Path, columns: list[str], rows: list[dict]) -> None:
    """Atomically rewrite a side-log CSV from scratch with the given rows.

    Rows are normalised to the column set (missing keys become empty
    strings, unknown keys are dropped) — a stray extra key would
    otherwise make DictWriter raise mid-rewrite.
    """
    normalised = [{c: row.get(c, "") for c in columns} for row in rows]
    tx_engine._atomic_csv_rewrite(csv_path, columns, normalised)


def next_seq_id(ids, prefix: str, width: int) -> str:
    """Return the next free '<prefix>-NNN' id, zero-padded to `width`.

    `ids` is any iterable of id strings (log-row ids, dict keys, …);
    non-numeric suffixes are ignored, matching the per-log scanners this
    replaces.
    """
    max_n = 0
    marker = prefix + "-"
    for rid in ids:
        if rid.startswith(marker):
            try:
                n = int(rid.split("-", 1)[1])
            except ValueError:
                continue
            max_n = max(max_n, n)
    return f"{prefix}-{max_n + 1:0{width}d}"


# ── Reimbursement counter-entry lookup ──────────────────────────────────────

def find_reimbursement_id(expense_row: dict, account: dict, tx_path: Path) -> str | None:
    """Locate the auto-generated reimbursement TX paired to an expense.

    Pass-through expenses get a matching income row from
    :func:`tx_engine.generate_pass_through_line`. Since the H-15 fix
    (CODE_REVIEW_2026-05-12), the income leg carries an explicit FK
    ``counter_entry_id`` pointing at the expense's ``import_id``.
    We prefer that lookup direction over the fragile field-tuple match
    (which broke whenever the user manually edited the expense's date /
    amount / payee — the old tuple stopped matching and the
    counter-entry was silently orphaned).

    Returns:
        import_id of the reimbursement TX, or None if not found.

    Lookup order:
        1. FK match: any income row with
           ``counter_entry_id == expense.import_id``.
        2. Legacy fallback: the old (date, account, "income", amount,
           payee, category) tuple match. Required for transactions
           predating the migration script that backfills the FK.
    """
    ptp = account.get("pass_through_payee", "").strip()
    if not ptp:
        return None

    expense_id = (expense_row.get("import_id") or "").strip()
    reimb_cat = tx_engine.REIMBURSEMENT_CATEGORIES.get(
        ptp, f"Income:{ptp} Reimbursement"
    )
    target_amount = f"{float(expense_row['amount']):.2f}"
    target_tuple = (
        expense_row["date"], expense_row["account"], "income",
        target_amount, ptp, reimb_cat,
    )

    legacy_match = None
    with open(tx_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            # Primary: FK direct lookup.
            if expense_id and (row.get("counter_entry_id") or "").strip() == expense_id:
                return row["import_id"]
            # Fallback (legacy rows pre-migration): remember the first
            # tuple match but keep scanning in case a later row has the
            # FK we actually want.
            if legacy_match is None:
                current = (
                    row["date"], row["account"], row["type"],
                    f"{float(row['amount']):.2f}" if row["amount"] else "",
                    row["payee"], row["category"],
                )
                if current == target_tuple:
                    legacy_match = row["import_id"]
    return legacy_match
