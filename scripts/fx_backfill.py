#!/usr/bin/env python3
"""FX history backfill — Bank of Tanzania + Frankfurter.

Populates data/fx_rates_history.csv with daily TZS-per-unit rates for the
tracked currency set (EUR, USD, PLN, TRY) over a user-specified range.

Two sources:

* **Bank of Tanzania** (https://www.bot.go.tz/ExchangeRate/previous_rates) —
  publishes daily TZS-quoted rates for ~42 currencies including EUR/USD/TRY.
  Form-POST with anti-CSRF token; HTML table response, parsed with regex.

* **Frankfurter** (https://api.frankfurter.app) — ECB-published rates, free,
  no API key. Used for PLN since BoT does not publish it. PLN/TZS is
  derived as cross-rate: ``PLN/TZS = (EUR/TZS from BoT) / (EUR/PLN from
  Frankfurter)``.

The script is idempotent: existing dates in the CSV are kept; only missing
dates are filled. New rows are sorted by date and written atomically.

Usage:
    # auto-detect: backfill from (last CSV date + 1) to today
    python scripts/fx_backfill.py

    # explicit range (e.g. seed from 2018 to fill the gap before the
    # current CSV starts)
    python scripts/fx_backfill.py --since 2018-01-01 --until 2022-03-31

    # dry-run: show what would change without touching the CSV
    python scripts/fx_backfill.py --since 2024-01-01 --dry-run
"""

from __future__ import annotations

import argparse
import csv
import http.cookiejar
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import backup
import tx_engine

# ── Constants ───────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
FX_HISTORY_PATH = DATA_DIR / "fx_rates_history.csv"

HISTORY_CURRENCIES = ["EUR", "USD", "PLN", "TRY"]
CSV_FIELDS = ["date"] + HISTORY_CURRENCIES

# BoT reliably publishes EUR + USD across the full 2018+ range. TRY appears
# in current snapshots but was missing from BoT before ~2023, and PLN is
# never published. For both: fall back to Frankfurter (ECB) and cross-rate
# via BoT EUR/TZS — Frankfurter has both PLN and TRY back to 1999.
BOT_CURRENCIES = {"EUR", "USD"}
FRANKFURTER_CURRENCIES = ("PLN", "TRY")

BOT_URL = "https://www.bot.go.tz/ExchangeRate/previous_rates"
FRANKFURTER_URL = "https://api.frankfurter.app/{start}..{end}"

USER_AGENT = "Mozilla/5.0 (FinanceOS fx_backfill)"
HTTP_TIMEOUT = 30
CHUNK_DAYS = 30  # BoT POST size — keep responses under ~1k rows per call
RETRY_ATTEMPTS = 3
RETRY_BACKOFF = 2.0  # seconds, exponential

# ── BoT scraper ──────────────────────────────────────────────────────────────

_BOT_ROW_PATTERN = re.compile(
    r"<tr>\s*"
    r"<td[^>]*>\d+</td>\s*"
    r"<td[^>]*>([A-Z]{3})</td>\s*"
    r"<td[^>]*>([\d.]+)</td>\s*"  # buying
    r"<td[^>]*>([\d.]+)</td>\s*"  # selling
    r"<td[^>]*>([\d.]+)</td>\s*"  # mean
    r"<td[^>]*>([\w-]+)</td>",     # date e.g. 05-May-26
    re.MULTILINE,
)
_BOT_TOKEN_PATTERN = re.compile(
    r'name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"'
)


def _new_bot_session():
    """Build an opener that carries the ASP.NET session cookie + lang cookie.

    The previous_rates form requires both the cookie and the matching
    __RequestVerificationToken from the GET response — using the wrong pair
    yields a generic 200 with an empty table.
    """
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def _http_with_retry(opener, req: urllib.request.Request) -> bytes:
    last_err = None
    for attempt in range(RETRY_ATTEMPTS):
        try:
            return opener.open(req, timeout=HTTP_TIMEOUT).read()
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            if attempt < RETRY_ATTEMPTS - 1:
                time.sleep(RETRY_BACKOFF ** attempt)
    raise RuntimeError(f"HTTP failed after {RETRY_ATTEMPTS} attempts: {last_err}")


def _parse_bot_date(token: str) -> date:
    """Parse BoT's ``05-May-26`` format. Two-digit year is 20xx (2000+)."""
    return datetime.strptime(token, "%d-%b-%y").date()


