"""Match scanned receipts to transactions that have no attachment yet.

GeniusScan writes one PDF per receipt named ``YYYYMMDD_<label>.pdf``. The
date is when the scan was made, which is at or shortly after the purchase
and never before it — so the candidate window reaches backwards only.

Like the statement importer, this module classifies and never writes. The
caller uploads the file through POST /api/receipts/upload and sets
receipt_url through POST /api/tx/update, which keeps the single sanctioned
write path intact.
"""

from __future__ import annotations

import csv
import re
from datetime import date as _date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
SCAN_LOG_PATH = DATA_DIR / "receipt_scan_log.csv"

SCAN_LOG_COLUMNS = [
    "scan_id", "source_file", "scan_date", "label",
    "receipt_url", "import_ids", "created_at",
]

# How far back from the scan date a purchase may sit.
CANDIDATE_DAYS = 3

# Names must line up on word boundaries, not as naked substrings: 'ING'
# sits inside 'JNIA Parking' by accident, while 'GMK' is a real three
# letter merchant and must still match. A length cutoff would trade one
# error for the other; a boundary check answers both. Same trap the payee
# register hit with 'Markt' and '3000'.

_NAME_RE = re.compile(r"^(\d{8})_(.+)\.pdf$", re.IGNORECASE)


def parse_scan_filename(name: str) -> tuple[str, str] | None:
    """'20260817_Fielmann Rechnung.pdf' → ('2026-08-17', 'Fielmann Rechnung')."""
    hit = _NAME_RE.match((name or "").strip())
    if not hit:
        return None
    stamp, label = hit.group(1), hit.group(2).strip()
    try:
        iso = _date(int(stamp[:4]), int(stamp[4:6]), int(stamp[6:8])).isoformat()
    except ValueError:
        return None
    return (iso, label) if label else None


def _parse_iso(value: str) -> _date | None:
    try:
        y, m, d = (int(p) for p in str(value).split("-"))
        return _date(y, m, d)
    except (ValueError, TypeError):
        return None


def _normalise(text: str) -> str:
    """Lower-case and reduce every separator to a single space.

    Scan labels mix spaces and underscores ("Agarwals_Checkup"), and an
    underscore counts as a word character — without this the boundary
    check below would reject a perfectly good match.
    """
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _label_matches_row(label: str, row: dict, payees: list[dict],
                       label_categories: dict) -> bool:
    """Does this label describe the given transaction?

    Three routes, cheapest first: the label appears in the payee or note
    directly, it resolves through the payee register's aliases, or it is
    one of the labels that names a category rather than a merchant —
    "Fuel" is booked on whichever petrol station was used.
    """
    low = _normalise(label)
    payee = _normalise(row.get("payee") or "")
    note = _normalise(row.get("note") or "")

    def contained(needle: str, haystack: str) -> bool:
        """True when `needle` appears in `haystack` as whole words."""
        if not needle or not haystack:
            return False
        return re.search(r"(?<!\w)" + re.escape(needle) + r"(?!\w)", haystack) is not None

    if contained(low, payee) or contained(payee, low) or contained(low, note):
        return True

    for entry in payees:
        canonical = _normalise(entry.get("payee") or "")
        if not canonical or canonical != payee:
            continue
        for name in [canonical] + [_normalise(a) for a in entry.get("aliases") or []]:
            if contained(name, low) or contained(low, name):
                return True

    category = (row.get("category") or "").lower()
    wanted = label_categories.get(low)
    return bool(wanted and category == wanted.lower())


def find_candidates(scan_date: str, label: str, tx_rows: list[dict],
                    payees: list[dict], label_categories: dict,
                    days: int = CANDIDATE_DAYS) -> list[dict]:
    """Transactions without an attachment that this scan could belong to."""
    scanned = _parse_iso(scan_date)
    if scanned is None:
        return []
    earliest = scanned - timedelta(days=days)
    out = []
    for row in tx_rows:
        if (row.get("receipt_url") or "").strip():
            continue  # already has an attachment — leave it alone
        if (row.get("type") or "expense") != "expense":
            continue  # a receipt documents a purchase, not money coming in
        booked = _parse_iso(row.get("date", ""))
        if booked is None or not (earliest <= booked <= scanned):
            continue
        if _label_matches_row(label, row, payees, label_categories):
            out.append(row)
    return out


def _amount(row: dict) -> float:
    try:
        return float(row.get("amount") or 0)
    except ValueError:
        return 0.0


