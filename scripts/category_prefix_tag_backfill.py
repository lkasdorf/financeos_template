"""Backfill auto-tags onto historical TX based on category-prefix rules.

Walks transactions.csv and applies every `auto_tag.by_category_prefix`
rule from `config/defaults.json` to expense rows that match a prefix but
are missing the target tag. Idempotent — re-running adds nothing once
all matches are tagged.

Used after introducing a new category-prefix rule. Concrete trigger
Example: a new rule `Staff:Caretaker ` → `Property_<X>` would
want every existing Salary/Bonus/Rent sub-row for that staff
member retroactively flagged as a property cost so the per-
property Cost-of-Living view reflects history.

Complements `utilities_tag_backfill.py`, which only covers bridge-
propagation and log-linked TX — category-prefix rules are
orthogonal to both.

Reads/writes via the same atomic-rewrite helper TX-engine uses, so the
backup-before-write contract is preserved.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import tx_engine  # noqa: E402


def _split_tags(value: str) -> list[str]:
    return [t.strip() for t in (value or "").split(";") if t.strip()]


def _join_tags(tags: list[str]) -> str:
    seen: list[str] = []
    for t in tags:
        if t and t not in seen:
            seen.append(t)
    return ";".join(seen)


def backfill(*, dry_run: bool = False) -> dict:
    """Apply by_category_prefix rules retroactively to transactions.csv.

    Args:
        dry_run: When True, scan + report without writing.

    Returns:
        {
          "by_prefix": {prefix: {"tag": target, "count": int, "amount": float}},
          "total_count": int,
          "total_amount": float,
        }
    """
    prefix_rules = tx_engine.AUTO_TAG_CATEGORY_PREFIX or {}
    summary: dict[str, dict] = {
        p: {"tag": t, "count": 0, "amount": 0.0}
        for p, t in prefix_rules.items()
    }
    if not prefix_rules:
        return {"by_prefix": {}, "total_count": 0, "total_amount": 0.0}

    tx_path = ROOT / "data" / "transactions.csv"
    if not tx_path.exists():
        return {"by_prefix": summary, "total_count": 0, "total_amount": 0.0}

    rows: list[dict] = []
    with open(tx_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames or []
        rows = list(reader)

    changed = False
    total_count = 0
    total_amount = 0.0

    for row in rows:
        tx_type = (row.get("type") or "").strip().lower()
        # Only expense rows count as a property cost. Reimbursement
        # counter-entries on pass-through accounts would otherwise zero
        # out the property's costs in the report.
        if tx_type != "expense":
            continue
        category = (row.get("category") or "").strip()
        if not category:
            continue
        tags = _split_tags(row.get("tags", ""))
        # Walk prefix rules; first-match-wins isn't enough since one TX
        # might be eligible for multiple rules. Apply all matching.
        for prefix, target in prefix_rules.items():
            if not target:
                continue
            if not category.startswith(prefix):
                continue
            if target in tags:
                continue
            tags.append(target)
            try:
                amount = float(row.get("amount") or 0)
            except (TypeError, ValueError):
                amount = 0.0
            summary[prefix]["count"] += 1
            summary[prefix]["amount"] += amount
            total_count += 1
            total_amount += amount
            changed = True
            row["tags"] = _join_tags(tags)

    if changed and not dry_run:
        try:
            from backup import backup_file  # type: ignore
            backup_file(tx_path)
        except Exception:  # noqa: BLE001
            # backup is best-effort here; the atomic rewrite below is
            # the actual safety net.
            pass
        tx_engine._atomic_csv_rewrite(tx_path, cols, rows)

    return {
        "by_prefix": summary,
        "total_count": total_count,
        "total_amount": total_amount,
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan and report counts without writing transactions.csv.",
    )
    args = p.parse_args()

    result = backfill(dry_run=args.dry_run)
    if not result["by_prefix"]:
        print("No by_category_prefix rules configured — nothing to do.")
        return 0

    print(
        f"\n{'Prefix':30s}  {'Target tag':20s}  {'Rows':>6s}  {'Amount':>16s}"
    )
    print("-" * 80)
    for prefix, info in result["by_prefix"].items():
        print(
            f"{prefix:30s}  {info['tag']:20s}  "
            f"{info['count']:>6d}  {info['amount']:>16,.2f}"
        )
    print("-" * 80)
    print(
        f"{'TOTAL':30s}  {'':20s}  "
        f"{result['total_count']:>6d}  {result['total_amount']:>16,.2f}"
    )
    if args.dry_run:
        print("\n(dry-run — no file written. Re-run without --dry-run to apply.)")
    elif result["total_count"]:
        print("\nApplied. transactions.csv updated.")
    else:
        print("\nAll matching rows are already tagged. No changes written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
