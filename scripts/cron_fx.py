#!/usr/bin/env python3
"""Cron job: Snapshot current foreign exchange rates to data/fx_rates.csv.

Fetches live rates from the free open.er-api.com API (USD-based),
converts them to TZS-based rates (the system's primary currency),
and writes the result to data/fx_rates.csv. Only commits to git if
the rates actually changed.

The dashboard uses fx_rates.csv as a fallback when live API calls
fail (e.g. Pi is offline). It also serves as a historical reference
for the last known rates.

Tracked currencies: TZS, USD, EUR, PLN, TRY (Turkish Lira)

Typical cron entry (Pi):
    30 6 * * * cd /srv/financeos && python scripts/cron_fx.py >> logs/cron_fx.log 2>&1

Usage:
    python scripts/cron_fx.py
"""

from __future__ import annotations

import csv
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, date
from pathlib import Path

# Ensure sibling modules are importable
sys.path.insert(0, str(Path(__file__).parent))

import backup
import fx_backfill
import tx_engine

# ── Constants ───────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
FX_PATH = DATA_DIR / "fx_rates.csv"
FX_HISTORY_PATH = DATA_DIR / "fx_rates_history.csv"
from config_loader import get_default  # noqa: E402

API_URL = get_default("currency.fx_api_url", "https://open.er-api.com/v6/latest/USD")  # Free, no API key required

# Currencies used across all FinanceOS accounts
TRACKED = ["TZS", "USD", "EUR", "PLN", "TRY"]

# Currencies tracked in historical monthly file (TZS-per-unit)
HISTORY_CURRENCIES = ["EUR", "USD", "PLN", "TRY"]


