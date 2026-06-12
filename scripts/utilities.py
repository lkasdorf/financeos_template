"""Utilities (LUKU + Water) logging engine — property master + utility entries.

Phase 1 layer: CSV CRUD for properties.csv, luku_log.csv, water_log.csv plus
two-way sync with transactions.csv. Each TX luku / TX water entry generates
one expense TX (and a reimbursement counter-entry if booked on a
pass-through account). The link survives via tx_import_id stored on each
log row, mirroring the fuel.py pattern.

Data files:
    data/properties.csv  — property stammdaten (one row per house/flat)
    data/luku_log.csv    — electricity-token purchases (one row per buy)
    data/water_log.csv   — water bill payments (one row per bill)

CLI:
    python scripts/utilities.py properties                     # list properties
    python scripts/utilities.py luku list                      # list LUKU entries
    python scripts/utilities.py water list                     # list water bills
    python scripts/utilities.py luku tx <freetext> [--yes]     # add LUKU via free text
    python scripts/utilities.py water tx <freetext> [--yes]    # add water bill

Called by:
    - scripts/utilities_map.py (one-shot XLSX import + TX-mapping)
    - serve.py once /api/properties/* + /api/utilities/* land in Phase 2
    - Claude Code chat for ad-hoc TX luku / TX water entries
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

# H-20 (Sprint 14) — Decimal helper for money accumulators so multi-month
# cumulative sums don't drift cents (e.g. `0.1 + 0.2 = 0.30000000000000004`).
# Convention: parse incoming row['amount'] via _money() once, accumulate in
# Decimal, then drop back to float only at the JSON-serialization boundary
# (the return-dict).
_MONEY_QUANT = Decimal("0.01")


def _money(value) -> Decimal:
    """Parse a number-like value into a Decimal, quantized to 2 dp.

    Tolerates None / empty / malformed input by returning Decimal('0.00').
    Strings go through Decimal(str(...)) to avoid float intermediates that
    would re-introduce the binary-float rounding we're trying to escape.
    """
    if value is None or value == "":
        return Decimal("0.00")
    try:
        return Decimal(str(value)).quantize(_MONEY_QUANT, rounding=ROUND_HALF_UP)
    except (ArithmeticError, ValueError):
        return Decimal("0.00")

# Local sibling modules — tx_engine carries the shared TX writer + locking.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import tx_engine  # noqa: E402
from backup import BACKUP_TARGETS, backup_file  # noqa: E402

# ── Path Constants ──────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
PROPERTIES_CSV = DATA_DIR / "properties.csv"
LUKU_LOG_CSV = DATA_DIR / "luku_log.csv"
WATER_LOG_CSV = DATA_DIR / "water_log.csv"

# ── Schemas ─────────────────────────────────────────────────────────────────

# Canonical column order for properties.csv.
PROPERTY_COLUMNS = [
    "property_id", "name", "address", "owner", "default_account", "currency",
    "electricity_payee", "water_payee",
    "electricity_meter", "water_meter", "water_control_number",
    "electricity_category", "water_category",
    "cost_tag",
    # Optional ISO dates that bound the period in which the property was
    # actually relevant. Empty = "open-ended" — start_date='' means
    # "always was", end_date='' means "still current". Used by the UI to
    # mark archived properties in selector pills and to clamp report
    # year-filters; the underlying TX data stays intact regardless.
    "start_date", "end_date",
    "active", "notes",
]


def derive_cost_tag(property_id: str) -> str:
    """Derive a default cost_tag from a property_id.

    Strips the conventional `prop-` prefix, uppercases the slug, and
    replaces hyphens with underscores so it lines up with the rest of the
    auto-tag style (`BUSINESS_<entity>`, `House_<id>_costs`, etc.). Examples:
        prop-myhouse -> Property_MYHOUSE
        prop-second  -> Property_SECOND
    """
    slug = (property_id or "").strip()
    if slug.startswith("prop-"):
        slug = slug[5:]
    slug = slug.replace("-", "_").upper()
    return f"Property_{slug}" if slug else ""

# Canonical column order for luku_log.csv. The `account` field is denormalized
# (always the actual account used) so historical entries don't drift if the
# property's default_account changes later. `tx_import_id` links to the
# expense row in transactions.csv (empty for pre-FOS-cutoff history rows).
LUKU_LOG_COLUMNS = [
    "luku_id", "date", "property_id",
    "units_kwh", "total_price", "currency", "price_per_unit",
    "account", "meter", "meter_reading_kwh", "tx_import_id", "note",
]

# Canonical column order for water_log.csv. Same denormalization rationale
# as LUKU. No period_month column on purpose — pay-date is sufficient.
WATER_LOG_COLUMNS = [
    "water_id", "date", "property_id",
    "total_price", "currency",
    "control_number", "meter",
    "account", "tx_import_id", "note",
]

# ── Free-Text Parsers ───────────────────────────────────────────────────────

# TX luku <kwh>kWh <cost> [account] [date=YYYY-MM-DD] [prop=<id>] [meter=<n>]
# TX water <cost> [account] [date=YYYY-MM-DD] [prop=<id>] [control=<n>]
#
# Tokens recognised, in detection order:
#   * "1820kWh" / "28L" / "50.5l"  → kWh (luku only, must end in kWh/L/l)
#   * "key=value"                  → named override (prop, date, meter, control, etc.)
#   * "YYYY-MM-DD"                 → date override (positional)
#   * Any other token              → positional candidate for cost / account
#
# Among the positional candidates, the FIRST cost-like token (digits with
# optional k/m suffix) wins as cost; any leftover text-only token that
# matches an existing account alias becomes the account.

_KWH_RE = re.compile(r"^([\d.]+)\s*(?:kwh|l)$", re.IGNORECASE)
_FLAG_RE = re.compile(r"^([a-z_]+)=(.+)$", re.IGNORECASE)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_COST_RE = re.compile(r"^[\d.,]+[km]?$", re.IGNORECASE)


def _parse_amount_kmsuffix(token: str) -> float:
    """Parse '650k' / '2.5m' / '28553' / '28,553' to a float.

    Mirrors tx_engine.parse_amount_input behavior so the utilities CLI
    accepts the same shorthand the user is already used to from TX inputs.
    """
    text = token.strip().lower().replace(",", "")
    if text.endswith("k"):
        return float(text[:-1]) * 1_000
    if text.endswith("m"):
        return float(text[:-1]) * 1_000_000
    return float(text)


def parse_luku_freetext(
    freetext: str, account_aliases: set[str] | None = None,
) -> dict:
    """Parse a `TX luku ...` free-text body into structured fields.

    Returns:
        Dict with keys: kwh, cost, account, date, prop, meter, note.
        Missing fields are None so the caller can fall back to property
        defaults.

    Raises:
        ValueError: on unparseable inputs (no kWh, no cost, etc.).
    """
    aliases = account_aliases or set()
    out = {
        "kwh": None, "cost": None, "account": None,
        "date": None, "prop": None, "meter": None,
        "meter_reading": None, "note": "",
    }
    leftover: list[str] = []
    for raw in freetext.strip().split():
        m = _KWH_RE.match(raw)
        if m:
            out["kwh"] = float(m.group(1))
            continue
        m = _FLAG_RE.match(raw)
        if m:
            key, value = m.group(1).lower(), m.group(2).strip()
            if key in {"account", "acc"}:
                out["account"] = value
            elif key == "date":
                out["date"] = value
            elif key in {"prop", "property"}:
                out["prop"] = value
            elif key == "meter":
                out["meter"] = value
            elif key in {"meter_reading", "reading", "stand"}:
                # Post-purchase meter reading (kWh balance shown right
                # after the recharge). Used by consumption-between-buys
                # math — accept loose numeric formats.
                try:
                    out["meter_reading"] = float(value.replace(",", "."))
                except ValueError:
                    out["note"] = (out["note"] + f" {raw}").strip()
            elif key == "note":
                out["note"] = value
            else:
                # Unknown flag — keep it in note for transparency.
                out["note"] = (out["note"] + f" {raw}").strip()
            continue
        if _DATE_RE.match(raw):
            out["date"] = raw
            continue
        leftover.append(raw)

    # Positional pass: first cost-like token → cost, first alias-matching
    # bare token → account, remainder joined into note.
    note_bits: list[str] = []
    for tok in leftover:
        if out["cost"] is None and _COST_RE.match(tok):
            try:
                out["cost"] = _parse_amount_kmsuffix(tok)
                continue
            except ValueError:
                pass
        if out["account"] is None and tok.lower() in aliases:
            out["account"] = tok.lower()
            continue
        note_bits.append(tok)
    if note_bits:
        out["note"] = (out["note"] + " " + " ".join(note_bits)).strip()

    if out["kwh"] is None:
        raise ValueError("LUKU input requires a kWh marker (e.g. '1820kWh' or '28L')")
    if out["cost"] is None:
        raise ValueError("LUKU input requires a cost (e.g. '650k' or '250000')")
    return out


def parse_water_freetext(
    freetext: str, account_aliases: set[str] | None = None,
) -> dict:
    """Parse a `TX water ...` free-text body into structured fields.

    Returns:
        Dict with keys: cost, account, date, prop, control, meter, note.
        Missing fields are None so the caller can fall back to property
        defaults.

    Raises:
        ValueError: on unparseable inputs (no cost found).
    """
    aliases = account_aliases or set()
    out = {
        "cost": None, "account": None, "date": None,
        "prop": None, "control": None, "meter": None, "note": "",
    }
    leftover: list[str] = []
    for raw in freetext.strip().split():
        m = _FLAG_RE.match(raw)
        if m:
            key, value = m.group(1).lower(), m.group(2).strip()
            if key in {"account", "acc"}:
                out["account"] = value
            elif key == "date":
                out["date"] = value
            elif key in {"prop", "property"}:
                out["prop"] = value
            elif key in {"control", "control_number", "controlno"}:
                out["control"] = value
            elif key == "meter":
                out["meter"] = value
            elif key == "note":
                out["note"] = value
            else:
                out["note"] = (out["note"] + f" {raw}").strip()
            continue
        if _DATE_RE.match(raw):
            out["date"] = raw
            continue
        leftover.append(raw)

    note_bits: list[str] = []
    for tok in leftover:
        if out["cost"] is None and _COST_RE.match(tok):
            try:
                out["cost"] = _parse_amount_kmsuffix(tok)
                continue
            except ValueError:
                pass
        if out["account"] is None and tok.lower() in aliases:
            out["account"] = tok.lower()
            continue
        note_bits.append(tok)
    if note_bits:
        out["note"] = (out["note"] + " " + " ".join(note_bits)).strip()

    if out["cost"] is None:
        raise ValueError("Water input requires a cost (e.g. '28553')")
    return out


# ── Property CRUD ───────────────────────────────────────────────────────────

def load_properties() -> dict[str, dict]:
    """Load properties.csv as a dict keyed by property_id."""
    if not PROPERTIES_CSV.exists():
        return {}
    out = {}
    with open(PROPERTIES_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            out[row["property_id"]] = row
    return out


def get_active_property() -> dict | None:
    """Return the single active property if exactly one is active.

    Lets the CLI default --prop when only one property is in use.
    """
    actives = [
        p for p in load_properties().values()
        if p.get("active", "").lower() == "true"
    ]
    return actives[0] if len(actives) == 1 else None


def save_properties(properties_dict: dict[str, dict]) -> None:
    """Atomically rewrite properties.csv from a dict keyed by property_id."""
    rows = [
        {col: v.get(col, "") for col in PROPERTY_COLUMNS}
        for v in properties_dict.values()
    ]
    tx_engine._atomic_csv_rewrite(PROPERTIES_CSV, PROPERTY_COLUMNS, rows)


def _next_property_id(existing: dict[str, dict], slug_hint: str = "") -> str:
    """Return a free `prop-<slug>` id. If slug_hint collides, fall back
    to numeric `prop-NNN`.
    """
    if slug_hint:
        candidate = f"prop-{slug_hint}"
        if candidate not in existing:
            return candidate
    max_n = 0
    for pid in existing.keys():
        m = re.match(r"^prop-(\d+)$", pid)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"prop-{max_n + 1:03d}"


def update_property(property_id: str, updates: dict) -> bool:
    """Patch a property row in place. Returns True if found, False otherwise."""
    properties = load_properties()
    if property_id not in properties:
        return False
    row = properties[property_id]
    for col in PROPERTY_COLUMNS:
        if col == "property_id":
            continue
        if col in updates:
            val = updates[col]
            row[col] = val.strip() if isinstance(val, str) else (val or "")
    properties[property_id] = row
    save_properties(properties)
    return True


def delete_property(property_id: str) -> bool:
    """Remove a property from properties.csv. Returns True if found, False otherwise.

    Does NOT cascade-delete log entries — those keep the orphan
    `property_id` reference so historical aggregates stay intact. The
    Settings UI / API layer must enforce a "no log entries" precondition
    before calling this (mirrors fuel.delete_vehicle).
    """
    properties = load_properties()
    if property_id not in properties:
        return False
    del properties[property_id]
    save_properties(properties)
    return True


def add_property(row: dict) -> str:
    """Append a new property to properties.csv. Returns the assigned property_id."""
    name = (row.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    currency = (row.get("currency") or "").strip()
    if not currency:
        raise ValueError("currency is required")

    properties = load_properties()
    pid = (row.get("property_id") or "").strip() or _next_property_id(properties)
    if pid in properties:
        raise ValueError(f"property_id '{pid}' already exists")

    new_row = {}
    for col in PROPERTY_COLUMNS:
        v = row.get(col, "")
        new_row[col] = v.strip() if isinstance(v, str) else (v or "")
    new_row["property_id"] = pid
    new_row["name"] = name
    new_row["currency"] = currency
    if not new_row.get("active"):
        new_row["active"] = "true"
    if not new_row.get("cost_tag"):
        new_row["cost_tag"] = derive_cost_tag(pid)
    properties[pid] = new_row
    save_properties(properties)
    return pid


# ── Log CRUD (LUKU + Water) ─────────────────────────────────────────────────

def load_luku_log() -> list[dict]:
    """Load all luku_log.csv rows in insertion order."""
    if not LUKU_LOG_CSV.exists():
        return []
    with open(LUKU_LOG_CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_water_log() -> list[dict]:
    """Load all water_log.csv rows in insertion order."""
    if not WATER_LOG_CSV.exists():
        return []
    with open(WATER_LOG_CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def next_luku_id() -> str:
    """Return the next sequential luku_id, zero-padded to 3 digits."""
    rows = load_luku_log()
    max_n = 0
    for r in rows:
        lid = r.get("luku_id", "")
        if lid.startswith("luku-"):
            try:
                n = int(lid.split("-", 1)[1])
                max_n = max(max_n, n)
            except ValueError:
                pass
    return f"luku-{max_n + 1:03d}"


def next_water_id() -> str:
    """Return the next sequential water_id, zero-padded to 3 digits."""
    rows = load_water_log()
    max_n = 0
    for r in rows:
        wid = r.get("water_id", "")
        if wid.startswith("water-"):
            try:
                n = int(wid.split("-", 1)[1])
                max_n = max(max_n, n)
            except ValueError:
                pass
    return f"water-{max_n + 1:03d}"


def append_luku_log(row: dict) -> None:
    """Append a single LUKU entry to luku_log.csv (creates header if missing).

    Durability: flush + fsync force the buffered append to disk before the
    handle closes, so a power loss between the TX commit and the next sync
    cannot leave a torn final row.
    """
    new_file = not LUKU_LOG_CSV.exists() or LUKU_LOG_CSV.stat().st_size == 0
    with open(LUKU_LOG_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=LUKU_LOG_COLUMNS)
        if new_file:
            writer.writeheader()
        writer.writerow({c: row.get(c, "") for c in LUKU_LOG_COLUMNS})
        f.flush()
        os.fsync(f.fileno())


def append_water_log(row: dict) -> None:
    """Append a single water entry to water_log.csv (creates header if missing).

    Same durability contract as :func:`append_luku_log`.
    """
    new_file = not WATER_LOG_CSV.exists() or WATER_LOG_CSV.stat().st_size == 0
    with open(WATER_LOG_CSV, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=WATER_LOG_COLUMNS)
        if new_file:
            writer.writeheader()
        writer.writerow({c: row.get(c, "") for c in WATER_LOG_COLUMNS})
        f.flush()
        os.fsync(f.fileno())


def write_luku_log(rows: list[dict]) -> None:
    """Atomically rewrite luku_log.csv from scratch with the given rows."""
    tx_engine._atomic_csv_rewrite(LUKU_LOG_CSV, LUKU_LOG_COLUMNS, rows)


def write_water_log(rows: list[dict]) -> None:
    """Atomically rewrite water_log.csv from scratch with the given rows."""
    tx_engine._atomic_csv_rewrite(WATER_LOG_CSV, WATER_LOG_COLUMNS, rows)


# ── TX Builders ─────────────────────────────────────────────────────────────

def build_luku_tx(luku_row: dict, prop: dict) -> dict:
    """Build the expense TX dict for a LUKU entry.

    The note embeds kWh + price/unit so the TX is self-documenting in
    transactions.csv without needing a luku_log lookup.
    """
    kwh = float(luku_row.get("units_kwh") or 0)
    note_parts = [
        f"LUKU {prop['name']}",
        f"{luku_row['units_kwh']} kWh",
    ]
    ppu = luku_row.get("price_per_unit") or ""
    if ppu:
        try:
            note_parts.append(f"{float(ppu):.2f} TZS/kWh")
        except ValueError:
            pass
    note = " | ".join(note_parts)

    payee = prop.get("electricity_payee", "") or ""
    category = prop.get("electricity_category", "Bills:Electricity") or "Bills:Electricity"
    cost_tag = (prop.get("cost_tag") or "").strip()
    # Extra tags from the modal/picker arrive via luku_row["_extra_tags"];
    # merged with the property cost_tag as explicit_tags so apply_auto_tags
    # treats them as user-set (additive, never removed by auto rules).
    explicit = [cost_tag] if cost_tag else []
    for et in luku_row.get("_extra_tags") or []:
        et = (et or "").strip()
        if et and et not in explicit:
            explicit.append(et)
    tags = ";".join(
        tx_engine.apply_auto_tags(luku_row["account"], payee, explicit, category)
    )

    return {
        "date": luku_row["date"],
        "account": luku_row["account"],
        "type": "expense",
        "amount": float(luku_row["total_price"]),
        "currency": luku_row["currency"],
        "payee": payee,
        "category": category,
        "note": note,
        "raw_note": "",
        "transfer_to_account": "",
        "transfer_to_amount": "",
        "receipt_group": "",
        "receipt_url": "",
        "tags": tags,
        "third_party_id": "",
    }


def build_water_tx(water_row: dict, prop: dict) -> dict:
    """Build the expense TX dict for a Water entry."""
    note_parts = [f"Water {prop['name']}"]
    if water_row.get("control_number"):
        note_parts.append(f"control {water_row['control_number']}")
    note = " | ".join(note_parts)

    payee = prop.get("water_payee", "") or ""
    category = prop.get("water_category", "Bills:Water") or "Bills:Water"
    cost_tag = (prop.get("cost_tag") or "").strip()
    # See build_luku_tx for the _extra_tags rationale.
    explicit = [cost_tag] if cost_tag else []
    for et in water_row.get("_extra_tags") or []:
        et = (et or "").strip()
        if et and et not in explicit:
            explicit.append(et)
    tags = ";".join(
        tx_engine.apply_auto_tags(water_row["account"], payee, explicit, category)
    )

    return {
        "date": water_row["date"],
        "account": water_row["account"],
        "type": "expense",
        "amount": float(water_row["total_price"]),
        "currency": water_row["currency"],
        "payee": payee,
        "category": category,
        "note": note,
        "raw_note": "",
        "transfer_to_account": "",
        "transfer_to_amount": "",
        "receipt_group": "",
        "receipt_url": "",
        "tags": tags,
        "third_party_id": "",
    }


# ── Atomic Add Operations ───────────────────────────────────────────────────

def add_luku_entry(
    *, date: str, property_id: str, units_kwh: float, total_price: float,
    account: str | None = None, meter: str = "",
    meter_reading_kwh: float | str = "",
    note: str = "",
    tags: list[str] | None = None,
) -> dict:
    """Create a LUKU entry and the linked transaction(s).

    Order of operations mirrors fuel.add_fuel_entry:
        1. Validate inputs against properties.csv and accounts.csv.
        2. Backup transactions.csv and luku_log.csv (FinanceOS hard rule).
        3. Build expense TX (+ pass-through reimbursement if applicable).
        4. Append TX rows first; if that fails, no log row is written.
        5. Append the log entry with the expense import_id linked back.

    Returns:
        Dict with luku_id, tx_import_id, reimburse_import_id (or None).

    Raises:
        ValueError: on validation errors (unknown property/account, etc.).
    """
    properties = load_properties()
    if property_id not in properties:
        raise ValueError(f"Unknown property: '{property_id}'")
    prop = properties[property_id]

    account_alias = (account or prop.get("default_account", "")).strip()
    accounts = tx_engine.load_accounts()
    if account_alias not in accounts:
        raise ValueError(f"Unknown account: '{account_alias}'")
    acc = accounts[account_alias]

    currency = acc.get("currency") or prop.get("currency", "TZS")
    kwh = float(units_kwh)
    cost = float(total_price)
    ppu = (cost / kwh) if kwh > 0 else 0.0
    meter_val = (meter or prop.get("electricity_meter", "")).strip()

    # meter_reading_kwh may arrive as float or str; normalise to a 2-decimal
    # string for storage (empty string when not provided so the CSV stays
    # readable without a float-encoded "0.00" placeholder).
    reading_str = ""
    if meter_reading_kwh not in (None, "", 0, "0"):
        try:
            reading_str = f"{float(meter_reading_kwh):.2f}"
        except (TypeError, ValueError):
            reading_str = ""

    luku_id = next_luku_id()
    luku_row = {
        "luku_id": luku_id,
        "date": date,
        "property_id": property_id,
        "units_kwh": f"{kwh:.2f}",
        "total_price": f"{cost:.2f}",
        "currency": currency,
        "price_per_unit": f"{ppu:.4f}" if ppu else "",
        "account": account_alias,
        "meter": meter_val,
        "meter_reading_kwh": reading_str,
        "tx_import_id": "",
        "note": note,
        # _extra_tags is consumed by build_luku_tx and dropped by
        # append_luku_log (which projects to LUKU_LOG_COLUMNS only).
        "_extra_tags": list(tags or []),
    }

    # Atomic across existing_ids snapshot + append + log persist so
    # another writer can't invalidate our id-collision window (H-01)
    # and a concurrent observer can't see a TX without its log row
    # or vice versa (C-03). Reentrant via C-02 — inner @with_tx_lock
    # decorators see depth > 0 and skip the OS lock re-acquire.
    with tx_engine.tx_write_lock():
        # Backups before any write — FinanceOS hard rule
        backup_file("transactions", BACKUP_TARGETS["transactions"])
        if LUKU_LOG_CSV.exists():
            backup_file("luku_log", LUKU_LOG_CSV)

        # Build expense + (optional) reimbursement TXs
        existing_ids = tx_engine.load_existing_import_ids()
        expense_line = build_luku_tx(luku_row, prop)
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

        # Persist TX(s) first; if this fails, no log row is written.
        tx_engine.append_transactions(lines_to_write)

        # Link expense TX back into log row, then persist
        luku_row["tx_import_id"] = expense_line["import_id"]
        append_luku_log(luku_row)

    return {
        "luku_id": luku_id,
        "tx_import_id": expense_line["import_id"],
        "reimburse_import_id": reimb_id,
    }


def add_water_entry(
    *, date: str, property_id: str, total_price: float,
    account: str | None = None, control_number: str = "",
    meter: str = "", note: str = "",
    tags: list[str] | None = None,
) -> dict:
    """Create a water bill entry and the linked transaction(s).

    Mirrors add_luku_entry — see docstring there for the order of
    operations. Returns:
        Dict with water_id, tx_import_id, reimburse_import_id (or None).
    """
    properties = load_properties()
    if property_id not in properties:
        raise ValueError(f"Unknown property: '{property_id}'")
    prop = properties[property_id]

    account_alias = (account or prop.get("default_account", "")).strip()
    accounts = tx_engine.load_accounts()
    if account_alias not in accounts:
        raise ValueError(f"Unknown account: '{account_alias}'")
    acc = accounts[account_alias]

    currency = acc.get("currency") or prop.get("currency", "TZS")
    cost = float(total_price)
    control_val = (control_number or prop.get("water_control_number", "")).strip()
    meter_val = (meter or prop.get("water_meter", "")).strip()

    water_id = next_water_id()
    water_row = {
        "water_id": water_id,
        "date": date,
        "property_id": property_id,
        "total_price": f"{cost:.2f}",
        "currency": currency,
        "control_number": control_val,
        "meter": meter_val,
        "account": account_alias,
        "tx_import_id": "",
        "note": note,
        # See add_luku_entry for the _extra_tags rationale.
        "_extra_tags": list(tags or []),
    }

    # See add_luku_entry for the atomicity rationale — same shape.
    with tx_engine.tx_write_lock():
        backup_file("transactions", BACKUP_TARGETS["transactions"])
        if WATER_LOG_CSV.exists():
            backup_file("water_log", WATER_LOG_CSV)

        existing_ids = tx_engine.load_existing_import_ids()
        expense_line = build_water_tx(water_row, prop)
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

        tx_engine.append_transactions(lines_to_write)
        water_row["tx_import_id"] = expense_line["import_id"]
        append_water_log(water_row)

    return {
        "water_id": water_id,
        "tx_import_id": expense_line["import_id"],
        "reimburse_import_id": reimb_id,
    }


# ── Deletion (cascade to TX + Reimbursement) ────────────────────────────────

def _find_reimbursement_id(expense_row: dict, account: dict) -> str | None:
    """Locate the auto-generated reimbursement TX paired to an expense.

    FK-first lookup (H-15 from CODE_REVIEW_2026-05-12) — mirrors
    :func:`fuel.find_reimbursement_id`. See that docstring for the full
    rationale; we prefer ``counter_entry_id == expense.import_id``
    over the legacy field-tuple match.
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

    tx_path = DATA_DIR / "transactions.csv"
    legacy_match = None
    with open(tx_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if expense_id and (row.get("counter_entry_id") or "").strip() == expense_id:
                return row["import_id"]
            if legacy_match is None:
                current = (
                    row["date"], row["account"], row["type"],
                    f"{float(row['amount']):.2f}" if row["amount"] else "",
                    row["payee"], row["category"],
                )
                if current == target_tuple:
                    legacy_match = row["import_id"]
    return legacy_match


def _delete_log_entry(
    log_id: str, *, log_type: str,
) -> dict:
    """Generic cascade-delete for a LUKU or Water log entry.

    Cascade order:
        1. Look up the log row by id.
        2. Backup transactions.csv and the relevant log CSV.
        3. If the linked TX is on a pass-through account, find the
           reimbursement counter-entry and delete it first.
        4. Delete the expense TX itself.
        5. Remove the log row last so a TX-delete failure doesn't orphan
           the link.

    Args:
        log_id: luku_id or water_id (depending on log_type).
        log_type: 'luku' or 'water'.

    Returns:
        Dict with log_id, tx_deleted, reimburse_deleted booleans.

    Raises:
        ValueError: when the log_id is unknown.
    """
    if log_type == "luku":
        rows = load_luku_log()
        id_field = "luku_id"
        log_csv = LUKU_LOG_CSV
        backup_stem = "luku_log"
        write_fn = write_luku_log
    elif log_type == "water":
        rows = load_water_log()
        id_field = "water_id"
        log_csv = WATER_LOG_CSV
        backup_stem = "water_log"
        write_fn = write_water_log
    else:
        raise ValueError(f"Unknown log_type: {log_type!r}")

    target = next((r for r in rows if r.get(id_field) == log_id), None)
    if target is None:
        raise ValueError(f"{id_field} '{log_id}' not found")

    # Cascade-delete is atomic: another writer landing between the
    # reimbursement-delete and the expense-delete would see a transient
    # pass-through balance > 0, and a writer landing between
    # delete_transaction and write_fn would see an orphan log row
    # pointing at a non-existent TX. Outer lock (C-03) closes both
    # windows; reentrant (C-02) means inner @with_tx_lock callees
    # don't deadlock.
    with tx_engine.tx_write_lock():
        # Backups first — FinanceOS hard rule
        backup_file("transactions", BACKUP_TARGETS["transactions"])
        if log_csv.exists():
            backup_file(backup_stem, log_csv)

        tx_import_id = (target.get("tx_import_id") or "").strip()
        tx_deleted = False
        reimb_deleted = False

        if tx_import_id:
            # Find the linked expense TX so we can also kill its reimbursement
            # counter-entry on pass-through accounts.
            accounts = tx_engine.load_accounts()
            with open(DATA_DIR / "transactions.csv", newline="", encoding="utf-8") as f:
                for tx in csv.DictReader(f):
                    if tx["import_id"] == tx_import_id:
                        expense_row = tx
                        break
                else:
                    expense_row = None

            if expense_row is not None:
                acc = accounts.get(expense_row["account"], {})
                if acc.get("type") == "pass_through":
                    reimb_id = _find_reimbursement_id(expense_row, acc)
                    if reimb_id:
                        reimb_deleted = bool(tx_engine.delete_transaction(reimb_id))
            tx_deleted = bool(tx_engine.delete_transaction(tx_import_id))

        # Remove the log row last
        new_rows = [r for r in rows if r.get(id_field) != log_id]
        write_fn(new_rows)

    return {
        "log_id": log_id,
        "log_type": log_type,
        "tx_import_id": tx_import_id,
        "tx_deleted": tx_deleted,
        "reimburse_deleted": reimb_deleted,
    }


def delete_luku_entry(luku_id: str) -> dict:
    """Delete a LUKU log entry and cascade-delete its linked TX(s)."""
    return _delete_log_entry(luku_id, log_type="luku")


def delete_water_entry(water_id: str) -> dict:
    """Delete a Water log entry and cascade-delete its linked TX(s)."""
    return _delete_log_entry(water_id, log_type="water")


def update_luku_entry(luku_id: str, **fields) -> dict:
    """Update a LUKU entry by delete-then-recreate.

    The cleanest cascade is: nuke the old log row + linked TX(s), then
    add a fresh entry with the merged fields. This avoids the
    book-keeping pain of editing transactions.csv in place when the
    amount or account changes (the import_id has to be rotated, the
    reimbursement-counter rebuilt, etc.).

    Args:
        luku_id: existing luku_id to replace.
        **fields: any subset of date / units_kwh / total_price /
            account / meter / note. Missing fields fall back to the
            current values.

    Returns:
        The same dict shape as add_luku_entry, plus the old luku_id /
        old_tx_import_id so the caller can confirm what was replaced.

    Raises:
        ValueError: when luku_id is unknown.
    """
    rows = load_luku_log()
    target = next((r for r in rows if r.get("luku_id") == luku_id), None)
    if target is None:
        raise ValueError(f"luku_id '{luku_id}' not found")
    merged = {
        "date": fields.get("date", target.get("date")),
        "property_id": fields.get("property_id", target.get("property_id")),
        "units_kwh": float(fields.get("units_kwh", target.get("units_kwh") or 0)),
        "total_price": float(fields.get("total_price", target.get("total_price") or 0)),
        "account": fields.get("account") or target.get("account") or None,
        "meter": fields.get("meter", target.get("meter", "")),
        "meter_reading_kwh": fields.get(
            "meter_reading_kwh", target.get("meter_reading_kwh", ""),
        ),
        "note": fields.get("note", target.get("note", "")),
        # No tag persistence on the log row — caller must pass `tags`
        # explicitly on update or the recreated TX loses any extras.
        "tags": list(fields.get("tags") or []),
    }
    old_tx = target.get("tx_import_id", "")
    # delete_luku_entry + add_luku_entry both take the lock internally
    # (C-03). Wrapping them in one outer acquire means an observer
    # never sees the in-between state (log row gone, new log row not
    # yet written). Reentrant lock (C-02) makes the inner acquires
    # cheap depth-bumps.
    with tx_engine.tx_write_lock():
        delete_luku_entry(luku_id)
        result = add_luku_entry(**merged)
    result["replaced_luku_id"] = luku_id
    result["replaced_tx_import_id"] = old_tx
    return result


def update_water_entry(water_id: str, **fields) -> dict:
    """Update a Water entry by delete-then-recreate (mirrors update_luku_entry)."""
    rows = load_water_log()
    target = next((r for r in rows if r.get("water_id") == water_id), None)
    if target is None:
        raise ValueError(f"water_id '{water_id}' not found")
    merged = {
        "date": fields.get("date", target.get("date")),
        "property_id": fields.get("property_id", target.get("property_id")),
        "total_price": float(fields.get("total_price", target.get("total_price") or 0)),
        "account": fields.get("account") or target.get("account") or None,
        "control_number": fields.get("control_number", target.get("control_number", "")),
        "meter": fields.get("meter", target.get("meter", "")),
        "note": fields.get("note", target.get("note", "")),
        # See update_luku_entry for the tag pass-through rationale.
        "tags": list(fields.get("tags") or []),
    }
    old_tx = target.get("tx_import_id", "")
    # See update_luku_entry for the outer-lock rationale.
    with tx_engine.tx_write_lock():
        delete_water_entry(water_id)
        result = add_water_entry(**merged)
    result["replaced_water_id"] = water_id
    result["replaced_tx_import_id"] = old_tx
    return result


# ── Aggregations for Dashboard ──────────────────────────────────────────────

def _month_key(date_str: str) -> str:
    """Convert 'YYYY-MM-DD' → 'YYYY-MM' for monthly bucketing."""
    return date_str[:7]


def _year_key(date_str: str) -> int:
    """Convert 'YYYY-MM-DD' → integer year."""
    return int(date_str[:4])


def enrich_luku_consumption(rows: list[dict]) -> list[dict]:
    """Compute the 'consumed kWh between purchases' field per LUKU row.

    Logic mirrors how a prepaid electricity meter actually works:
        meter_after_t1  = balance just after recharge t1 (recorded by user)
        balance_pre_t2  = meter_after_t2 − units_bought_at_t2
        consumption_t1→t2 = meter_after_t1 − balance_pre_t2

    A consumption value is only emitted when BOTH the previous purchase
    and the current purchase have a non-empty meter_reading_kwh. Gaps
    in the recording history don't poison the chart — the row gets an
    empty consumption_kwh and the dashboard shows '—'.

    Returns the same list of dicts (sorted oldest→newest) with
    `consumption_kwh` added.
    """
    sorted_rows = sorted(rows, key=lambda r: (r.get("date", ""), r.get("luku_id", "")))
    prev_post_balance: float | None = None
    out = []
    for r in sorted_rows:
        rcopy = dict(r)
        reading = r.get("meter_reading_kwh", "")
        units = r.get("units_kwh", "")
        try:
            reading_f = float(reading) if reading not in (None, "") else None
        except (TypeError, ValueError):
            reading_f = None
        try:
            units_f = float(units) if units not in (None, "") else 0.0
        except (TypeError, ValueError):
            units_f = 0.0

        # Pre-purchase balance for the CURRENT row, if we know the
        # post-purchase reading.
        cur_pre_balance = (reading_f - units_f) if reading_f is not None else None

        if prev_post_balance is not None and cur_pre_balance is not None:
            consumed = prev_post_balance - cur_pre_balance
            # Negative consumption only happens when the user mistypes
            # a meter reading (or a meter was reset). Surface as "" so
            # the chart skips it instead of plotting a downward spike.
            if consumed >= 0:
                rcopy["consumption_kwh"] = f"{consumed:.2f}"
            else:
                rcopy["consumption_kwh"] = ""
        else:
            rcopy["consumption_kwh"] = ""

        if reading_f is not None:
            prev_post_balance = reading_f
        out.append(rcopy)
    return out


def price_per_kwh_series(rows: list[dict]) -> list[dict]:
    """Per-purchase TZS/kWh time series for the price-trend chart.

    Returns:
        List of {date, price_per_kwh} sorted ascending by date. Rows
        with missing/zero kWh are skipped so the line doesn't break.
    """
    out = []
    for r in sorted(rows, key=lambda r: r.get("date", "")):
        ppu = r.get("price_per_unit", "")
        if not ppu:
            continue
        try:
            value = float(ppu)
        except (TypeError, ValueError):
            continue
        out.append({"date": r["date"], "price_per_kwh": value})
    return out


def luku_purchase_frequency(rows: list[dict]) -> list[dict]:
    """Per-month count of LUKU purchases (Token-Frequenz chart)."""
    if not rows:
        return []
    bucket: dict[str, dict] = {}
    for r in rows:
        mk = _month_key(r["date"])
        if mk not in bucket:
            bucket[mk] = {"month": mk, "count": 0}
        bucket[mk]["count"] += 1
    return _fill_months(bucket)


def ytd_cumulative(
    luku_rows: list[dict], water_rows: list[dict],
    today: str | None = None,
) -> dict:
    """Cumulative YTD spend for current + previous year, day-by-day.

    The dashboard's YTD-Kumulativ chart needs two parallel lines that
    can be compared visually: "this year up to today" vs. "last year up
    to the same day-of-year". Returns:

        {
          'days': ['2026-01-01', '2026-01-02', ...],
          'current_strom': [cum_so_far_per_day, ...],
          'current_water': [...],
          'previous_strom': [...],   # mapped onto current-year x-axis
          'previous_water': [...],
        }
    """
    from datetime import date as _d, timedelta
    today_d = _d.fromisoformat(today) if today else _d.today()
    cur_year = today_d.year

    # H-20 (Sprint 14) — Decimal accumulators. Iterating ~365 days with
    # float += float was the worst-case drift site in the codebase: each
    # day's small bill (e.g. 28553.71) compounds binary-float rounding.
    # Bucket values are Decimal too so per-day fetch+add stays exact.
    _ZERO = Decimal("0.00")

    def _per_day(rows: list[dict], year: int) -> dict[str, Decimal]:
        bucket: dict[str, Decimal] = {}
        for r in rows:
            try:
                d = _d.fromisoformat(r["date"])
            except (TypeError, ValueError):
                continue
            if d.year != year:
                continue
            amt = _money(r.get("total_price"))
            key = d.isoformat()
            bucket[key] = bucket.get(key, _ZERO) + amt
        return bucket

    cur_strom_day = _per_day(luku_rows, cur_year)
    cur_water_day = _per_day(water_rows, cur_year)
    prev_strom_day = _per_day(luku_rows, cur_year - 1)
    prev_water_day = _per_day(water_rows, cur_year - 1)

    days: list[str] = []
    cur_strom_cum: list[float] = []
    cur_water_cum: list[float] = []
    prev_strom_cum: list[float] = []
    prev_water_cum: list[float] = []
    cs = cw = ps = pw = _ZERO
    cur = _d(cur_year, 1, 1)
    while cur <= today_d:
        cs += cur_strom_day.get(cur.isoformat(), _ZERO)
        cw += cur_water_day.get(cur.isoformat(), _ZERO)
        prev_iso = _d(cur_year - 1, cur.month, cur.day).isoformat()
        ps += prev_strom_day.get(prev_iso, _ZERO)
        pw += prev_water_day.get(prev_iso, _ZERO)
        days.append(cur.isoformat())
        # Convert to float only at the JSON-output boundary.
        cur_strom_cum.append(float(cs))
        cur_water_cum.append(float(cw))
        prev_strom_cum.append(float(ps))
        prev_water_cum.append(float(pw))
        cur = cur + timedelta(days=1)
    return {
        "days": days,
        "current_strom": cur_strom_cum,
        "current_water": cur_water_cum,
        "previous_strom": prev_strom_cum,
        "previous_water": prev_water_cum,
    }


def seasonality_heatmap(luku_rows: list[dict], water_rows: list[dict]) -> dict:
    """Year × Month grid of total cost for a heat-map render.

    Returns:
        {
          'years':  [2023, 2024, 2025, 2026],
          'months': [1..12],
          'strom':  { '2023': [Jan, Feb, ..., Dec], ... },
          'water':  { '2024': [Jan, Feb, ..., Dec], ... },
        }
    """
    years_strom = sorted({_year_key(r["date"]) for r in luku_rows})
    years_water = sorted({_year_key(r["date"]) for r in water_rows})
    years = sorted(set(years_strom + years_water))
    strom_grid = {str(y): [0.0] * 12 for y in years}
    water_grid = {str(y): [0.0] * 12 for y in years}
    for r in luku_rows:
        try:
            y = _year_key(r["date"])
            m = int(r["date"][5:7])
        except (TypeError, ValueError):
            continue
        try:
            strom_grid[str(y)][m - 1] += float(r.get("total_price") or 0)
        except KeyError:
            continue
    for r in water_rows:
        try:
            y = _year_key(r["date"])
            m = int(r["date"][5:7])
        except (TypeError, ValueError):
            continue
        try:
            water_grid[str(y)][m - 1] += float(r.get("total_price") or 0)
        except KeyError:
            continue
    return {
        "years": years,
        "months": list(range(1, 13)),
        "strom": strom_grid,
        "water": water_grid,
    }


def monthly_luku_series(rows: list[dict]) -> list[dict]:
    """Aggregate LUKU rows by YYYY-MM, sorted ascending.

    Returns list of {month, total_price, units_kwh, entries} dicts. Empty
    months between first and last entry are filled with zero rows so the
    chart x-axis stays continuous.
    """
    if not rows:
        return []
    bucket: dict[str, dict] = {}
    for r in rows:
        mk = _month_key(r["date"])
        if mk not in bucket:
            bucket[mk] = {
                "month": mk, "total_price": 0.0,
                "units_kwh": 0.0, "entries": 0,
            }
        bucket[mk]["total_price"] += float(r.get("total_price") or 0)
        bucket[mk]["units_kwh"] += float(r.get("units_kwh") or 0)
        bucket[mk]["entries"] += 1
    return _fill_months(bucket)


def monthly_water_series(rows: list[dict]) -> list[dict]:
    """Aggregate water rows by YYYY-MM, sorted ascending. Zero-fill gaps."""
    if not rows:
        return []
    bucket: dict[str, dict] = {}
    for r in rows:
        mk = _month_key(r["date"])
        if mk not in bucket:
            bucket[mk] = {"month": mk, "total_price": 0.0, "entries": 0}
        bucket[mk]["total_price"] += float(r.get("total_price") or 0)
        bucket[mk]["entries"] += 1
    return _fill_months(bucket)


def _fill_months(bucket: dict[str, dict]) -> list[dict]:
    """Insert zero-value months between min and max so x-axis is continuous.

    The bucket dict is keyed by 'YYYY-MM'; this produces a sorted list with
    zero-filled gaps so the dashboard chart doesn't compress weeks of
    inactivity into a single tick.
    """
    if not bucket:
        return []
    keys = sorted(bucket.keys())
    first_y, first_m = (int(x) for x in keys[0].split("-"))
    last_y, last_m = (int(x) for x in keys[-1].split("-"))
    out = []
    y, m = first_y, first_m
    template_keys = [k for k in next(iter(bucket.values())).keys() if k != "month"]
    while (y, m) <= (last_y, last_m):
        mk = f"{y:04d}-{m:02d}"
        if mk in bucket:
            out.append(bucket[mk])
        else:
            zero_row = {"month": mk}
            for k in template_keys:
                zero_row[k] = 0
            out.append(zero_row)
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def yearly_comparison(luku_rows: list[dict], water_rows: list[dict]) -> list[dict]:
    """Per-year totals for the Strom-vs-Water comparison chart."""
    years: dict[int, dict] = {}
    for r in luku_rows:
        y = _year_key(r["date"])
        years.setdefault(y, {"year": y, "electricity": 0.0, "water": 0.0})
        years[y]["electricity"] += float(r.get("total_price") or 0)
    for r in water_rows:
        y = _year_key(r["date"])
        years.setdefault(y, {"year": y, "electricity": 0.0, "water": 0.0})
        years[y]["water"] += float(r.get("total_price") or 0)
    return [years[k] for k in sorted(years.keys())]


def property_kpis(
    luku_rows: list[dict], water_rows: list[dict],
    today: str | None = None,
) -> dict:
    """Compute the dashboard KPI cards for one property.

    Args:
        luku_rows: All LUKU log rows for this property.
        water_rows: All water log rows for this property.
        today: ISO date for "days since" calculations. Default: real today.

    Returns: dict with strom_ytd, kwh_ytd, wasser_ytd, avg_tzs_per_kwh,
        avg_strom_monthly, avg_wasser_monthly, days_since_luku,
        days_since_water, total_strom, total_water, total_kwh,
        latest_luku_date, latest_water_date.
    """
    from datetime import date as _d
    today_d = _d.fromisoformat(today) if today else _d.today()
    cur_year = today_d.year

    strom_ytd = sum(
        float(r.get("total_price") or 0) for r in luku_rows
        if _year_key(r["date"]) == cur_year
    )
    kwh_ytd = sum(
        float(r.get("units_kwh") or 0) for r in luku_rows
        if _year_key(r["date"]) == cur_year
    )
    wasser_ytd = sum(
        float(r.get("total_price") or 0) for r in water_rows
        if _year_key(r["date"]) == cur_year
    )

    total_strom = sum(float(r.get("total_price") or 0) for r in luku_rows)
    total_water = sum(float(r.get("total_price") or 0) for r in water_rows)
    total_kwh = sum(float(r.get("units_kwh") or 0) for r in luku_rows)
    avg_tzs_per_kwh = (total_strom / total_kwh) if total_kwh > 0 else 0.0

    # Rolling 12-month average using the actual span of data, not just
    # current year — gives a stable baseline regardless of when in the
    # year the user looks.
    months_strom = monthly_luku_series(luku_rows)
    months_water = monthly_water_series(water_rows)
    last12_strom = months_strom[-12:] if len(months_strom) >= 1 else []
    last12_water = months_water[-12:] if len(months_water) >= 1 else []
    avg_strom_monthly = (
        sum(m["total_price"] for m in last12_strom) / len(last12_strom)
        if last12_strom else 0.0
    )
    avg_wasser_monthly = (
        sum(m["total_price"] for m in last12_water) / len(last12_water)
        if last12_water else 0.0
    )

    latest_luku = max((r["date"] for r in luku_rows), default="")
    latest_water = max((r["date"] for r in water_rows), default="")
    days_since_luku = (
        (today_d - _d.fromisoformat(latest_luku)).days
        if latest_luku else None
    )
    days_since_water = (
        (today_d - _d.fromisoformat(latest_water)).days
        if latest_water else None
    )

    return {
        "strom_ytd": strom_ytd,
        "kwh_ytd": kwh_ytd,
        "wasser_ytd": wasser_ytd,
        "avg_tzs_per_kwh": avg_tzs_per_kwh,
        "avg_strom_monthly": avg_strom_monthly,
        "avg_wasser_monthly": avg_wasser_monthly,
        "days_since_luku": days_since_luku,
        "days_since_water": days_since_water,
        "total_strom": total_strom,
        "total_water": total_water,
        "total_kwh": total_kwh,
        "latest_luku_date": latest_luku,
        "latest_water_date": latest_water,
        "luku_count": len(luku_rows),
        "water_count": len(water_rows),
    }


def filter_logs_by_property(
    property_id: str,
) -> tuple[list[dict], list[dict]]:
    """Return (luku_rows, water_rows) filtered to one property_id."""
    luku = [r for r in load_luku_log() if r.get("property_id") == property_id]
    water = [r for r in load_water_log() if r.get("property_id") == property_id]
    return luku, water


def compute_property_alerts(today: str | None = None) -> list[dict]:
    """Compute drift alerts across all active properties.

    Five alert types covered:
        - kwh_spike:      last-30d kWh > rolling-12-month avg * 1.5
        - kwh_drop:       last-30d kWh < rolling-12-month avg * 0.5
        - water_missing:  no Water-TX in current month after day 25
        - price_anomaly:  latest LUKU price/kWh deviates >5% from 12mo median
        - luku_overdue:   last LUKU >21 days ago (token probably empty)

    Args:
        today: ISO date for "now". Default: real today (lets tests fix it).

    Returns:
        List of alert dicts shaped like the dashboard expects:
        {type, severity, title, detail, link}.
    """
    from datetime import date as _d, timedelta
    today_d = _d.fromisoformat(today) if today else _d.today()
    cutoff_30d = today_d - timedelta(days=30)
    cutoff_12mo = today_d - timedelta(days=365)
    cur_year = today_d.year
    cur_month = today_d.month

    out: list[dict] = []
    for prop in load_properties().values():
        if (prop.get("active") or "true").lower() != "true":
            continue
        pid = prop["property_id"]
        pname = prop.get("name", pid)
        luku, water = filter_logs_by_property(pid)

        # ── kWh-Spike / -Drop ───────────────────────────────────────
        last_30d_kwh = sum(
            float(r.get("units_kwh") or 0) for r in luku
            if _d.fromisoformat(r["date"]) >= cutoff_30d
        )
        rolling_12mo_kwh = sum(
            float(r.get("units_kwh") or 0) for r in luku
            if _d.fromisoformat(r["date"]) >= cutoff_12mo
        )
        # Need ≥3 months of history to make spike/drop calls — otherwise
        # one heavy month (e.g. February 2025 / 2,101 kWh) flags as spike
        # against an immature baseline.
        months_with_data = len({
            _d.fromisoformat(r["date"]).strftime("%Y-%m")
            for r in luku
            if _d.fromisoformat(r["date"]) >= cutoff_12mo
        })
        if months_with_data >= 3 and rolling_12mo_kwh > 0:
            avg_30d = rolling_12mo_kwh / 12  # avg per 30-day window
            if last_30d_kwh > avg_30d * 1.5:
                out.append({
                    "type": "luku_kwh_spike",
                    "severity": "warning",
                    "title": f"Electricity Consumption Spike: {pname}",
                    "detail": (
                        f"Last 30 days {last_30d_kwh:,.0f} kWh "
                        f"vs. Ø {avg_30d:,.0f} kWh — "
                        f"+{(last_30d_kwh / avg_30d - 1) * 100:.0f}%"
                    ),
                    "link": "#properties",
                    "i18n_key": "alerts.luku.kwh_spike",
                    "i18n_params": {
                        "property": pname,
                        "cur": f"{last_30d_kwh:,.0f}",
                        "avg": f"{avg_30d:,.0f}",
                        "pct": f"{(last_30d_kwh / avg_30d - 1) * 100:.0f}",
                    },
                })
            elif last_30d_kwh < avg_30d * 0.5 and last_30d_kwh > 0:
                out.append({
                    "type": "luku_kwh_drop",
                    "severity": "info",
                    "title": f"Electricity Consumption Unusually Low: {pname}",
                    "detail": (
                        f"Last 30 days {last_30d_kwh:,.0f} kWh "
                        f"vs. Ø {avg_30d:,.0f} kWh — "
                        f"power outage? Sub-meter defective?"
                    ),
                    "link": "#properties",
                    "i18n_key": "alerts.luku.kwh_drop",
                    "i18n_params": {
                        "property": pname,
                        "cur": f"{last_30d_kwh:,.0f}",
                        "avg": f"{avg_30d:,.0f}",
                    },
                })

        # ── Water missing this month after day 25 ───────────────────
        if today_d.day > 25:
            has_water_this_month = any(
                _d.fromisoformat(r["date"]).year == cur_year
                and _d.fromisoformat(r["date"]).month == cur_month
                for r in water
            )
            # Only complain when water history exists at all (otherwise
            # this fires on every fresh property).
            if water and not has_water_this_month:
                out.append({
                    "type": "water_missing",
                    "severity": "info",
                    "title": f"No Water Bill This Month: {pname}",
                    "detail": (
                        f"Today is the {today_d.day}th — water bills "
                        f"are monthly, but no entry for "
                        f"{cur_year}-{cur_month:02d}."
                    ),
                    "link": "#properties",
                    "i18n_key": "alerts.water.missing",
                    "i18n_params": {
                        "property": pname,
                        "day": str(today_d.day),
                        "period": f"{cur_year}-{cur_month:02d}",
                    },
                })

        # ── Price/kWh anomaly ───────────────────────────────────────
        priced = [
            float(r["price_per_unit"]) for r in luku
            if r.get("price_per_unit")
            and _d.fromisoformat(r["date"]) >= cutoff_12mo
        ]
        if len(priced) >= 6 and luku:
            sorted_p = sorted(priced)
            mid = len(sorted_p) // 2
            median = (
                sorted_p[mid] if len(sorted_p) % 2 == 1
                else (sorted_p[mid - 1] + sorted_p[mid]) / 2
            )
            latest_priced = next(
                (float(r["price_per_unit"]) for r in sorted(
                    luku, key=lambda x: x["date"], reverse=True,
                ) if r.get("price_per_unit")),
                None,
            )
            if latest_priced and median > 0:
                deviation = abs(latest_priced - median) / median
                if deviation > 0.05:
                    direction_key = "high" if latest_priced > median else "low"
                    out.append({
                        "type": "luku_price_anomaly",
                        "severity": "info",
                        "title": f"TZS/kWh Unusually {direction_key}: {pname}",
                        "detail": (
                            f"Latest token: {latest_priced:.2f} TZS/kWh "
                            f"(12mo median: {median:.2f}, "
                            f"Δ {deviation * 100:.1f}%)"
                        ),
                        "link": "#properties",
                        "i18n_key": "alerts.luku.price_anomaly",
                        "i18n_params": {
                            "property": pname,
                            "direction": direction_key,
                            "cur": f"{latest_priced:.2f}",
                            "median": f"{median:.2f}",
                            "pct": f"{deviation * 100:.1f}",
                        },
                    })

        # ── LUKU gap >21 days ───────────────────────────────────────
        if luku:
            latest_luku = max(_d.fromisoformat(r["date"]) for r in luku)
            days_since = (today_d - latest_luku).days
            if days_since > 21:
                out.append({
                    "type": "luku_overdue",
                    "severity": "info",
                    "title": f"LUKU Tokens Not Purchased Recently: {pname}",
                    "detail": (
                        f"Last purchase: {latest_luku.isoformat()} "
                        f"({days_since} days ago) — token empty? "
                        f"Forgot to book?"
                    ),
                    "link": "#properties",
                    "i18n_key": "alerts.luku.overdue",
                    "i18n_params": {
                        "property": pname,
                        "date": latest_luku.isoformat(),
                        "days": str(days_since),
                    },
                })

    # ── Recon-Banner: utilities_unmapped.md ─────────────────────────
    # `utilities_map.py` writes a markdown report after each XLSX
    # backfill — counts of LUKU / Water log rows that couldn't be
    # auto-linked to a TX. Surfaces here so unmapped entries don't
    # silently rot in a markdown file the dashboard never reads.
    unmapped_path = DATA_DIR / "utilities_unmapped.md"
    if unmapped_path.exists():
        try:
            content = unmapped_path.read_text(encoding="utf-8")
            import re as _re
            luku_match = _re.search(r"##\s+LUKU\s+\((\d+)\s+unmapped", content)
            water_match = _re.search(r"##\s+Water\s+\((\d+)\s+unmapped", content)
            luku_n = int(luku_match.group(1)) if luku_match else 0
            water_n = int(water_match.group(1)) if water_match else 0
            total = luku_n + water_n
            if total > 0:
                out.append({
                    "type": "utilities_unmapped",
                    "severity": "info",
                    "title": f"Utilities log: {total} unmapped entry{'ies' if total != 1 else ''}",
                    "detail": (
                        f"{luku_n} LUKU + {water_n} Water entries from utilities_map.py "
                        f"could not auto-link to a TX. Resolve in data/utilities_unmapped.md, "
                        f"then re-run scripts/utilities_map.py."
                    ),
                    "link": "#properties",
                    "dismissable": "utilities-recon-dismissed",
                    "i18n_key": "alerts.utilities.unmapped",
                    "i18n_params": {
                        "total": str(total),
                        "luku": str(luku_n),
                        "water": str(water_n),
                    },
                })
        except (OSError, ValueError):
            # Best-effort — a malformed file shouldn't block the rest of
            # the alerts pipeline.
            pass

    return out


def _classify_cost_bucket(category: str) -> str:
    """Group a TX category into a Cost-of-Living report bucket.

    Buckets are coarse on purpose so the report tells a story at a glance
    instead of fanning out into 30 leaf categories. Order is important —
    the first match wins, so put the more specific patterns first.
    """
    cat = (category or "").strip()
    if not cat:
        return "other"
    cat_l = cat.lower()
    if cat == "Bills:Electricity":
        return "utilities_electricity"
    if cat == "Bills:Water":
        return "utilities_water"
    # Staff:* MUST be checked before the "rent" substring match below —
    # otherwise a `Staff:<Name> Rent` stipend (housekeeper / caretaker /
    # nanny salary that uses the word "Rent" in the category) falls into
    # the rent bucket and inflates the property rent line.
    if cat_l.startswith("staff:"):
        return "staff"
    # Rent + service charges live under Bills:* in the category tree, so
    # check those before the generic bills:* fallback below — otherwise
    # rent (typically the largest line item) silently shows up as "other
    # utilities".
    if "rent" in cat_l:
        return "rent"
    if "service charge" in cat_l or "service_charge" in cat_l:
        return "service_charges"
    if cat_l.startswith("home:maintenance") or cat_l.startswith("automobile:maintenance"):
        return "maintenance"
    if cat_l.startswith("home:") or cat_l.startswith("household"):
        return "household"
    # Lease-dispute / Ward-Tribunal / lawyer fees that are property-related
    # land here. Without this bucket they hide in "other" and the user
    # can't tell legal exposure apart from genuinely unclassified TX.
    if cat_l.startswith("professional:legal") or cat_l.startswith("government:"):
        return "legal"
    if cat_l.startswith("bills:"):
        return "utilities_other"
    return "other"


COST_BUCKET_ORDER = [
    "rent",
    "service_charges",
    "utilities_electricity",
    "utilities_water",
    "utilities_other",
    "maintenance",
    "staff",
    "household",
    "legal",
    "other",
]


def cost_overview(property_id: str, year: str = "") -> dict:
    """Aggregate every TX tagged with the property's cost_tag into a
    Cost-of-Living overview.

    Args:
        property_id: Property to report on (must exist in properties.csv).
        year: Either '' / 'all' for full history, or a four-digit year
            string ('2024') for a single calendar year.

    Returns:
        {
          "property": {...},
          "cost_tag": "Property_MYHOUSE",
          "year": "2025" | "all",
          "totals": { bucket -> sum, "grand_total": sum },
          "by_month": [{"month": "2025-01", bucket -> sum, "total": ...}],
          "by_category": [{"category": str, "amount": float, "count": int, "bucket": str}],
          "tx_list": [TX dicts in date-desc order, capped at 500],
        }

    Falls silently to an empty result when the property has no cost_tag —
    the report UI uses that signal to nudge the user into the Settings
    tab to set one.
    """
    properties = load_properties()
    if property_id not in properties:
        raise ValueError(f"Unknown property: '{property_id}'")
    prop = properties[property_id]
    cost_tag = (prop.get("cost_tag") or "").strip()

    year_str = (year or "").strip()
    is_year_filter = bool(year_str) and year_str.lower() != "all"

    empty = {
        "property": prop,
        "cost_tag": cost_tag,
        "year": year_str if is_year_filter else "all",
        "totals": {b: 0.0 for b in COST_BUCKET_ORDER} | {"grand_total": 0.0},
        "by_month": [],
        "by_category": [],
        "tx_list": [],
        "available_years": [],
    }
    if not cost_tag:
        return empty

    # Walk transactions.csv directly so we can stream rather than load
    # everything into memory twice.
    tx_path = DATA_DIR / "transactions.csv"
    if not tx_path.exists():
        return empty

    # H-20 (Sprint 14) — Decimal accumulators for bucket/month/category
    # rollups. Multi-year cost-of-living reports cross thousands of TX,
    # each adding into the same per-bucket and per-month accumulators;
    # float += float accrues cents of drift that show up between the
    # grand total and the row-sum at the bottom of the UI table.
    _Z = Decimal("0.00")
    by_bucket: dict[str, Decimal] = {b: _Z for b in COST_BUCKET_ORDER}
    by_month: dict[str, dict] = {}
    by_category: dict[str, dict] = {}
    tx_rows: list[dict] = []
    available_years: set[str] = set()

    with open(tx_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tags = {t.strip() for t in (row.get("tags") or "").split(";") if t.strip()}
            if cost_tag not in tags:
                continue
            tx_type = (row.get("type") or "").strip().lower()
            if tx_type != "expense":
                # Reimbursement counter-entries on pass-through accounts
                # would otherwise zero out the property's costs. The
                # report is about money LEAVING the household, so only
                # expense rows count.
                continue
            date_str = (row.get("date") or "").strip()
            year_part = date_str[:4]
            if year_part:
                available_years.add(year_part)
            if is_year_filter and year_part != year_str:
                continue
            amount = _money(row.get("amount"))
            category = row.get("category") or ""
            bucket = _classify_cost_bucket(category)
            by_bucket[bucket] = by_bucket.get(bucket, _Z) + amount
            month_key = date_str[:7] if len(date_str) >= 7 else "0000-00"
            month_row = by_month.setdefault(
                month_key,
                {b: _Z for b in COST_BUCKET_ORDER} | {"month": month_key, "total": _Z},
            )
            month_row[bucket] += amount
            month_row["total"] += amount
            cat_entry = by_category.setdefault(
                category, {"category": category, "amount": _Z, "count": 0, "bucket": bucket},
            )
            cat_entry["amount"] += amount
            cat_entry["count"] += 1
            tx_rows.append(row)

    grand = sum(by_bucket.values(), _Z)

    # Convert Decimal accumulators back to float at the JSON-output
    # boundary. Round-trip through quantize first so the wire-format
    # always has exactly 2 dp.
    def _f(d: Decimal) -> float:
        return float(d.quantize(_MONEY_QUANT, rounding=ROUND_HALF_UP))

    bucket_out = {b: _f(v) for b, v in by_bucket.items()}
    months_sorted = []
    for k in sorted(by_month.keys()):
        m = by_month[k]
        months_sorted.append({
            **{b: _f(m[b]) for b in COST_BUCKET_ORDER},
            "month": m["month"],
            "total": _f(m["total"]),
        })
    categories_sorted = sorted(
        ({**c, "amount": _f(c["amount"])} for c in by_category.values()),
        key=lambda c: (-c["amount"], c["category"]),
    )
    tx_rows.sort(key=lambda r: r.get("date", ""), reverse=True)

    return {
        "property": prop,
        "cost_tag": cost_tag,
        "year": year_str if is_year_filter else "all",
        "totals": bucket_out | {"grand_total": _f(grand)},
        "by_month": months_sorted,
        "by_category": categories_sorted,
        "tx_list": tx_rows[:500],
        "available_years": sorted(available_years, reverse=True),
    }


def list_properties_with_summary() -> list[dict]:
    """Return all properties enriched with current-month + YTD KPIs.

    Used by the dashboard's properties-list cards. Each entry contains
    the raw property fields plus a `kpis` sub-dict.
    """
    properties = load_properties()
    out = []
    for prop in properties.values():
        pid = prop["property_id"]
        luku, water = filter_logs_by_property(pid)
        kpis = property_kpis(luku, water)
        out.append({**prop, "kpis": kpis})
    return out


# ── CLI ─────────────────────────────────────────────────────────────────────

def _resolve_property(prop_arg: str | None) -> dict:
    """Resolve a property ID or name from CLI input → dict.

    Falls back to the single active property when no arg is given.
    Accepts short forms ('myhouse' → 'prop-myhouse'), full IDs, or display names.
    """
    properties = load_properties()
    if not properties:
        raise ValueError("No properties defined. Run scripts/utilities_map.py first.")
    if not prop_arg:
        active = get_active_property()
        if active:
            return active
        raise ValueError(
            "Multiple active properties — specify one via prop=<id>."
        )
    key = prop_arg.strip()
    if key in properties:
        return properties[key]
    if f"prop-{key}" in properties:
        return properties[f"prop-{key}"]
    for p in properties.values():
        if p.get("name", "").lower() == key.lower():
            return p
    raise ValueError(f"Unknown property: '{prop_arg}'")


def cmd_properties(_args: argparse.Namespace) -> int:
    """List all properties with their key defaults."""
    properties = load_properties()
    if not properties:
        print("No properties defined.")
        return 0
    print(f"{'ID':<14} {'Name':<14} {'Account':<8} {'Curr':<5} {'Active':<6} Meters (E / W)")
    print("-" * 80)
    for p in properties.values():
        print(
            f"{p['property_id']:<14} {p.get('name',''):<14} "
            f"{p.get('default_account',''):<8} {p.get('currency',''):<5} "
            f"{p.get('active',''):<6} "
            f"{p.get('electricity_meter','-')} / {p.get('water_meter','-')}"
        )
    return 0


def cmd_luku_list(_args: argparse.Namespace) -> int:
    """List all LUKU entries (newest last)."""
    rows = load_luku_log()
    if not rows:
        print("No LUKU entries.")
        return 0
    print(f"{'ID':<10} {'Date':<11} {'Prop':<12} {'kWh':>9} {'TZS':>11} {'TZS/kWh':>10} TX")
    print("-" * 80)
    for r in rows:
        print(
            f"{r['luku_id']:<10} {r['date']:<11} {r['property_id']:<12} "
            f"{float(r.get('units_kwh') or 0):>9.1f} "
            f"{float(r.get('total_price') or 0):>11.0f} "
            f"{float(r.get('price_per_unit') or 0):>10.2f} "
            f"{r.get('tx_import_id','') or '-'}"
        )
    return 0


def cmd_water_list(_args: argparse.Namespace) -> int:
    """List all Water entries (newest last)."""
    rows = load_water_log()
    if not rows:
        print("No Water entries.")
        return 0
    print(f"{'ID':<11} {'Date':<11} {'Prop':<12} {'TZS':>11} {'Control':<14} TX")
    print("-" * 80)
    for r in rows:
        print(
            f"{r['water_id']:<11} {r['date']:<11} {r['property_id']:<12} "
            f"{float(r.get('total_price') or 0):>11.0f} "
            f"{r.get('control_number',''):<14} "
            f"{r.get('tx_import_id','') or '-'}"
        )
    return 0


def _today_iso() -> str:
    """Return today's date as YYYY-MM-DD (local timezone)."""
    from datetime import date
    return date.today().isoformat()


def cmd_luku_tx(args: argparse.Namespace) -> int:
    """Add a LUKU entry from a free-text body. Shows preview + asks y/n."""
    accounts = tx_engine.load_accounts()
    parsed = parse_luku_freetext(" ".join(args.freetext), set(accounts.keys()))
    prop = _resolve_property(parsed.get("prop"))
    account_alias = (parsed.get("account") or prop.get("default_account", "")).strip()
    if account_alias not in accounts:
        print(f"Error: unknown account '{account_alias}'", file=sys.stderr)
        return 2
    acc = accounts[account_alias]
    currency = acc.get("currency") or prop.get("currency", "TZS")
    date = parsed.get("date") or _today_iso()
    kwh = parsed["kwh"]
    cost = parsed["cost"]
    ppu = (cost / kwh) if kwh > 0 else 0.0

    print("LUKU TX preview")
    print("-" * 60)
    print(f"  Property:    {prop['property_id']}  ({prop.get('name','')})")
    print(f"  Date:        {date}")
    print(f"  kWh:         {kwh:.2f}")
    print(f"  Cost:        {cost:,.0f} {currency}")
    print(f"  Price/kWh:   {ppu:.2f} {currency}/kWh")
    print(f"  Account:     {account_alias}  ({acc.get('name','')})")
    print(f"  Payee:       {prop.get('electricity_payee','') or '<not configured>'}")
    print(f"  Category:    {prop.get('electricity_category','Bills:Electricity')}")
    if acc.get("type") == "pass_through":
        ptp = acc.get("pass_through_payee", "")
        reimb_cat = tx_engine.REIMBURSEMENT_CATEGORIES.get(
            ptp, f"Income:{ptp} Reimbursement"
        )
        print(f"  Reimburse:   +{cost:,.0f} {currency} -> {reimb_cat} (auto)")
    if parsed.get("note"):
        print(f"  Note:        {parsed['note']}")
    print("-" * 60)

    if not args.yes:
        try:
            answer = input("Book this entry? [y/N] ").strip().lower()
        except EOFError:
            answer = ""
        if answer != "y":
            print("Aborted.")
            return 1

    result = add_luku_entry(
        date=date, property_id=prop["property_id"],
        units_kwh=kwh, total_price=cost,
        account=account_alias, meter=parsed.get("meter") or "",
        note=parsed.get("note", ""),
    )
    print(f"OK booked {result['luku_id']} (tx {result['tx_import_id']}", end="")
    if result.get("reimburse_import_id"):
        print(f", reimb {result['reimburse_import_id']}", end="")
    print(")")
    return 0


def cmd_water_tx(args: argparse.Namespace) -> int:
    """Add a Water entry from a free-text body. Shows preview + asks y/n."""
    accounts = tx_engine.load_accounts()
    parsed = parse_water_freetext(" ".join(args.freetext), set(accounts.keys()))
    prop = _resolve_property(parsed.get("prop"))
    account_alias = (parsed.get("account") or prop.get("default_account", "")).strip()
    if account_alias not in accounts:
        print(f"Error: unknown account '{account_alias}'", file=sys.stderr)
        return 2
    acc = accounts[account_alias]
    currency = acc.get("currency") or prop.get("currency", "TZS")
    date = parsed.get("date") or _today_iso()
    cost = parsed["cost"]

    print("Water TX preview")
    print("-" * 60)
    print(f"  Property:    {prop['property_id']}  ({prop.get('name','')})")
    print(f"  Date:        {date}")
    print(f"  Cost:        {cost:,.2f} {currency}")
    print(f"  Account:     {account_alias}  ({acc.get('name','')})")
    print(f"  Payee:       {prop.get('water_payee','') or '<not configured>'}")
    print(f"  Category:    {prop.get('water_category','Bills:Water')}")
    control = parsed.get("control") or prop.get("water_control_number", "")
    if control:
        print(f"  Control-Nr:  {control}")
    if acc.get("type") == "pass_through":
        ptp = acc.get("pass_through_payee", "")
        reimb_cat = tx_engine.REIMBURSEMENT_CATEGORIES.get(
            ptp, f"Income:{ptp} Reimbursement"
        )
        print(f"  Reimburse:   +{cost:,.2f} {currency} -> {reimb_cat} (auto)")
    if parsed.get("note"):
        print(f"  Note:        {parsed['note']}")
    print("-" * 60)

    if not args.yes:
        try:
            answer = input("Book this entry? [y/N] ").strip().lower()
        except EOFError:
            answer = ""
        if answer != "y":
            print("Aborted.")
            return 1

    result = add_water_entry(
        date=date, property_id=prop["property_id"],
        total_price=cost, account=account_alias,
        control_number=parsed.get("control") or "",
        meter=parsed.get("meter") or "",
        note=parsed.get("note", ""),
    )
    print(f"OK booked {result['water_id']} (tx {result['tx_import_id']}", end="")
    if result.get("reimburse_import_id"):
        print(f", reimb {result['reimburse_import_id']}", end="")
    print(")")
    return 0


def main(argv: list[str]) -> int:
    """Dispatch to the requested CLI sub-command."""
    parser = argparse.ArgumentParser(
        description="FinanceOS Utilities — LUKU and Water tracking"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("properties", help="List properties")

    luku_parser = sub.add_parser("luku", help="LUKU operations")
    luku_sub = luku_parser.add_subparsers(dest="luku_cmd", required=True)
    luku_sub.add_parser("list", help="List LUKU entries")
    luku_tx = luku_sub.add_parser("tx", help="Add LUKU entry from free text")
    luku_tx.add_argument("freetext", nargs="+", help="Free-text body, e.g. '1820kWh 650k <account>'")
    luku_tx.add_argument("--yes", action="store_true", help="Skip confirmation prompt")

    water_parser = sub.add_parser("water", help="Water operations")
    water_sub = water_parser.add_subparsers(dest="water_cmd", required=True)
    water_sub.add_parser("list", help="List Water entries")
    water_tx = water_sub.add_parser("tx", help="Add Water entry from free text")
    water_tx.add_argument("freetext", nargs="+", help="Free-text body, e.g. '28553 <account>'")
    water_tx.add_argument("--yes", action="store_true", help="Skip confirmation prompt")

    args = parser.parse_args(argv)

    if args.cmd == "properties":
        return cmd_properties(args)
    if args.cmd == "luku":
        if args.luku_cmd == "list":
            return cmd_luku_list(args)
        if args.luku_cmd == "tx":
            return cmd_luku_tx(args)
    if args.cmd == "water":
        if args.water_cmd == "list":
            return cmd_water_list(args)
        if args.water_cmd == "tx":
            return cmd_water_tx(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