def fetch_bot_chunk(start: date, end: date) -> dict[date, dict[str, float]]:
    """Fetch a single BoT date range. Returns {date: {currency: tzs_per_unit}}.

    Uses the ``Mean`` column from the BoT table, which is the midpoint
    between buying and selling and matches the historical convention in
    ``fx_rates_history.csv``.
    """
    opener = _new_bot_session()

    # Step 1: GET to grab CSRF token + session cookie
    get_req = urllib.request.Request(BOT_URL, headers={"User-Agent": USER_AGENT})
    html = _http_with_retry(opener, get_req).decode("utf-8", "ignore")
    m = _BOT_TOKEN_PATTERN.search(html)
    if not m:
        raise RuntimeError("BoT: __RequestVerificationToken not found on GET")
    token = m.group(1)

    # Step 2: POST with date range. BoT expects mm/dd/yyyy.
    payload = urllib.parse.urlencode(
        {
            "__RequestVerificationToken": token,
            "dateFrom": start.strftime("%m/%d/%Y"),
            "dateTo":   end.strftime("%m/%d/%Y"),
        }
    ).encode()
    post_req = urllib.request.Request(
        BOT_URL,
        data=payload,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    body = _http_with_retry(opener, post_req).decode("utf-8", "ignore")

    out: dict[date, dict[str, float]] = {}
    for cur, _buy, _sell, mean, dtok in _BOT_ROW_PATTERN.findall(body):
        if cur not in BOT_CURRENCIES:
            continue
        try:
            d = _parse_bot_date(dtok)
            v = float(mean)
        except ValueError:
            continue
        out.setdefault(d, {})[cur] = v
    return out


def fetch_bot_range(start: date, end: date, verbose: bool = False) -> dict[date, dict[str, float]]:
    """Fetch BoT data over an arbitrary range, chunking into 30-day windows."""
    out: dict[date, dict[str, float]] = {}
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=CHUNK_DAYS - 1), end)
        if verbose:
            print(f"  [bot] {cursor} .. {chunk_end}")
        chunk = fetch_bot_chunk(cursor, chunk_end)
        for d, row in chunk.items():
            out.setdefault(d, {}).update(row)
        cursor = chunk_end + timedelta(days=1)
    return out


# ── Frankfurter (PLN/TRY via cross-rate through EUR) ─────────────────────────

