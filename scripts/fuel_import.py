"""Fuel Excel import — link historical tankings to existing transactions.

Phase 1b: read a fuel-history Excel (default: data/fuel_data/Vehicle_Fuel.xlsx),
match each row against existing expense TXs in transactions.csv, and write
linked entries into fuel_log.csv. No new transactions are created for matched
rows — they reuse the existing import_id, so balances and reports stay intact.

Match heuristic per row:
    1. Candidates = expense TXs with the same currency where
       |date_diff| ≤ DATE_TOLERANCE days AND |amount_diff| ≤ AMOUNT_TOLERANCE.
    2. Score each candidate by account preference (kft/kfu favored), payee
       similarity, and date proximity. The highest-scoring candidate wins.
    3. Tied or sparse winners trigger an interactive picker in --apply mode.

CLI:
    python scripts/fuel_import.py                       # dry-run report
    python scripts/fuel_import.py --apply               # write fuel_log
    python scripts/fuel_import.py --file <path>         # custom Excel
    python scripts/fuel_import.py --vehicle v-001       # target vehicle
    python scripts/fuel_import.py --account kft         # restrict candidates
    python scripts/fuel_import.py --skip-unmatched      # auto-skip unmatched

Behavior on `--apply`:
    - Matched rows  → fuel_log entry with linked tx_import_id (no new TX).
    - Multi-match   → prompt user to pick one of the candidates.
    - Unmatched     → prompt user: (c)reate new TX, (s)kip but log fuel
                      entry without TX link, (x) skip entirely.
"""

from __future__ import annotations

import argparse
import csv
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Local sibling modules — fuel.py owns the fuel_log writer + add_fuel_entry.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fuel  # noqa: E402
import tx_engine  # noqa: E402
from backup import BACKUP_TARGETS, backup_file  # noqa: E402

# ── Path Constants ──────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
DEFAULT_EXCEL = DATA_DIR / "fuel_data" / "Vehicle_Fuel.xlsx"

# ── Match Tunables ──────────────────────────────────────────────────────────

# How far the Excel date may drift from the bank/MMEX posting date.
# Three days covers same-day-card→next-day-batch posting plus weekend gaps.
DATE_TOLERANCE_DAYS = 3
# MMEX-era TXs were frequently entered rounded to the nearest 1000 TZS,
# while the Excel keeps the exact petrol-station total. Empirically the
# drift is bounded at ~50 TZS; 100 leaves headroom without admitting
# false positives (no other kft expense category lands this close to a
# fuel total on the same day).
AMOUNT_TOLERANCE_TZS = 100.0
# Account-preference bonus: business accounts are the expected fuel source.
ACCOUNT_BONUS = {"kft": 10, "kfu": 10, "ksdu": 5}
# Fuel-category bonus: if the candidate's category looks like fuel, prefer
# it strongly. Guards against any (unlikely) collision with same-day,
# same-amount, non-fuel expenses on the same account.
FUEL_CATEGORY_KEYWORDS = ("petrol", "fuel", "gas", "diesel")
FUEL_CATEGORY_BONUS = 8
# When several candidates pass the filters, treat the row as a clean
# match if the leader's score beats the runner-up by at least this margin.
# 5 lets a fuel-category bonus or a payee-similarity bonus alone resolve
# ambiguity, while still flagging genuine ties for interactive review.
CLEAR_WINNER_GAP = 5


# ── Excel Reader ────────────────────────────────────────────────────────────

