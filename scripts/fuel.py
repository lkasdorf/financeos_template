"""Fuel logging engine — vehicle master data + tanking entries.

Phase 1a layer: CSV CRUD for vehicles.csv and fuel_log.csv plus
two-way sync with transactions.csv. Each fuel entry generates one
expense TX (and a reimbursement counter-entry if booked on a
pass-through account). Deletes cascade via the stored tx_import_id.

Data files:
    data/vehicles.csv  — vehicle stammdaten (one row per car)
    data/fuel_log.csv  — fuel entries (one row per tanking)

CLI:
    python scripts/fuel.py vehicles                        # list vehicles
    python scripts/fuel.py list                            # list fuel entries
    python scripts/fuel.py add [--vehicle ...] [--date ...] # add a tanking
    python scripts/fuel.py delete <fuel_id>                # delete + cascade

Called by:
    - serve.py once /api/fuel/* endpoints land in Phase 2
    - Claude Code CLI ad-hoc for backfills
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from datetime import datetime
from pathlib import Path

# Local sibling modules — tx_engine carries the shared TX writer + locking.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import tx_engine  # noqa: E402
from backup import BACKUP_TARGETS, backup_file  # noqa: E402

# ── Path Constants ──────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
VEHICLES_CSV = DATA_DIR / "vehicles.csv"
FUEL_LOG_CSV = DATA_DIR / "fuel_log.csv"
# Recon-dismissals CSV: one row per TX import_id the user explicitly
# marked as "not vehicle fuel" (e.g. lawn-mower petrol). The reconcile()
# step skips these so the warning banner stays focused on real misses.
FUEL_RECON_DISMISSED_CSV = DATA_DIR / "fuel_recon_dismissed.csv"
RECON_DISMISSED_COLUMNS = ["import_id", "dismissed_at", "reason"]

# ── Schemas ─────────────────────────────────────────────────────────────────

# Canonical column order for vehicles.csv. Must match the on-disk header
# so DictWriter output stays stable across rewrites.
VEHICLE_COLUMNS = [
    "vehicle_id", "name", "license_plate", "currency",
    "default_account", "default_payee", "default_category",
    "tracking_start_date",
    # Optional ISO date marking when this vehicle was sold / replaced.
    # Empty = "currently owned". `tracking_start_date` already covers the
    # acquisition side (doubles as ownership-start). UI uses end_date to
    # render archived-style pills and to clamp report periods.
    "end_date",
    "active", "notes",
]

# Canonical column order for fuel_log.csv. The `account` field is
# denormalized (always the actual account used) so historical entries
# do not drift if the vehicle's default_account changes later.
# `tx_import_id` links the entry to the expense row in transactions.csv.
FUEL_LOG_COLUMNS = [
    "fuel_id", "date", "vehicle_id", "odometer_km", "liters",
    "total_cost", "currency", "station", "full_tank", "remarks",
    "account", "tx_import_id",
]


# ── Free-Text Parser ────────────────────────────────────────────────────────

# Tokens recognised by parse_fuel_freetext, in detection order:
#   * "35.52L" / "35.5l"       → liters (float, must end in L)
#   * "key=value"              → named override (account, date, station, vehicle, remarks)
#   * "partial" / "notfull"    → full_tank=False
#   * "YYYY-MM-DD"             → date override (positional)
#   * Any other token          → positional candidate for cost / station / odometer
#
# Among the positional candidates, the LAST integer-looking token wins as
# the odometer (6-digit km readings are always last in the
# user's natural phrasing) and the FIRST numeric token (with optional
# k/m suffix) wins as cost. Whatever remains is joined to a station name.
_LITERS_RE = re.compile(r"^([\d.]+)\s*l$", re.IGNORECASE)
_FLAG_RE = re.compile(r"^([a-z_]+)=(.+)$", re.IGNORECASE)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PURE_INT_RE = re.compile(r"^\d+$")
_COST_RE = re.compile(r"^[\d.,]+[km]?$", re.IGNORECASE)


def _parse_amount_kmsuffix(token: str) -> float:
    """Parse '150k' / '2.5m' / '135686' / '135,686' to a float.

    Mirrors tx_engine.parse_amount_input behavior so the fuel CLI accepts
    the same shorthand the user is already used to from TX inputs.
    """
    text = token.strip().lower().replace(",", "")
    if text.endswith("k"):
        return float(text[:-1]) * 1_000
    if text.endswith("m"):
        return float(text[:-1]) * 1_000_000
    return float(text)


def parse_fuel_freetext(
    text: str, today: str,
    vehicles: dict[str, dict] | None = None,
    accounts: dict[str, dict] | None = None,
) -> dict:
    """Parse 'fuel 35.52L 135686 puma 173261' style input into add_fuel_entry kwargs.

    Strips an optional ``TX`` / ``fuel`` prefix, then walks the tokens to
    extract liters / cost / station / odometer plus any named overrides.
    Defaults are resolved against the supplied vehicle map (or freshly
    loaded if omitted): the sole active vehicle picks the default account,
    payee, and currency. Today's date is used unless overridden.

    Returns a dict ready to splat into add_fuel_entry().

    Raises:
        ValueError: on ambiguous or missing required tokens.
    """
    if vehicles is None:
        vehicles = load_vehicles()
    if accounts is None:
        accounts = tx_engine.load_accounts()

    s = text.strip()
    s = re.sub(r"^(?:tx\s+)?fuel\s+", "", s, flags=re.IGNORECASE).strip()
    if not s:
        raise ValueError("Empty fuel input — try 'fuel 35.52L 135686 173261'")

    flags: dict = {}
    rest: list[str] = []
    liters: float | None = None

    for tok in s.split():
        m = _FLAG_RE.match(tok)
        if m:
            flags[m.group(1).lower()] = m.group(2)
            continue
        low = tok.lower()
        if low in ("partial", "notfull", "no-full"):
            flags["full_tank"] = False
            continue
        if _DATE_RE.match(tok):
            flags["date"] = tok
            continue
        m = _LITERS_RE.match(tok)
        if m and liters is None:
            try:
                liters = float(m.group(1))
                continue
            except ValueError:
                pass
        rest.append(tok)

    # Odometer = last pure-integer (no k/m suffix) — typical km readings
    # like 173261 always trail in natural phrasing.
    odometer: int | None = None
    for i in range(len(rest) - 1, -1, -1):
        cleaned = rest[i].replace(",", "")
        if _PURE_INT_RE.match(cleaned):
            odometer = int(cleaned)
            del rest[i]
            break

    # Cost = first numeric token (k/m allowed, since 150k is common shorthand)
    cost: float | None = None
    for i, tok in enumerate(rest):
        if _COST_RE.match(tok):
            try:
                cost = _parse_amount_kmsuffix(tok)
                del rest[i]
                break
            except ValueError:
                pass

    station = " ".join(rest).strip() if rest else None

    # Resolve vehicle: prefer explicit flag, fall back to sole active vehicle
    vehicle_id = flags.get("vehicle")
    if not vehicle_id:
        actives = [v for v in vehicles.values() if v.get("active", "").lower() == "true"]
        if len(actives) == 1:
            vehicle_id = actives[0]["vehicle_id"]
        else:
            raise ValueError(
                "Vehicle ambiguous — pass vehicle=v-XXX or have exactly one active vehicle"
            )
    if vehicle_id not in vehicles:
        raise ValueError(f"Unknown vehicle: '{vehicle_id}'")
    vehicle = vehicles[vehicle_id]

    if liters is None:
        raise ValueError("Liters missing — append L, e.g. '35.5L'")
    if cost is None:
        raise ValueError("Cost missing — e.g. '135686' or '150k'")
    if odometer is None:
        raise ValueError("Odometer missing — e.g. '173261'")

    return {
        "vehicle_id": vehicle_id,
        "date": flags.get("date") or today,
        "odometer_km": float(odometer),
        "liters": liters,
        "total_cost": cost,
        "station": (flags.get("station") or station or vehicle.get("default_payee", "")).strip(),
        "full_tank": flags.get("full_tank", True),
        "account": flags.get("account") or vehicle.get("default_account"),
        "remarks": flags.get("remarks", ""),
    }


# ── Vehicle CRUD ────────────────────────────────────────────────────────────

def load_vehicles() -> dict[str, dict]:
    """Load vehicles.csv as a dict keyed by vehicle_id (e.g. 'v-001')."""
    if not VEHICLES_CSV.exists():
        return {}
    out = {}
    with open(VEHICLES_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            out[row["vehicle_id"]] = row
    return out


def get_active_vehicle() -> dict | None:
    """Return the single active vehicle if exactly one is active, else None.

    Lets the CLI default --vehicle when only one car is in use.
    """
    actives = [
        v for v in load_vehicles().values()
        if v.get("active", "").lower() == "true"
    ]
    return actives[0] if len(actives) == 1 else None


# ── Fuel Log CRUD ───────────────────────────────────────────────────────────

def load_fuel_log() -> list[dict]:
    """Load all fuel_log.csv rows in insertion order."""
    if not FUEL_LOG_CSV.exists():
        return []
    with open(FUEL_LOG_CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def next_fuel_id() -> str:
    """Return the next sequential fuel_id, zero-padded to 4 digits."""
    rows = load_fuel_log()
    max_n = 0
    for r in rows:
        fid = r.get("fuel_id", "")
        if fid.startswith("fuel-"):
            try:
                n = int(fid.split("-", 1)[1])
                max_n = max(max_n, n)
            except ValueError:
                pass
    return f"fuel-{max_n + 1:04d}"


def write_fuel_log(rows: list[dict]) -> None:
    """Rewrite fuel_log.csv from scratch with the given rows."""
    with open(FUEL_LOG_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FUEL_LOG_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({c: row.get(c, "") for c in FUEL_LOG_COLUMNS})


def _next_vehicle_id(existing: dict[str, dict]) -> str:
    """Return the next free `v-NNN` id, scanning existing vehicle_ids."""
    max_n = 0
    for vid in existing.keys():
        if vid.startswith("v-"):
            try:
                max_n = max(max_n, int(vid[2:]))
            except ValueError:
                pass
    return f"v-{max_n + 1:03d}"


def save_vehicles(vehicles_dict: dict[str, dict]) -> None:
    """Atomically rewrite vehicles.csv from a {vehicle_id: row} dict.

    Uses tx_engine._atomic_csv_rewrite so a crash mid-write cannot leave
    a truncated file (matches the data/ atomic-write rule). Callers should
    always pass the full vehicle set, not a delta.
    """
    import tx_engine
    rows = [
        {col: v.get(col, "") for col in VEHICLE_COLUMNS}
        for v in vehicles_dict.values()
    ]
    tx_engine._atomic_csv_rewrite(VEHICLES_CSV, VEHICLE_COLUMNS, rows)


def add_vehicle(row: dict) -> str:
    """Append a new vehicle to vehicles.csv. Returns the assigned vehicle_id.

    Auto-generates `vehicle_id` (v-NNN) if not provided. Validates that the
    minimum required fields (name, currency) are present and non-empty —
    optional fields default to "".
    """
    name = (row.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    currency = (row.get("currency") or "").strip()
    if not currency:
        raise ValueError("currency is required")

    vehicles = load_vehicles()
    vid = (row.get("vehicle_id") or "").strip() or _next_vehicle_id(vehicles)
    if vid in vehicles:
        raise ValueError(f"vehicle_id '{vid}' already exists")

    new_row = {}
    for col in VEHICLE_COLUMNS:
        v = row.get(col, "")
        new_row[col] = v.strip() if isinstance(v, str) else (v or "")
    new_row["vehicle_id"] = vid
    new_row["name"] = name
    new_row["currency"] = currency
    if not new_row.get("active"):
        new_row["active"] = "true"
    vehicles[vid] = new_row
    save_vehicles(vehicles)
    return vid


def update_vehicle(vehicle_id: str, updates: dict) -> bool:
    """Patch a vehicle row in place. Returns True if found, False otherwise."""
    vehicles = load_vehicles()
    if vehicle_id not in vehicles:
        return False
    row = vehicles[vehicle_id]
    for col in VEHICLE_COLUMNS:
        if col == "vehicle_id":
            continue
        if col in updates:
            val = updates[col]
            row[col] = val.strip() if isinstance(val, str) else (val or "")
    vehicles[vehicle_id] = row
    save_vehicles(vehicles)
    return True


def delete_vehicle(vehicle_id: str) -> bool:
    """Remove a vehicle from vehicles.csv. Returns True if found, False otherwise.

    Does NOT cascade-delete fuel_log entries — those keep the orphan
    `vehicle_id` reference so historical aggregates stay intact.
    """
    vehicles = load_vehicles()
    if vehicle_id not in vehicles:
        return False
    del vehicles[vehicle_id]
    save_vehicles(vehicles)
    return True


def append_fuel_log(row: dict) -> None:
    """Append a single fuel entry to fuel_log.csv (creates header if missing)."""
    new_file = not FUEL_LOG_CSV.exists() or FUEL_LOG_CSV.stat().st_size == 0
    with open(FUEL_LOG_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FUEL_LOG_COLUMNS)
        if new_file:
            writer.writeheader()
        writer.writerow({c: row.get(c, "") for c in FUEL_LOG_COLUMNS})


# ── Computed Metrics ────────────────────────────────────────────────────────

def enrich_fuel_log(rows: list[dict]) -> list[dict]:
    """Add per-entry derived metrics (distance, consume, price/L, price/km).

    Metrics that depend on the previous tanking (distance, consume, days)
    are computed inside each vehicle's timeline — sorting by date guarantees
    the lookup walks forward. The very first entry per vehicle has no
    previous baseline, so distance/consume/days_between come back as None.

    Mutates copies; the original rows list is left untouched. Returned
    dicts contain everything the dashboard needs to render without doing
    any of the timeline math itself.
    """
    by_vehicle: dict[str, list[dict]] = {}
    for r in rows:
        # Make a shallow copy so the caller's list stays as-is
        out = dict(r)
        by_vehicle.setdefault(out.get("vehicle_id", ""), []).append(out)

    enriched: list[dict] = []
    for vehicle_id, items in by_vehicle.items():
        items.sort(key=lambda r: (r.get("date", ""), r.get("fuel_id", "")))
        prev = None
        for r in items:
            try:
                odo = float(r.get("odometer_km") or 0)
                liters = float(r.get("liters") or 0)
                cost = float(r.get("total_cost") or 0)
            except ValueError:
                odo = liters = cost = 0.0

            distance = None
            days_between = None
            consume = None
            price_per_km = None
            price_per_liter = (cost / liters) if liters > 0 else None

            if prev is not None:
                try:
                    prev_odo = float(prev.get("odometer_km") or 0)
                    distance = odo - prev_odo if odo > prev_odo else None
                except ValueError:
                    distance = None
                # Days between only when both dates parse cleanly
                try:
                    d_now = datetime.strptime(r["date"], "%Y-%m-%d").date()
                    d_prev = datetime.strptime(prev["date"], "%Y-%m-%d").date()
                    days_between = (d_now - d_prev).days
                except (ValueError, KeyError):
                    days_between = None
                # Consume + price/km only meaningful on a full-tank entry —
                # partial fills break the litres-per-distance assumption.
                if (
                    distance and distance > 0
                    and r.get("full_tank", "").lower() == "true"
                ):
                    consume = liters / distance * 100
                    price_per_km = cost / distance

            r["distance_km"] = distance
            r["days_between"] = days_between
            r["consume_l_100km"] = consume
            r["price_per_liter"] = price_per_liter
            r["price_per_km"] = price_per_km
            enriched.append(r)
            prev = r
    return enriched


def fuel_summary(enriched: list[dict]) -> dict:
    """Roll up enriched fuel rows into headline numbers for KPI tiles.

    Averages weight by litres (price/L) or distance (consume) rather than
    arithmetic mean, so a tiny partial fill cannot distort the average.
    """
    n = len(enriched)
    total_liters = sum(float(r.get("liters") or 0) for r in enriched)
    total_cost = sum(float(r.get("total_cost") or 0) for r in enriched)
    total_distance = sum(
        r["distance_km"] for r in enriched
        if r.get("distance_km") is not None
    )
    # Litre-weighted average price/L = total cost / total litres
    avg_price_per_liter = (total_cost / total_liters) if total_liters > 0 else None
    # Distance-weighted consumption: only litres tied to full-tank distance
    full_tank_distance = sum(
        r["distance_km"] for r in enriched
        if r.get("consume_l_100km") is not None and r.get("distance_km")
    )
    full_tank_liters = sum(
        float(r.get("liters") or 0) for r in enriched
        if r.get("consume_l_100km") is not None
    )
    avg_consume = (
        full_tank_liters / full_tank_distance * 100
        if full_tank_distance > 0 else None
    )
    avg_price_per_km = (
        total_cost / total_distance if total_distance > 0 else None
    )
    return {
        "n_entries": n,
        "total_liters": total_liters,
        "total_cost": total_cost,
        "total_distance_km": total_distance,
        "avg_price_per_liter": avg_price_per_liter,
        "avg_consume_l_100km": avg_consume,
        "avg_price_per_km": avg_price_per_km,
    }


# ── Reconciliation ──────────────────────────────────────────────────────────

def load_dismissed_recon() -> dict[str, dict]:
    """Load fuel_recon_dismissed.csv as dict keyed by import_id.

    Empty dict when the file does not exist (first-run state). Tolerates
    blank-but-existing files so a user can manually clear it without
    triggering parser errors.
    """
    if not FUEL_RECON_DISMISSED_CSV.exists():
        return {}
    out: dict[str, dict] = {}
    with open(FUEL_RECON_DISMISSED_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            iid = (row.get("import_id") or "").strip()
            if iid:
                out[iid] = row
    return out


def add_dismissed_recon(import_id: str, reason: str = "") -> None:
    """Mark an unlinked TX as 'not vehicle fuel' so reconcile() ignores it.

    Used for off-vehicle fuel expenses (lawn-mower, generator, jerry-cans
    for someone else) that share the Automobile:Petrol category but have
    no business living in the fuel log.
    """
    new_file = not FUEL_RECON_DISMISSED_CSV.exists() or FUEL_RECON_DISMISSED_CSV.stat().st_size == 0
    backup_file("transactions", BACKUP_TARGETS["transactions"])  # safety, no-op if file missing
    with open(FUEL_RECON_DISMISSED_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=RECON_DISMISSED_COLUMNS)
        if new_file:
            writer.writeheader()
        writer.writerow({
            "import_id": import_id,
            "dismissed_at": datetime.now().date().isoformat(),
            "reason": reason or "",
        })


def remove_dismissed_recon(import_id: str) -> bool:
    """Un-dismiss a previously dismissed TX. Returns True on success."""
    rows = []
    found = False
    if not FUEL_RECON_DISMISSED_CSV.exists():
        return False
    with open(FUEL_RECON_DISMISSED_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if (row.get("import_id") or "").strip() == import_id:
                found = True
                continue
            rows.append(row)
    if not found:
        return False
    with open(FUEL_RECON_DISMISSED_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=RECON_DISMISSED_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({c: row.get(c, "") for c in RECON_DISMISSED_COLUMNS})
    return True


def reconcile(
    fuel_entries: list[dict] | None = None,
    vehicles: dict[str, dict] | None = None,
) -> dict:
    """Cross-check fuel_log.csv against transactions.csv.

    Three classes of finding:

    * ``unlinked_fuel_txs``: expense TXs in a fuel category (any active
      vehicle's default_category) that no fuel_log row references — the
      user booked a fuel TX manually (or via the dashboard Add-TX flow)
      without going through the fuel layer, so consumption metrics
      don't include it. Suggests running ``fuel_import.py --apply`` or
      adding manually via the Vehicles modal.
    * ``orphaned_log_entries``: fuel_log rows whose ``tx_import_id`` points
      to a TX that no longer exists. Happens when the user deletes a TX
      directly in the Transactions page without going through the
      Vehicles cascade-delete. Indicates the link is broken; data is
      stale until cleaned up.
    * ``duplicate_links``: two fuel_log rows referencing the same
      ``tx_import_id``. Should never happen in normal use; would mean
      the import or the manual-add path miscounted.

    Returns dict with the three lists plus a ``has_findings`` boolean
    so callers can short-circuit when everything is clean.
    """
    if fuel_entries is None:
        fuel_entries = load_fuel_log()
    if vehicles is None:
        vehicles = load_vehicles()

    fuel_categories = {
        v.get("default_category", "").strip()
        for v in vehicles.values()
        if v.get("active", "").lower() == "true"
    }
    fuel_categories.discard("")
    if not fuel_categories:
        # Without an active vehicle, there's no canonical fuel category
        # to test against; emit an empty report rather than guessing.
        return {
            "unlinked_fuel_txs": [],
            "orphaned_log_entries": [],
            "duplicate_links": [],
            "dismissed_count": 0,
            "dismissed_entries": [],
            "has_findings": False,
        }

    # Earliest tracking_start_date across active vehicles is the global
    # cutoff: TXs before any vehicle existed cannot be a vehicle fuel
    # purchase, so they shouldn't surface as "missing log entries".
    start_dates = [
        v.get("tracking_start_date", "").strip()
        for v in vehicles.values()
        if v.get("active", "").lower() == "true"
    ]
    start_dates = [d for d in start_dates if d]
    earliest_start = min(start_dates) if start_dates else ""
    dismissed = load_dismissed_recon()

    # Build the TX lookup once; iterate fuel_log + transactions in O(n).
    tx_by_id: dict[str, dict] = {}
    fuel_txs: list[dict] = []
    tx_path = DATA_DIR / "transactions.csv"
    if tx_path.exists():
        with open(tx_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                tx_by_id[row["import_id"]] = row
                if row.get("type") == "expense" and row.get("category", "") in fuel_categories:
                    fuel_txs.append(row)

    linked_ids: set[str] = set()
    duplicate_links: list[dict] = []
    orphaned_log_entries: list[dict] = []
    for row in fuel_entries:
        tid = (row.get("tx_import_id") or "").strip()
        if not tid:
            continue
        if tid in linked_ids:
            duplicate_links.append({
                "fuel_id": row.get("fuel_id", ""),
                "tx_import_id": tid,
                "date": row.get("date", ""),
            })
        linked_ids.add(tid)
        if tid not in tx_by_id:
            orphaned_log_entries.append({
                "fuel_id": row.get("fuel_id", ""),
                "tx_import_id": tid,
                "date": row.get("date", ""),
                "station": row.get("station", ""),
                "total_cost": row.get("total_cost", ""),
            })

    unlinked_fuel_txs = [
        {
            "import_id": t["import_id"],
            "date": t["date"],
            "amount": t["amount"],
            "payee": t.get("payee", ""),
            "account": t.get("account", ""),
            "category": t.get("category", ""),
        }
        for t in fuel_txs
        if t["import_id"] not in linked_ids
        and t["import_id"] not in dismissed
        and (not earliest_start or t.get("date", "") >= earliest_start)
    ]
    # Sort newest-first so the dashboard banner can show the most
    # recent offender as the headline example without callers re-sorting.
    unlinked_fuel_txs.sort(key=lambda r: r.get("date", ""), reverse=True)
    orphaned_log_entries.sort(key=lambda r: r.get("date", ""), reverse=True)

    # Enrich dismissed entries with their TX details (joined from the
    # tx_by_id lookup we already built) so the UI can render a meaningful
    # restore-list — bare import_id alone is useless for the user.
    dismissed_entries = []
    for import_id, meta in dismissed.items():
        tx = tx_by_id.get(import_id, {})
        dismissed_entries.append({
            "import_id": import_id,
            "dismissed_at": meta.get("dismissed_at", ""),
            "reason": meta.get("reason", ""),
            "date": tx.get("date", ""),
            "amount": tx.get("amount", ""),
            "payee": tx.get("payee", ""),
            "account": tx.get("account", ""),
            "category": tx.get("category", ""),
            "tx_exists": bool(tx),
        })
    # Newest dismissals first so the user sees recent decisions on top.
    dismissed_entries.sort(key=lambda r: r.get("dismissed_at", ""), reverse=True)

    has_findings = bool(unlinked_fuel_txs or orphaned_log_entries or duplicate_links)
    return {
        "unlinked_fuel_txs": unlinked_fuel_txs,
        "orphaned_log_entries": orphaned_log_entries,
        "duplicate_links": duplicate_links,
        "dismissed_count": len(dismissed),
        "dismissed_entries": dismissed_entries,
        "earliest_tracking_start": earliest_start,
        "has_findings": has_findings,
    }


# ── TX-Sync ─────────────────────────────────────────────────────────────────

def build_expense_tx(fuel_row: dict, vehicle: dict) -> dict:
    """Build the expense TX dict for a fuel entry.

    The note field embeds the odometer reading and litres so the TX is
    self-documenting in transactions.csv without needing a fuel_log lookup.
    """
    note_parts = [
        f"Tankung {vehicle['name']}",
        f"odometer {fuel_row['odometer_km']} km",
        f"{fuel_row['liters']} L",
    ]
    if fuel_row.get("full_tank", "").lower() == "true":
        note_parts.append("full")
    if fuel_row.get("remarks"):
        note_parts.append(fuel_row["remarks"])
    note = " | ".join(note_parts)

    # Auto-tags rely on standard rules (e.g. kft → BUSINESS_<entity>). No
    # explicit tags from the fuel layer in Phase 1a; vehicle-level tags
    # may be added in a later phase if multi-vehicle filtering is needed.
    tags = ";".join(
        tx_engine.apply_auto_tags(fuel_row["account"], fuel_row["station"], [])
    )

    return {
        "date": fuel_row["date"],
        "account": fuel_row["account"],
        "type": "expense",
        "amount": float(fuel_row["total_cost"]),
        "currency": fuel_row["currency"],
        "payee": fuel_row["station"],
        "category": vehicle.get("default_category", "Automobile:Petrol"),
        "note": note,
        "raw_note": "",
        "transfer_to_account": "",
        "transfer_to_amount": "",
        "receipt_group": "",
        "receipt_url": "",
        "tags": tags,
        "third_party_id": "",
    }


def add_fuel_entry(
    *, date: str, vehicle_id: str, odometer_km: float, liters: float,
    total_cost: float, station: str, full_tank: bool,
    account: str | None = None, remarks: str = "",
) -> dict:
    """Create a fuel entry and the linked transaction(s).

    Order of operations:
        1. Validate inputs against vehicles.csv and accounts.csv.
        2. Backup transactions.csv and fuel_log.csv (FinanceOS hard rule).
        3. Build expense TX (+ pass-through reimbursement if applicable).
        4. Append TX rows first; if that fails, no fuel row is written.
        5. Append the fuel entry with the expense import_id linked back.

    Returns:
        Dict with fuel_id, tx_import_id, and reimburse_import_id (or None).

    Raises:
        ValueError: on validation errors (unknown vehicle/account, etc.).
    """
    vehicles = load_vehicles()
    if vehicle_id not in vehicles:
        raise ValueError(f"Unknown vehicle: '{vehicle_id}'")
    vehicle = vehicles[vehicle_id]

    account_alias = (account or vehicle.get("default_account", "")).strip()
    accounts = tx_engine.load_accounts()
    if account_alias not in accounts:
        raise ValueError(f"Unknown account: '{account_alias}'")
    acc = accounts[account_alias]

    currency = acc.get("currency") or vehicle.get("currency", "TZS")

    fuel_id = next_fuel_id()
    fuel_row = {
        "fuel_id": fuel_id,
        "date": date,
        "vehicle_id": vehicle_id,
        # Odometer is stored as integer km — fractional km readings are not
        # meaningful for fuel-economy reporting and would break the heat-map
        # color thresholds in the dashboard later.
        "odometer_km": f"{float(odometer_km):.0f}",
        "liters": f"{float(liters):.2f}",
        "total_cost": f"{float(total_cost):.2f}",
        "currency": currency,
        "station": station,
        "full_tank": "true" if full_tank else "false",
        "remarks": remarks,
        "account": account_alias,
        "tx_import_id": "",
    }

    # Backups before any write — FinanceOS hard rule
    backup_file("transactions", BACKUP_TARGETS["transactions"])
    if FUEL_LOG_CSV.exists():
        backup_file("fuel_log", FUEL_LOG_CSV)

    # Build expense + (optional) reimbursement TXs
    existing_ids = tx_engine.load_existing_import_ids()
    expense_line = build_expense_tx(fuel_row, vehicle)
    expense_line["import_id"] = tx_engine.generate_import_id(
        expense_line["date"], expense_line["account"],
        float(expense_line["amount"]), expense_line["payee"],
        expense_line["category"], expense_line["note"], existing_ids,
    )
    existing_ids.add(expense_line["import_id"])

    lines_to_write = [expense_line]
    reimb_id = None
    if acc.get("type") == "pass_through":
        reimb_line = tx_engine.generate_pass_through_line(
            expense_line, acc, existing_ids,
        )
        if reimb_line is not None:
            existing_ids.add(reimb_line["import_id"])
            reimb_id = reimb_line["import_id"]
            lines_to_write.append(reimb_line)

    # Persist TX(s) first; if this fails, no fuel row is written.
    tx_engine.append_transactions(lines_to_write)

    # Link expense TX back into fuel row, then persist
    fuel_row["tx_import_id"] = expense_line["import_id"]
    append_fuel_log(fuel_row)

    return {
        "fuel_id": fuel_id,
        "tx_import_id": expense_line["import_id"],
        "reimburse_import_id": reimb_id,
    }


def update_fuel_entry(fuel_id: str, **new_fields) -> dict:
    """Edit an existing fuel entry, keeping fuel_id, refreshing the TX(s).

    Cleanest path: cascade-delete the old expense (+ reimbursement) and
    write fresh ones with the merged values. The fuel_log row is updated
    in place so fuel_id and ordering stay stable, only `tx_import_id`
    swaps to the new TX. Field-level partial update via ``new_fields``;
    ``None`` values are ignored so callers can pass only what they want
    to change.

    Returns:
        dict with fuel_id, new tx_import_id, and reimburse_import_id (or None).

    Raises:
        ValueError: if fuel_id, vehicle_id, or account does not resolve.
    """
    rows = load_fuel_log()
    target = next((r for r in rows if r["fuel_id"] == fuel_id), None)
    if target is None:
        raise ValueError(f"Unknown fuel_id: '{fuel_id}'")

    # Merge: only override keys with non-None values (callers can pass None
    # for fields they don't want to touch)
    merged = dict(target)
    for k, v in new_fields.items():
        if v is not None:
            merged[k] = v

    vehicles = load_vehicles()
    if merged["vehicle_id"] not in vehicles:
        raise ValueError(f"Unknown vehicle: '{merged['vehicle_id']}'")
    vehicle = vehicles[merged["vehicle_id"]]
    accounts = tx_engine.load_accounts()
    if merged.get("account") not in accounts:
        raise ValueError(f"Unknown account: '{merged.get('account')}'")
    acc = accounts[merged["account"]]

    backup_file("transactions", BACKUP_TARGETS["transactions"])
    backup_file("fuel_log", FUEL_LOG_CSV)

    # Cascade-delete old TX(s) before writing the new ones, otherwise the
    # new import_id (content-derived) might collide if the user only
    # changed cosmetic fields (note text).
    old_tx_id = target.get("tx_import_id", "").strip()
    old_acc = accounts.get(target.get("account", ""), {})
    if old_tx_id:
        old_expense_row = None
        with open(DATA_DIR / "transactions.csv", newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["import_id"] == old_tx_id:
                    old_expense_row = row
                    break
        if old_expense_row and old_acc.get("type") == "pass_through":
            old_reimb_id = find_reimbursement_id(old_expense_row, old_acc)
            if old_reimb_id:
                tx_engine.delete_transaction(old_reimb_id)
        tx_engine.delete_transaction(old_tx_id)

    # Normalize merged fuel row to the on-disk schema strings before
    # rebuilding the TX so the note + amount formatting stays identical
    # to what a fresh add_fuel_entry would produce.
    fuel_row_for_tx = {
        "date": merged["date"],
        "odometer_km": f"{float(merged['odometer_km']):.0f}",
        "liters": f"{float(merged['liters']):.2f}",
        "total_cost": f"{float(merged['total_cost']):.2f}",
        "currency": merged.get("currency") or acc.get("currency", "TZS"),
        "station": merged.get("station", "").strip(),
        "full_tank": str(merged.get("full_tank", "true")).lower(),
        "remarks": str(merged.get("remarks", "")).strip(),
        "account": merged["account"],
    }

    existing_ids = tx_engine.load_existing_import_ids()
    expense_line = build_expense_tx(fuel_row_for_tx, vehicle)
    expense_line["import_id"] = tx_engine.generate_import_id(
        expense_line["date"], expense_line["account"],
        float(expense_line["amount"]), expense_line["payee"],
        expense_line["category"], expense_line["note"], existing_ids,
    )
    existing_ids.add(expense_line["import_id"])

    lines_to_write = [expense_line]
    reimb_id = None
    if acc.get("type") == "pass_through":
        reimb_line = tx_engine.generate_pass_through_line(
            expense_line, acc, existing_ids,
        )
        if reimb_line is not None:
            reimb_id = reimb_line["import_id"]
            lines_to_write.append(reimb_line)

    tx_engine.append_transactions(lines_to_write)

    # Rewrite fuel_log: keep fuel_id, swap tx_import_id to the fresh ID
    new_fuel_row = {
        "fuel_id": fuel_id,
        "vehicle_id": merged["vehicle_id"],
        **fuel_row_for_tx,
        "tx_import_id": expense_line["import_id"],
    }
    new_rows = [new_fuel_row if r["fuel_id"] == fuel_id else r for r in rows]
    write_fuel_log(new_rows)

    return {
        "fuel_id": fuel_id,
        "tx_import_id": expense_line["import_id"],
        "reimburse_import_id": reimb_id,
    }


def find_reimbursement_id(expense_row: dict, account: dict) -> str | None:
    """Locate the auto-generated reimbursement TX paired to an expense.

    Pass-through expenses always have a matching income row on the same
    account+date+amount. We replicate the lookup used by
    generate_pass_through_line so the pair stays in sync on delete.

    Returns:
        import_id of the reimbursement TX, or None if not found.
    """
    ptp = account.get("pass_through_payee", "").strip()
    if not ptp:
        return None
    reimb_cat = tx_engine.REIMBURSEMENT_CATEGORIES.get(
        ptp, f"Income:{ptp} Reimbursement"
    )
    target_amount = f"{float(expense_row['amount']):.2f}"
    target = (
        expense_row["date"], expense_row["account"], "income",
        target_amount, ptp, reimb_cat,
    )
    tx_path = DATA_DIR / "transactions.csv"
    with open(tx_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            current = (
                row["date"], row["account"], row["type"],
                f"{float(row['amount']):.2f}" if row["amount"] else "",
                row["payee"], row["category"],
            )
            if current == target:
                return row["import_id"]
    return None


def delete_fuel_entry(fuel_id: str) -> dict:
    """Delete a fuel entry and its linked TX(s).

    Cascade order:
        1. Look up the fuel entry by fuel_id.
        2. Backup both CSVs.
        3. If the linked expense TX is on a pass-through account, find
           the reimbursement counter-entry and delete it first.
        4. Delete the expense TX itself.
        5. Remove the fuel row from fuel_log.csv last so a TX-delete
           failure does not orphan the link.

    Returns:
        Dict with fuel_id, tx_deleted, reimburse_deleted.

    Raises:
        ValueError: if fuel_id does not exist.
    """
    rows = load_fuel_log()
    target = next((r for r in rows if r["fuel_id"] == fuel_id), None)
    if target is None:
        raise ValueError(f"Unknown fuel_id: '{fuel_id}'")

    backup_file("transactions", BACKUP_TARGETS["transactions"])
    backup_file("fuel_log", FUEL_LOG_CSV)

    tx_id = target.get("tx_import_id", "").strip()
    accounts = tx_engine.load_accounts()
    acc = accounts.get(target.get("account", ""), {})

    tx_deleted = False
    reimb_deleted = False

    if tx_id:
        # Look up the expense row before deletion so we can locate its
        # reimbursement pair (the pair lookup needs the original fields).
        expense_row = None
        with open(DATA_DIR / "transactions.csv", newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["import_id"] == tx_id:
                    expense_row = row
                    break

        if expense_row and acc.get("type") == "pass_through":
            reimb_id = find_reimbursement_id(expense_row, acc)
            if reimb_id:
                reimb_deleted = tx_engine.delete_transaction(reimb_id)

        tx_deleted = tx_engine.delete_transaction(tx_id)

    write_fuel_log([r for r in rows if r["fuel_id"] != fuel_id])

    return {
        "fuel_id": fuel_id,
        "tx_deleted": tx_deleted,
        "reimburse_deleted": reimb_deleted,
    }


# ── CLI ─────────────────────────────────────────────────────────────────────

def cmd_list(_args: argparse.Namespace) -> int:
    """Print all fuel entries as a table."""
    rows = load_fuel_log()
    if not rows:
        print("No fuel entries yet.")
        return 0
    header = (
        f"{'fuel_id':<10} {'date':<10} {'vehicle':<8} {'km':>7} {'L':>7} "
        f"{'cost':>12} {'station':<25} {'full':<5} {'tx_import_id'}"
    )
    print(header)
    print("-" * len(header))
    for r in rows:
        print(
            f"{r['fuel_id']:<10} {r['date']:<10} {r['vehicle_id']:<8} "
            f"{r['odometer_km']:>7} {r['liters']:>7} {r['total_cost']:>12} "
            f"{r['station'][:25]:<25} {r['full_tank']:<5} "
            f"{r.get('tx_import_id', '')}"
        )
    return 0


def cmd_vehicles(_args: argparse.Namespace) -> int:
    """Print all configured vehicles."""
    vehicles = load_vehicles()
    if not vehicles:
        print("No vehicles configured. Add a row to data/vehicles.csv.")
        return 0
    print(f"{'vehicle_id':<10} {'name':<25} {'account':<8} {'category':<24} {'active'}")
    print("-" * 80)
    for v in vehicles.values():
        print(
            f"{v['vehicle_id']:<10} {v['name']:<25} "
            f"{v.get('default_account', ''):<8} "
            f"{v.get('default_category', ''):<24} {v.get('active', '')}"
        )
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    """Add a fuel entry — uses CLI flags where given, prompts otherwise."""
    vehicle_id = args.vehicle
    if not vehicle_id:
        active = get_active_vehicle()
        if active:
            vehicle_id = active["vehicle_id"]
            print(f"[info] Using sole active vehicle: {vehicle_id} ({active['name']})")
        else:
            vehicle_id = input("vehicle_id: ").strip()

    def resolve(field: str, value: str | None) -> str:
        # Prefer the CLI value; fall back to an interactive prompt if missing.
        return value if value is not None else input(f"{field}: ").strip()

    date_str = resolve("date (YYYY-MM-DD)", args.date)
    odometer = resolve("odometer_km", args.odometer)
    liters = resolve("liters", args.liters)
    cost = resolve("total_cost", args.cost)
    station = resolve("station", args.station)

    if args.full is not None:
        full_tank = bool(args.full)
    else:
        full_tank = input("full_tank (y/n): ").strip().lower().startswith("y")

    account_override = args.account or ""
    remarks = args.remarks or ""

    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        print(f"[error] Invalid date format: '{date_str}' (expected YYYY-MM-DD)")
        return 1

    try:
        result = add_fuel_entry(
            date=date_str,
            vehicle_id=vehicle_id,
            odometer_km=float(odometer),
            liters=float(liters),
            total_cost=float(cost),
            station=station,
            full_tank=full_tank,
            account=account_override or None,
            remarks=remarks,
        )
    except ValueError as exc:
        print(f"[error] {exc}")
        return 1

    print(f"[ok] Fuel entry created: {result['fuel_id']}")
    print(f"     Expense TX:        {result['tx_import_id']}")
    if result.get("reimburse_import_id"):
        print(f"     Reimbursement TX:  {result['reimburse_import_id']}")
    return 0


def cmd_tx(args: argparse.Namespace) -> int:
    """Parse a free-text fuel command, preview, and book on confirm.

    Mirrors the dashboard add-fuel modal but driven from the terminal.
    Uses the local regex parser (no Claude API needed) so the syntax
    works offline.
    """
    text = " ".join(args.input).strip()
    if not text:
        print("[error] Empty input. Example: fuel 35.52L 135686 puma 173261")
        return 1
    today = datetime.now().date().isoformat()
    try:
        parsed = parse_fuel_freetext(text, today)
    except ValueError as exc:
        print(f"[error] {exc}")
        return 1

    # Preview block — same fields the dashboard modal would show
    vehicle = load_vehicles()[parsed["vehicle_id"]]
    print(f"\n  Vehicle:    {vehicle['name']} ({parsed['vehicle_id']})")
    print(f"  Date:       {parsed['date']}")
    print(f"  Odometer:   {parsed['odometer_km']:.0f} km")
    print(f"  Liters:     {parsed['liters']:.2f} L")
    print(f"  Cost:       {parsed['total_cost']:.2f}")
    print(f"  Station:    {parsed['station']}")
    print(f"  Account:    {parsed['account']}")
    print(f"  Full tank:  {parsed['full_tank']}")
    if parsed["remarks"]:
        print(f"  Remarks:    {parsed['remarks']}")

    if args.yes:
        choice = "y"
    else:
        choice = input("\nBook this entry? [y/N]: ").strip().lower()
    if choice != "y":
        print("[skip] Cancelled.")
        return 0

    try:
        result = add_fuel_entry(**parsed)
    except ValueError as exc:
        print(f"[error] {exc}")
        return 1

    print(f"\n[ok] Fuel entry created: {result['fuel_id']}")
    print(f"     Expense TX:        {result['tx_import_id']}")
    if result.get("reimburse_import_id"):
        print(f"     Reimbursement TX:  {result['reimburse_import_id']}")
    return 0


def cmd_delete(args: argparse.Namespace) -> int:
    """Delete a fuel entry and cascade its linked TX(s)."""
    try:
        result = delete_fuel_entry(args.fuel_id)
    except ValueError as exc:
        print(f"[error] {exc}")
        return 1
    print(f"[ok] Deleted fuel entry: {result['fuel_id']}")
    print(f"     Expense TX deleted:        {result['tx_deleted']}")
    print(f"     Reimbursement TX deleted:  {result['reimburse_deleted']}")
    return 0


def main(argv: list[str]) -> int:
    """CLI entry point. Dispatches to the requested subcommand."""
    parser = argparse.ArgumentParser(prog="fuel.py")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="List all fuel entries")
    sub.add_parser("vehicles", help="List all vehicles")

    p_add = sub.add_parser("add", help="Add a fuel entry (with linked TX)")
    p_add.add_argument("--vehicle", help="vehicle_id (default: sole active vehicle)")
    p_add.add_argument("--date", help="YYYY-MM-DD")
    p_add.add_argument("--odometer", help="km reading")
    p_add.add_argument("--liters", help="liters filled")
    p_add.add_argument("--cost", help="total cost")
    p_add.add_argument("--station", help="petrol station")
    # BooleanOptionalAction lets us pass --full or --no-full and keeps the
    # default at None so cmd_add knows when to prompt interactively.
    p_add.add_argument(
        "--full", action=argparse.BooleanOptionalAction, default=None,
        help="full tank flag (--full / --no-full)",
    )
    p_add.add_argument("--account", help="override default_account (e.g. cash)")
    p_add.add_argument("--remarks", help="free-text remarks")

    p_del = sub.add_parser("delete", help="Delete a fuel entry + linked TX(s)")
    p_del.add_argument("fuel_id")

    p_tx = sub.add_parser(
        "tx", help="Parse a free-text fuel command and book it",
        description="Example: python scripts/fuel.py tx 35.52L 135686 puma 173261",
    )
    p_tx.add_argument("input", nargs="+", help="Free-text input")
    p_tx.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")

    args = parser.parse_args(argv)
    dispatch = {
        "list": cmd_list,
        "vehicles": cmd_vehicles,
        "add": cmd_add,
        "delete": cmd_delete,
        "tx": cmd_tx,
    }
    return dispatch[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