def classify_scan(filename: str, tx_rows: list[dict], payees: list[dict],
                  label_categories: dict, processed: set) -> dict:
    """Decide what a single scan file should attach to.

    Buckets: ``done`` (already handled in an earlier run), ``sure``
    (one unambiguous target), ``ask`` (several, spread over days) and
    ``none``.
    """
    if filename in processed:
        return {"file": filename, "bucket": "done", "import_ids": []}

    parsed = parse_scan_filename(filename)
    if parsed is None:
        return {"file": filename, "bucket": "none", "reason": "unparsable_name",
                "import_ids": []}
    scan_date, label = parsed

    candidates = find_candidates(scan_date, label, tx_rows, payees, label_categories)
    base = {"file": filename, "scan_date": scan_date, "label": label}
    if not candidates:
        return {**base, "bucket": "none", "reason": "no_candidate", "import_ids": []}

    by_day: dict[str, list[dict]] = {}
    for row in candidates:
        by_day.setdefault(row["date"], []).append(row)

    if len(by_day) > 1:
        # Two separate purchases in the window — guessing would be wrong.
        return {**base, "bucket": "ask", "reason": "several_days",
                "import_ids": [r["import_id"] for r in candidates]}

    same_day = next(iter(by_day.values()))
    groups = {(r.get("receipt_group") or "").strip() for r in same_day}
    if len(same_day) > 1 and len(groups) == 1 and "" not in groups:
        # A designed split: one physical receipt across several categories.
        return {**base, "bucket": "sure", "reason": "receipt_group",
                "import_ids": [r["import_id"] for r in same_day]}

    if len(same_day) == 1:
        return {**base, "bucket": "sure", "reason": "single",
                "import_ids": [same_day[0]["import_id"]]}

    # The recurring restaurant shape: the bill on one account and the tip
    # in cash. The tip is a separate payment and is not on the receipt, so
    # only the larger row gets the attachment.
    largest = max(same_day, key=_amount)
    return {**base, "bucket": "sure", "reason": "largest_of_day",
            "import_ids": [largest["import_id"]],
            "skipped_ids": [r["import_id"] for r in same_day
                            if r["import_id"] != largest["import_id"]]}


# ── Idempotency log ──────────────────────────────────────────────────

def load_processed() -> set:
    """Source filenames already attached in an earlier run."""
    if not SCAN_LOG_PATH.exists():
        return set()
    with SCAN_LOG_PATH.open("r", newline="", encoding="utf-8") as f:
        return {row.get("source_file", "") for row in csv.DictReader(f)
                if row.get("source_file")}


def append_log(entries: list[dict]) -> int:
    """Record attached scans so a later run skips them. Returns count."""
    if not entries:
        return 0
    from datetime import datetime
    exists = SCAN_LOG_PATH.exists()
    SCAN_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with SCAN_LOG_PATH.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if not exists:
            writer.writerow(SCAN_LOG_COLUMNS)
        stamp = datetime.now().isoformat(timespec="seconds")
        for e in entries:
            writer.writerow([
                e.get("scan_id", ""), e.get("source_file", ""),
                e.get("scan_date", ""), e.get("label", ""),
                e.get("receipt_url", ""), ";".join(e.get("import_ids", [])),
                stamp,
            ])
    return len(entries)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Prints the classification as JSON on stdout."""
    import argparse
    import json

    import config_loader
    import tx_engine

    parser = argparse.ArgumentParser(description="Match scanned receipts to transactions.")
    parser.add_argument("--source", required=True,
                        help="folder holding the YYYYMMDD_<label>.pdf scans")
    parser.add_argument("--since", default="",
                        help="ignore scans dated before this ISO date")
    args = parser.parse_args(argv)

    source = Path(args.source)
    if not source.is_dir():
        print(json.dumps({"error": f"not a directory: {args.source}"}))
        return 1

    with (tx_engine.DATA_DIR / "transactions.csv").open(
            "r", newline="", encoding="utf-8") as f:
        tx_rows = list(csv.DictReader(f))
    payees = tx_engine.load_payees()
    label_categories = {
        str(k).lower(): v for k, v in
        (config_loader.get_default("receipt_scan.label_categories", {}) or {}).items()
    }
    processed = load_processed()

    results = []
    for path in sorted(source.rglob("*.pdf")):
        parsed = parse_scan_filename(path.name)
        if args.since and parsed and parsed[0] < args.since:
            continue
        outcome = classify_scan(path.name, tx_rows, payees, label_categories, processed)
        outcome["path"] = str(path)
        results.append(outcome)

    summary = {}
    for r in results:
        summary[r["bucket"]] = summary.get(r["bucket"], 0) + 1
    print(json.dumps({"summary": summary, "results": results},
                     indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