def read_excel(path: Path) -> list[dict]:
    """Return Excel data rows as a list of normalized dicts.

    Strips the trailing totals row (row 33 in the historical file: a single
    integer in column A and aggregate values elsewhere) by skipping any row
    whose Date is not a real datetime.
    """
    try:
        import openpyxl  # local import — only fuel_import.py needs it
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "openpyxl is required for fuel_import. Run: pip install openpyxl"
        ) from exc

    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = []
    for excel_row in ws.iter_rows(min_row=2, values_only=True):
        date_cell, mileage, liters, cost, station, remarks, *_ = excel_row
        if not isinstance(date_cell, datetime):
            # Skip totals row or blank trailing rows
            continue
        remarks_str = (remarks or "").strip()
        is_full = remarks_str.lower() == "full"
        # The Excel uses the "Full" remark as the full-tank flag; the boolean
        # captures it already, so strip it here to avoid duplicating "Full"
        # in the fuel_log remarks column or the generated TX note.
        rows.append({
            "date": date_cell.date(),
            "odometer_km": float(mileage) if mileage is not None else 0.0,
            "liters": float(liters) if liters is not None else 0.0,
            "total_cost": float(cost) if cost is not None else 0.0,
            "station": (station or "").strip(),
            "remarks": "" if is_full else remarks_str,
            "full_tank": is_full,
        })
    return rows


# ── Match Engine ────────────────────────────────────────────────────────────

