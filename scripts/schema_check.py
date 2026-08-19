#!/usr/bin/env python3
"""Guard against schema drift between docs, code constants, and live CSVs.

AR-H3 (CODE_REVIEW_2026-07-08): docs/schema.md is the declared single
source of truth (Harte Regel #4), but its transactions header block
documented an `essential` column that never existed on transactions.csv
while the real `third_party_id` was missing — every external importer
built against the doc would have written debt-FKs into the wrong field.
On top of that, setup_core.TRANSACTIONS_HEADER had silently drifted from
tx_engine.TX_COLUMNS (missing counter_entry_id), so fresh installs
seeded a 16-column file against a 17-column runtime.

Checks:
  1. setup_core.TRANSACTIONS_HEADER == tx_engine.TX_COLUMNS
  2. schema.md's transactions ```csv header block == TX_COLUMNS
  3. schema.md's transactions example rows have exactly len(TX_COLUMNS) fields
  4. live data/*.csv first lines match their code constants
     (accounts, categories, tags, transactions, scheduled — skipped when
     the file does not exist, e.g. fresh checkout)

Exit codes: 0 = clean, 1 = drift found, 2 = unexpected error.
Runs in CI next to i18n_check.py; run manually via
`python scripts/schema_check.py`.
"""
from __future__ import annotations

import csv
import io
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

# cp1252 consoles (Windows) choke on box-drawing/emoji in messages (X-M4).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import alert_acks
import cash_count
import receipt_scan
import recon_rules
import setup_core
import tx_engine

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_MD = REPO_ROOT / "docs" / "schema.md"


def _fail(errors: list[str], msg: str) -> None:
    errors.append(msg)
    print(f"[schema_check] DRIFT: {msg}")


def _live_header(path: Path) -> list[str] | None:
    if not path.exists():
        return None
    with open(path, newline="", encoding="utf-8") as f:
        try:
            return next(csv.reader(f))
        except StopIteration:
            return None


def main() -> int:
    errors: list[str] = []

    # ── 1. Code-internal consistency ─────────────────────────────────
    if setup_core.TRANSACTIONS_HEADER != tx_engine.TX_COLUMNS:
        _fail(errors,
              "setup_core.TRANSACTIONS_HEADER != tx_engine.TX_COLUMNS\n"
              f"  setup_core: {setup_core.TRANSACTIONS_HEADER}\n"
              f"  tx_engine:  {tx_engine.TX_COLUMNS}")

    # ── 2 + 3. schema.md transactions block ──────────────────────────
    md = SCHEMA_MD.read_text(encoding="utf-8")
    blocks = re.findall(r"```csv\n(.*?)```", md, flags=re.DOTALL)
    if not blocks:
        _fail(errors, "docs/schema.md contains no ```csv blocks")
    else:
        header_block = blocks[0].strip().splitlines()
        doc_header = header_block[0].split(",") if header_block else []
        if doc_header != tx_engine.TX_COLUMNS:
            _fail(errors,
                  "docs/schema.md transactions header != tx_engine.TX_COLUMNS\n"
                  f"  schema.md: {doc_header}\n"
                  f"  tx_engine: {tx_engine.TX_COLUMNS}")
        if len(blocks) > 1:
            n_cols = len(tx_engine.TX_COLUMNS)
            for i, line in enumerate(blocks[1].strip().splitlines(), start=1):
                fields = next(csv.reader(io.StringIO(line)))
                if len(fields) != n_cols:
                    _fail(errors,
                          f"schema.md example row {i} has {len(fields)} fields, "
                          f"expected {n_cols}: {line[:80]}")

    # ── 4. Live data files vs constants ──────────────────────────────
    live_checks = {
        "accounts.csv": setup_core.ACCOUNTS_HEADER,
        "categories.csv": setup_core.CATEGORIES_HEADER,
        "tags.csv": setup_core.TAGS_HEADER,
        "transactions.csv": tx_engine.TX_COLUMNS,
        "scheduled.csv": tx_engine.SCHEDULED_FIELDS,
        "cash_count_log.csv": cash_count.CASH_COUNT_LOG_COLUMNS,
        "recon_dismissed.csv": recon_rules.RECON_DISMISSED_COLUMNS,
        "receipt_scan_log.csv": receipt_scan.SCAN_LOG_COLUMNS,
        "alert_acks.csv": alert_acks.ALERT_ACK_COLUMNS,
    }
    for name, expected in live_checks.items():
        live = _live_header(REPO_ROOT / "data" / name)
        if live is None:
            continue  # fresh checkout / file absent — nothing to compare
        if live != list(expected):
            _fail(errors,
                  f"data/{name} header != code constant\n"
                  f"  live: {live}\n"
                  f"  code: {list(expected)}")

    if errors:
        print(f"[schema_check] {len(errors)} drift issue(s) found")
        return 1
    print("[schema_check] OK — docs, constants and live headers agree")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # pragma: no cover
        print(f"[schema_check] error: {e}", file=sys.stderr)
        sys.exit(2)