def fetch_rates_erapi() -> dict[str, float]:
    """Fetch USD-based exchange rates from the open.er-api.com API (fallback source).

    Returns:
        Dict mapping currency code to rate-per-USD. None for unavailable currencies.
        Example: {'TZS': 2650.0, 'USD': 1.0, 'EUR': 0.92, ...}
    """
    req = urllib.request.Request(API_URL, headers={"User-Agent": "FinanceOS-Cron/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    if data.get("result") != "success":
        raise RuntimeError(f"API returned non-success: {data.get('result')}")

    rates = data.get("rates", {})
    result = {}
    for cur in TRACKED:
        if cur == "USD":
            result["USD"] = 1.0
        elif cur in rates:
            result[cur] = rates[cur]
        else:
            result[cur] = None
    return result


def fetch_rates_bot() -> dict[str, float]:
    """Fetch today's rates via Bank of Tanzania (primary source).

    BoT publishes daily TZS-quoted rates for EUR + USD (and ~40 other
    currencies). PLN and TRY are derived via Frankfurter EUR cross-rate
    since BoT does not reliably publish them.

    If today is a weekend / holiday and BoT has no row yet, walks back up
    to 6 days to find the most recent published rate.

    Returns the same shape as ``fetch_rates_erapi`` so callers can stay
    source-agnostic.
    """
    from datetime import timedelta

    today = date.today()
    bot_today: dict[str, float] | None = None
    bot_data_for_cross: dict = {}
    for offset in range(0, 7):
        d = today - timedelta(days=offset)
        chunk = fx_backfill.fetch_bot_chunk(d, d)
        if chunk.get(d, {}).get("USD"):
            bot_today = chunk[d]
            bot_data_for_cross = chunk
            break

    if not bot_today or "USD" not in bot_today:
        raise RuntimeError("BoT: no recent USD rate (last 7 days returned empty)")

    tzs_per_usd = bot_today["USD"]
    result: dict[str, float | None] = {"USD": 1.0, "TZS": tzs_per_usd}

    for cur in ("EUR",):
        v = bot_today.get(cur)
        result[cur] = (tzs_per_usd / v) if v else None

    # PLN + TRY via Frankfurter cross-rate.
    try:
        fr = fx_backfill.fetch_frankfurter_eur_to(("PLN", "TRY"), today - timedelta(days=7), today)
        cross = fx_backfill.derive_via_eur_cross_rate(fr, bot_data_for_cross, ("PLN", "TRY"))
        latest_cross = cross.get(max(cross)) if cross else {}
        for cur in ("PLN", "TRY"):
            tzs_per_cur = latest_cross.get(cur)
            result[cur] = (tzs_per_usd / tzs_per_cur) if tzs_per_cur else None
    except Exception:
        result.setdefault("PLN", None)
        result.setdefault("TRY", None)

    return result


def fetch_rates() -> tuple[dict[str, float], str]:
    """Try BoT first, fall back to open.er-api.com on any failure.

    Returns ``(rates_dict, source_label)`` where source_label is "BoT" or
    "er-api". Raises if both sources fail — caller decides what to do.
    """
    try:
        return fetch_rates_bot(), "BoT"
    except Exception as e:
        print(f"  [warn] BoT primary failed: {e}", file=sys.stderr)
        return fetch_rates_erapi(), "er-api"


def read_existing() -> list[dict]:
    """Read existing fx_rates.csv."""
    rows = []
    if not FX_PATH.exists():
        return rows
    with open(FX_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def write_fx_rates(rates: dict[str, float], today_str: str) -> bool:
    """Write fx_rates.csv with TZS-based cross rates.

    The CSV stores both the raw rate-per-USD and a derived tzs_per_unit
    column. The dashboard uses tzs_per_unit for on-the-fly conversion
    of all amounts to the user's selected display currency.

    Args:
        rates: Dict of {currency: rate_per_usd} from fetch_rates().
        today_str: ISO date string for the 'updated' column.

    Returns:
        True if the file content actually changed, False if unchanged.
    """
    # Save old content to detect whether a git commit is needed
    old_content = ""
    if FX_PATH.exists():
        old_content = FX_PATH.read_text(encoding="utf-8")

    # TZS is the base currency; all other rates are expressed as TZS-per-unit
    tzs_rate = rates.get("TZS", 2650.0)
    if tzs_rate is None or tzs_rate == 0:
        tzs_rate = 2650.0  # Hardcoded fallback if API returns garbage

    rows = []
    for cur in TRACKED:
        rate_per_usd = rates.get(cur)
        if rate_per_usd is None:
            # Skip currencies the API didn't return (keep old value in file)
            continue

        if rate_per_usd == 0:
            tzs_per_unit = 0.0
        else:
            # Cross rate: how many TZS per 1 unit of this currency
            tzs_per_unit = tzs_rate / rate_per_usd

        rows.append({
            "currency": cur,
            "rate_per_usd": f"{rate_per_usd:.2f}",
            "tzs_per_unit": f"{tzs_per_unit:.2f}",
            "updated": today_str,
        })

    tx_engine._atomic_csv_rewrite(
        FX_PATH,
        ["currency", "rate_per_usd", "tzs_per_unit", "updated"],
        rows,
    )

    new_content = FX_PATH.read_text(encoding="utf-8")
    return new_content != old_content


def update_history(rates: dict[str, float]) -> bool:
    """Append a daily row to fx_rates_history.csv if not yet present.

    The history file stores TZS-per-unit rates for each day (one row
    per day, keyed by YYYY-MM-DD). Used by the dashboard for historical
    currency conversion in reports and FX trend charts.
    """
    today_key = date.today().isoformat()
    tzs_rate = rates.get("TZS", 2650.0) or 2650.0

    # Compute TZS-per-unit for each currency
    new_values = {}
    for cur in HISTORY_CURRENCIES:
        rate_per_usd = rates.get(cur)
        if rate_per_usd and rate_per_usd > 0:
            new_values[cur] = f"{tzs_rate / rate_per_usd:.2f}"
        else:
            new_values[cur] = "0"

    # Read existing rows
    rows = []
    fieldnames = ["date"] + HISTORY_CURRENCIES
    found = False
    if FX_HISTORY_PATH.exists():
        with open(FX_HISTORY_PATH, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            if reader.fieldnames:
                fieldnames = reader.fieldnames
            for row in reader:
                if row["date"] == today_key:
                    # Update existing entry with fresh rates
                    for cur in HISTORY_CURRENCIES:
                        row[cur] = new_values[cur]
                    found = True
                rows.append(row)

    if not found:
        row = {"date": today_key}
        row.update(new_values)
        rows.append(row)

    tx_engine._atomic_csv_rewrite(FX_HISTORY_PATH, list(fieldnames), rows)

    action = "updated" if found else "added"
    print(f"  History: {action} {today_key}")
    return True


def main() -> int:
    """Fetch rates, update CSV, and commit if changed.

    Returns:
        0 on success (including 'no change'), 1 if API fetch failed.
    """
    now = datetime.now()
    ts = now.strftime("%Y-%m-%d %H:%M:%S")
    today_str = date.today().isoformat()

    print(f"[{ts}] cron_fx: fetching FX rates (BoT primary, er-api fallback)...")

    try:
        rates, source = fetch_rates()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, RuntimeError) as e:
        print(f"  [error] Both BoT and er-api failed: {e}")
        print("  Keeping existing fx_rates.csv unchanged.")
        return 1
    print(f"  source: {source}")

    # Log fetched rates
    for cur, rate in rates.items():
        if rate is not None:
            print(f"  {cur}/USD: {rate:.4f}")
        else:
            print(f"  {cur}/USD: (not available)")

    # Hold the cross-process tx_write_lock around every backup + write so
    # concurrent cron_commit / dashboard writes can't interleave with the
    # FX update. cron_metals does the same.
    with tx_engine.tx_write_lock():
        # Backup before any write — CLAUDE.md mandate: every data/*.csv
        # mutation gets a timestamped snapshot first. Failures here don't
        # abort the run (cron should still capture today's rates), but the
        # warning is logged.
        if FX_PATH.exists():
            try:
                backup.backup_file("fx_rates", FX_PATH)
            except Exception as e:
                print(f"  [warn] backup fx_rates failed: {e}", file=sys.stderr)
        if FX_HISTORY_PATH.exists():
            try:
                backup.backup_file("fx_rates_history", FX_HISTORY_PATH)
            except Exception as e:
                print(f"  [warn] backup fx_rates_history failed: {e}", file=sys.stderr)

        changed = write_fx_rates(rates, today_str)
        history_changed = update_history(rates)

    if not changed and not history_changed:
        print("  FX rates unchanged, no commit needed.")
        return 0

    print("  FX rates updated.")

    # Git commit
    files = ["data/fx_rates.csv"]
    if history_changed:
        files.append("data/fx_rates_history.csv")
    commit_msg = f"FX snapshot: {today_str}"
    success = tx_engine.git_commit(commit_msg, files=files)
    if success:
        print(f"  Committed: {commit_msg}")
    else:
        print("  [warn] Git commit failed (rates still saved locally).")

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] cron_fx ERROR: {e}", file=sys.stderr)
        sys.exit(2)