def fetch_frankfurter_eur_to(targets: tuple[str, ...], start: date, end: date) -> dict[date, dict[str, float]]:
    """Fetch ECB EUR-base rates for one or more currencies in a single call.

    Returns ``{date: {currency: foreign_per_EUR}}``.
    """
    if not targets:
        return {}
    url = (
        FRANKFURTER_URL.format(start=start.isoformat(), end=end.isoformat())
        + "?from=EUR&to=" + ",".join(targets)
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    raw = _http_with_retry(urllib.request.build_opener(), req)
    data = json.loads(raw)
    out: dict[date, dict[str, float]] = {}
    for d_str, rates in (data.get("rates") or {}).items():
        try:
            d = datetime.strptime(d_str, "%Y-%m-%d").date()
        except ValueError:
            continue
        bucket: dict[str, float] = {}
        for cur in targets:
            try:
                bucket[cur] = float(rates[cur])
            except (KeyError, TypeError, ValueError):
                continue
        if bucket:
            out[d] = bucket
    return out


def derive_via_eur_cross_rate(
    frankfurter_eur_to: dict[date, dict[str, float]],
    bot_eur_tzs: dict[date, dict[str, float]],
    targets: tuple[str, ...],
    verbose: bool = False,
) -> dict[date, dict[str, float]]:
    """Compute TZS-per-target = (TZS/EUR from BoT) / (target/EUR from Frankfurter).

    Frankfurter publishes ECB rates only on weekdays. BoT publishes daily
    (incl. weekends, holding the previous published rate). Where Frankfurter
    has no row for a date, fall back to the last known target/EUR pair.
    """
    out: dict[date, dict[str, float]] = {}
    sorted_fr_dates = sorted(frankfurter_eur_to)
    last_seen: dict[str, float] = {}
    fr_idx = 0
    for d in sorted(bot_eur_tzs):
        eur_tzs = bot_eur_tzs[d].get("EUR")
        if eur_tzs is None:
            continue
        while fr_idx < len(sorted_fr_dates) and sorted_fr_dates[fr_idx] <= d:
            last_seen.update(frankfurter_eur_to[sorted_fr_dates[fr_idx]])
            fr_idx += 1
        bucket: dict[str, float] = {}
        for cur in targets:
            rate = last_seen.get(cur)
            if rate is None:
                if verbose:
                    print(f"  [{cur.lower()}] {d}: no Frankfurter data yet, skip")
                continue
            bucket[cur] = round(eur_tzs / rate, 4)
        if bucket:
            out[d] = bucket
    return out


# ── CSV merge ────────────────────────────────────────────────────────────────

def _read_existing(path: Path) -> dict[date, dict[str, str]]:
    if not path.exists():
        return {}
    out: dict[date, dict[str, str]] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                d = datetime.strptime(row["date"], "%Y-%m-%d").date()
            except (ValueError, KeyError):
                continue
            out[d] = {k: row.get(k, "") for k in HISTORY_CURRENCIES}
    return out


def merge(
    existing: dict[date, dict[str, str]],
    bot: dict[date, dict[str, float]],
    cross: dict[date, dict[str, float]],
) -> tuple[dict[date, dict[str, str]], int, int]:
    """Merge new BoT + cross-rate data into the existing rows.

    Returns (merged, new_dates, updated_dates). Existing values are never
    overwritten; the script only fills in missing dates and missing cells
    on existing dates (single source of truth wins).
    """
    merged = {d: dict(row) for d, row in existing.items()}
    new_dates = 0
    updated_dates = 0
    all_dates = set(bot) | set(cross)
    for d in all_dates:
        row = merged.setdefault(d, {k: "" for k in HISTORY_CURRENCIES})
        before = dict(row)
        for cur in BOT_CURRENCIES:
            v = bot.get(d, {}).get(cur)
            if v is not None and not row.get(cur):
                row[cur] = f"{v:.4f}"
        for cur, v in (cross.get(d) or {}).items():
            if cur in HISTORY_CURRENCIES and not row.get(cur):
                row[cur] = f"{v:.4f}"
        if d not in existing:
            new_dates += 1
        elif row != before:
            updated_dates += 1
    return merged, new_dates, updated_dates


def write_csv(path: Path, merged: dict[date, dict[str, str]]) -> None:
    rows = [
        {"date": d.isoformat(), **merged[d]}
        for d in sorted(merged)
    ]
    tx_engine._atomic_csv_rewrite(path, CSV_FIELDS, rows)


# ── CLI ──────────────────────────────────────────────────────────────────────

def _parse_iso(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def _detect_since(existing: dict[date, dict[str, str]]) -> date:
    if not existing:
        return date(2018, 1, 1)
    return max(existing) + timedelta(days=1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", type=_parse_iso, help="Start date YYYY-MM-DD (default: last CSV date + 1)")
    parser.add_argument("--until", type=_parse_iso, help="End date YYYY-MM-DD (default: today)")
    parser.add_argument("--dry-run", action="store_true", help="Do not write CSV; just report deltas")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--no-frankfurter", action="store_true", help="Skip Frankfurter fetch (BoT only)")
    args = parser.parse_args()

    existing = _read_existing(FX_HISTORY_PATH)
    today = date.today()
    since = args.since or _detect_since(existing)
    until = args.until or today
    if since > until:
        print(f"[ok] nothing to do — since={since} > until={until}")
        return 0

    print(f"FX backfill: {since} .. {until}  ({(until - since).days + 1} days)")
    print(f"  existing rows: {len(existing)}")

    print(f"[1/3] BoT ({', '.join(sorted(BOT_CURRENCIES))})...")
    bot_data = fetch_bot_range(since, until, verbose=args.verbose)
    print(f"  fetched {len(bot_data)} BoT dates")

    cross_data: dict[date, dict[str, float]] = {}
    if not args.no_frankfurter:
        print(f"[2/3] Frankfurter EUR -> {', '.join(FRANKFURTER_CURRENCIES)} + cross-rate to TZS...")
        try:
            fr = fetch_frankfurter_eur_to(FRANKFURTER_CURRENCIES, since, until)
            cross_data = derive_via_eur_cross_rate(fr, bot_data, FRANKFURTER_CURRENCIES, verbose=args.verbose)
            filled = sum(len(v) for v in cross_data.values())
            print(f"  derived {filled} cross-rate cells across {len(cross_data)} dates from {len(fr)} Frankfurter rows")
        except Exception as e:
            print(f"  [warn] Frankfurter failed: {e} - continuing with BoT only")

    print("[3/3] Merge + write...")
    merged, new_dates, updated_dates = merge(existing, bot_data, cross_data)
    print(f"  +{new_dates} new dates, ~{updated_dates} dates with new values, {len(merged)} total")

    if args.dry_run:
        print("[dry-run] no files written")
        return 0

    if new_dates == 0 and updated_dates == 0:
        print("[ok] CSV already up to date")
        return 0

    try:
        backup.backup_file("fx_rates_history", FX_HISTORY_PATH)
    except Exception as e:
        print(f"  [warn] backup failed: {e}")

    write_csv(FX_HISTORY_PATH, merged)
    print(f"[ok] wrote {FX_HISTORY_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
