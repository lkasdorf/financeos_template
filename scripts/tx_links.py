"""Which transactions are spoken for by a side log.

fuel_log, luku_log, water_log and subscription_log reference rows in
transactions.csv through ``tx_import_id``, and each owns a delete
cascade of its own (deleting a fuel entry removes its transaction, not
the other way round). Anything that removes transaction rows
generically — the split-group editor — has to ask here first and
refuse, rather than silently leaving a log row pointing at nothing.

Lives outside tx_engine on purpose: fuel.py and utilities.py import
tx_engine, so tx_engine cannot import them back.
"""

from __future__ import annotations

import csv
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

# Every side log that links to a transaction. A new TX-linked log that
# is not registered here would let the group editor delete rows out from
# under it — tests/test_tx_links.py checks the column still exists.
LINKED_LOGS = ("fuel_log", "luku_log", "water_log", "subscription_log")


def linked_tx_ids() -> frozenset[str]:
    """Return every import_id referenced by a side log."""
    out: set[str] = set()
    for name in LINKED_LOGS:
        path = DATA_DIR / f"{name}.csv"
        if not path.exists():
            continue
        with path.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                ref = (row.get("tx_import_id") or "").strip()
                if ref:
                    out.add(ref)
    return frozenset(out)