def load_expense_txs(account_filter: str | None = None) -> list[dict]:
    """Load all expense rows from transactions.csv (optionally on one account).

    Returns dicts enriched with parsed `_date` (date object) and `_amount`
    (float) fields for cheaper repeated comparisons.
    """
    out = []
    tx_path = DATA_DIR / "transactions.csv"
    with open(tx_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("type") != "expense":
                continue
            if account_filter and row.get("account") != account_filter:
                continue
            try:
                row["_date"] = datetime.strptime(row["date"], "%Y-%m-%d").date()
                row["_amount"] = float(row["amount"])
            except (ValueError, KeyError):
                continue
            out.append(row)
    return out


def payee_similarity(excel_station: str, tx_payee: str) -> int:
    """Lightweight fuzzy score in the 0–10 range.

    Pure substring/word overlap is enough — Excel stations are short
    canonical names ('Shell Downtown'), TX payees are user-entered.
    """
    a = excel_station.lower().strip()
    b = tx_payee.lower().strip()
    if not a or not b:
        return 0
    if a == b:
        return 10
    if a in b or b in a:
        return 7
    a_words = set(a.split())
    b_words = set(b.split())
    overlap = a_words & b_words
    if overlap:
        # 4 base points + 1 per shared word, capped before the exact-match score
        return min(6, 4 + len(overlap))
    return 0


def score_candidate(excel_row: dict, tx: dict) -> int:
    """Higher = better. Used to rank multiple candidates for one Excel row."""
    score = 0
    score += ACCOUNT_BONUS.get(tx.get("account", ""), 0)
    score += payee_similarity(excel_row["station"], tx.get("payee", ""))
    cat = tx.get("category", "").lower()
    if any(kw in cat for kw in FUEL_CATEGORY_KEYWORDS):
        score += FUEL_CATEGORY_BONUS
    # Closer date wins — subtract day delta
    score -= abs((tx["_date"] - excel_row["date"]).days)
    return score


def find_candidates(
    excel_row: dict, expense_txs: list[dict],
    already_linked: set[str],
) -> list[dict]:
    """Return all transactions plausibly matching one Excel row.

    Filtering is conservative on purpose: if the date or amount are far
    off, scoring cannot rescue the candidate, so we drop it early.
    """
    target_date = excel_row["date"]
    target_amount = excel_row["total_cost"]
    candidates = []
    for tx in expense_txs:
        if tx["import_id"] in already_linked:
            continue
        if abs((tx["_date"] - target_date).days) > DATE_TOLERANCE_DAYS:
            continue
        if abs(tx["_amount"] - target_amount) > AMOUNT_TOLERANCE_TZS:
            continue
        candidates.append(tx)
    return candidates


def classify_row(
    excel_row: dict, expense_txs: list[dict], already_linked: set[str],
) -> tuple[str, list[dict], dict | None]:
    """Classify one Excel row.

    Returns:
        (status, ranked_candidates, best_candidate)
        - status in {"matched", "multi", "unmatched"}
        - ranked_candidates: descending by score
        - best_candidate: highest-scored row (None if unmatched)

    "matched" means a single confident hit; "multi" means several plausible
    candidates that needed scoring (caller may auto-pick the leader or
    prompt the user depending on the score gap).
    """
    cands = find_candidates(excel_row, expense_txs, already_linked)
    if not cands:
        return "unmatched", [], None
    ranked = sorted(cands, key=lambda c: score_candidate(excel_row, c), reverse=True)
    if len(ranked) == 1:
        return "matched", ranked, ranked[0]
    # Promote multi → matched when the leader is unambiguously ahead, so
    # the import does not pause for trivially clear cases.
    gap = score_candidate(excel_row, ranked[0]) - score_candidate(excel_row, ranked[1])
    if gap >= CLEAR_WINNER_GAP:
        return "matched", ranked, ranked[0]
    return "multi", ranked, ranked[0]


# ── Fuel Log Writer ─────────────────────────────────────────────────────────

def already_linked_ids() -> set[str]:
    """Return the set of TX import_ids already referenced by fuel_log.csv.

    Idempotency guard: re-running the import never double-links a TX.
    """
    return {
        r["tx_import_id"]
        for r in fuel.load_fuel_log()
        if r.get("tx_import_id", "").strip()
    }


def make_fuel_row(
    excel_row: dict, vehicle: dict, account: str,
    currency: str, tx_import_id: str,
) -> dict:
    """Build a fuel_log row from an Excel entry + vehicle context.

    The fuel_id is generated at write time (load_fuel_log + next_fuel_id)
    rather than here, so concurrent imports cannot collide on IDs.
    """
    return {
        "fuel_id": fuel.next_fuel_id(),
        "date": excel_row["date"].strftime("%Y-%m-%d"),
        "vehicle_id": vehicle["vehicle_id"],
        "odometer_km": f"{float(excel_row['odometer_km']):.0f}",
        "liters": f"{float(excel_row['liters']):.2f}",
        "total_cost": f"{float(excel_row['total_cost']):.2f}",
        "currency": currency,
        "station": excel_row["station"],
        "full_tank": "true" if excel_row["full_tank"] else "false",
        "remarks": excel_row["remarks"],
        "account": account,
        "tx_import_id": tx_import_id,
    }


# ── Reporting ───────────────────────────────────────────────────────────────

def print_report(
    results: list[tuple[dict, str, list[dict], dict | None]],
) -> None:
    """Print a per-row + summary report of the match phase."""
    by_status: dict[str, int] = {"matched": 0, "multi": 0, "unmatched": 0}
    print(f"\n{'idx':<4} {'date':<11} {'L':>6} {'cost':>11} {'station':<22} status   match")
    print("-" * 100)
    for i, (row, status, _ranked, best) in enumerate(results, 1):
        by_status[status] += 1
        if best is not None:
            match_str = (
                f"{best['date']} {best['account']:<6} "
                f"{best['_amount']:>10.2f}  {best['payee'][:25]}"
            )
        else:
            match_str = "-"
        print(
            f"{i:<4} {row['date']!s:<11} {row['liters']:>6.2f} "
            f"{row['total_cost']:>11.2f} {row['station'][:22]:<22} "
            f"{status:<8} {match_str}"
        )
    print("-" * 100)
    print(
        f"Summary: {by_status['matched']} matched, "
        f"{by_status['multi']} multi-match, "
        f"{by_status['unmatched']} unmatched, "
        f"{sum(by_status.values())} total."
    )


# ── Interactive Apply ───────────────────────────────────────────────────────

def prompt_pick(candidates: list[dict]) -> dict | None:
    """Prompt the user to pick a candidate from a multi-match list.

    Returns the chosen candidate, or None if the user skips.
    """
    print("\n  Multiple candidates - pick one:")
    for i, c in enumerate(candidates, 1):
        print(
            f"    [{i}] {c['date']} {c['account']:<6} "
            f"{c['_amount']:>10.2f}  {c['payee']:<25}  id={c['import_id']}"
        )
    print("    [s] skip this row entirely")
    while True:
        choice = input("  pick: ").strip().lower()
        if choice == "s":
            return None
        if choice.isdigit() and 1 <= int(choice) <= len(candidates):
            return candidates[int(choice) - 1]
        print("  invalid - try again.")


def prompt_unmatched(excel_row: dict) -> str:
    """Ask the user how to handle an unmatched Excel row.

    Returns one of:
        'create' — create a new expense TX (and reimbursement if pass-through)
        'log'    — write a fuel entry with no TX link (statistics-only)
        'skip'   — drop the row entirely
    """
    print(
        f"\n  No TX match for {excel_row['date']} "
        f"{excel_row['liters']:.2f} L | {excel_row['total_cost']:.2f} "
        f"@ {excel_row['station']}."
    )
    print("    [c] create new TX (with pass-through reimbursement if kft)")
    print("    [l] log fuel entry only, no TX link (statistics-only)")
    print("    [x] skip this row entirely")
    while True:
        choice = input("  choose: ").strip().lower()
        if choice in ("c", "l", "x"):
            return {"c": "create", "l": "log", "x": "skip"}[choice]
        print("  invalid - try again.")


# ── Main Apply Loop ─────────────────────────────────────────────────────────

def apply_results(
    excel_rows: list[dict],
    results: list[tuple[dict, str, list[dict], dict | None]],
    *, vehicle: dict, default_account: str,
    skip_unmatched: bool,
) -> dict[str, int]:
    """Execute writes for matched/multi/unmatched rows.

    Backups are taken once up front (transactions + fuel_log) rather than
    per-row, to keep noise down. add_fuel_entry takes its own backup when
    creating new TXs, which is fine — backups are cheap and idempotent.
    """
    backup_file("transactions", BACKUP_TARGETS["transactions"])
    if fuel.FUEL_LOG_CSV.exists():
        backup_file("fuel_log", fuel.FUEL_LOG_CSV)

    accounts = tx_engine.load_accounts()
    counts = {"linked": 0, "logged_only": 0, "tx_created": 0, "skipped": 0}

    for excel_row, status, ranked, _best in results:
        if status == "matched":
            tx = ranked[0]
            row = make_fuel_row(
                excel_row, vehicle,
                tx["account"], tx.get("currency", "TZS"),
                tx["import_id"],
            )
            fuel.append_fuel_log(row)
            counts["linked"] += 1
            print(f"  [link] {row['fuel_id']} -> {tx['import_id']}")
            continue

        if status == "multi":
            chosen = prompt_pick(ranked)
            if chosen is None:
                counts["skipped"] += 1
                print("  [skip] (multi)")
                continue
            row = make_fuel_row(
                excel_row, vehicle,
                chosen["account"], chosen.get("currency", "TZS"),
                chosen["import_id"],
            )
            fuel.append_fuel_log(row)
            counts["linked"] += 1
            print(f"  [link] {row['fuel_id']} -> {chosen['import_id']}")
            continue

        # status == "unmatched"
        if skip_unmatched:
            counts["skipped"] += 1
            print(f"  [skip] {excel_row['date']} {excel_row['station']} (auto)")
            continue

        decision = prompt_unmatched(excel_row)
        if decision == "skip":
            counts["skipped"] += 1
            continue
        if decision == "create":
            try:
                result = fuel.add_fuel_entry(
                    date=excel_row["date"].strftime("%Y-%m-%d"),
                    vehicle_id=vehicle["vehicle_id"],
                    odometer_km=excel_row["odometer_km"],
                    liters=excel_row["liters"],
                    total_cost=excel_row["total_cost"],
                    station=excel_row["station"],
                    full_tank=excel_row["full_tank"],
                    account=default_account,
                    remarks=excel_row["remarks"],
                )
                counts["tx_created"] += 1
                print(
                    f"  [new]  {result['fuel_id']} + TX {result['tx_import_id']}"
                    + (f" + reimb {result['reimburse_import_id']}" if result['reimburse_import_id'] else "")
                )
            except ValueError as exc:
                print(f"  [error] {exc}")
                counts["skipped"] += 1
            continue
        # decision == "log"
        currency = accounts.get(default_account, {}).get("currency", "TZS")
        row = make_fuel_row(
            excel_row, vehicle, default_account, currency, "",
        )
        fuel.append_fuel_log(row)
        counts["logged_only"] += 1
        print(f"  [log ] {row['fuel_id']} (no TX link)")

    return counts


# ── CLI ─────────────────────────────────────────────────────────────────────

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="fuel_import.py",
        description="Match an Excel fuel history against existing TXs.",
    )
    parser.add_argument(
        "--file", default=str(DEFAULT_EXCEL),
        help=f"Excel file path (default: {DEFAULT_EXCEL.relative_to(REPO_ROOT)})",
    )
    parser.add_argument(
        "--vehicle", default=None,
        help="vehicle_id (default: sole active vehicle)",
    )
    parser.add_argument(
        "--account", default=None,
        help="Restrict TX candidates to this account (default: search all)",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Write fuel_log entries (default is dry-run report only)",
    )
    parser.add_argument(
        "--skip-unmatched", action="store_true",
        help="With --apply, automatically skip unmatched rows (no prompt)",
    )
    args = parser.parse_args(argv)

    excel_path = Path(args.file)
    if not excel_path.exists():
        print(f"[error] Excel file not found: {excel_path}")
        return 1

    # Resolve vehicle
    vehicle_id = args.vehicle
    if not vehicle_id:
        active = fuel.get_active_vehicle()
        if not active:
            print("[error] No --vehicle given and no single active vehicle found.")
            return 1
        vehicle_id = active["vehicle_id"]
    vehicles = fuel.load_vehicles()
    if vehicle_id not in vehicles:
        print(f"[error] Unknown vehicle: '{vehicle_id}'")
        return 1
    vehicle = vehicles[vehicle_id]

    default_account = args.account or vehicle.get("default_account", "")
    print(f"[info] Excel:   {excel_path.relative_to(REPO_ROOT)}")
    print(f"[info] Vehicle: {vehicle['vehicle_id']} ({vehicle['name']})")
    print(f"[info] Default account for new TXs: {default_account}")

    excel_rows = read_excel(excel_path)
    print(f"[info] Excel rows parsed: {len(excel_rows)}")

    expense_txs = load_expense_txs(account_filter=args.account)
    print(
        f"[info] Candidate expense TXs loaded: {len(expense_txs)}"
        + (f" (filtered to '{args.account}')" if args.account else " (all accounts)")
    )

    linked = already_linked_ids()
    if linked:
        print(f"[info] Skipping {len(linked)} TX(s) already linked in fuel_log.")

    # Match phase
    results = []
    for row in excel_rows:
        status, ranked, best = classify_row(row, expense_txs, linked)
        results.append((row, status, ranked, best))

    print_report(results)

    if not args.apply:
        print("\n[dry-run] Re-run with --apply to write fuel_log entries.")
        return 0

    print("\n[apply] Writing fuel_log entries...")
    counts = apply_results(
        excel_rows, results,
        vehicle=vehicle, default_account=default_account,
        skip_unmatched=args.skip_unmatched,
    )
    print(
        f"\n[done] linked={counts['linked']}, "
        f"logged_only={counts['logged_only']}, "
        f"tx_created={counts['tx_created']}, "
        f"skipped={counts['skipped']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
