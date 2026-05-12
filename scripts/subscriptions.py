"""Subscriptions module — manage recurring services (Netflix, hosting,
domains, AI tools, etc.) with billing-cycle awareness.

Phase 1 (current): pure CRUD on the subscription master + an empty
log file. Phase 2 will add per-charge tracking by linking transactions
to a subscription via subscription_log.csv.

The CSV is the single source of truth — same atomic-rewrite pattern
as properties / vehicles / utilities. No automatic TX side effects in
Phase 1 — booking happens through the regular TX flow; the user
attaches charges to a subscription manually (or auto, in Phase 2).
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import tx_engine  # noqa: E402
from backup import backup_file  # noqa: E402

DATA_DIR = REPO_ROOT / "data"
SUBSCRIPTIONS_CSV = DATA_DIR / "subscriptions.csv"
SUBSCRIPTION_LOG_CSV = DATA_DIR / "subscription_log.csv"

# ── Schemas ─────────────────────────────────────────────────────────────────

# Canonical column order for subscriptions.csv. Stays in lock-step with
# the header on disk; readers/writers use this list, not the file's
# first row, so a manually-edited CSV cannot drift the program.
SUBSCRIPTION_COLUMNS = [
    "subscription_id", "name", "group", "provider",
    "amount", "currency", "billing_months",
    "next_renewal",       # ISO date of the next charge (informational; cron may use it later)
    "account", "payee", "url",
    "active", "cancelled_on",
    "start_date",
    "auto_tag",            # e.g. "Subscription_Netflix" — used in Phase 2 for TX matching
    "notes",
]

# subscription_log.csv — one row per charge tied to a subscription.
# Phase 1 leaves this empty; Phase 2 populates it via the link / auto-detect flow.
SUBSCRIPTION_LOG_COLUMNS = [
    "log_id", "date", "subscription_id",
    "amount", "currency", "account",
    "tx_import_id",        # foreign key into transactions.csv
    "note",
]


def derive_auto_tag(name: str) -> str:
    """Derive a default auto_tag from a subscription name.

    Mirrors the property `cost_tag` convention: a `Subscription_<Slug>`
    tag with non-alnum stripped and underscores between word parts.
    The frontend can override; this is just a sensible default so a
    fresh row already has something in the auto_tag column.
    """
    slug = re.sub(r"[^A-Za-z0-9]+", "_", (name or "").strip()).strip("_")
    return f"Subscription_{slug}" if slug else ""


# ── Master CRUD ─────────────────────────────────────────────────────────────

def load_subscriptions() -> dict[str, dict]:
    """Load subscriptions.csv as a dict keyed by subscription_id.

    Empty file (header only) returns an empty dict. Missing file is
    treated identically — the deploy seed is "header-only", so a fresh
    install has nothing to load.
    """
    if not SUBSCRIPTIONS_CSV.exists():
        return {}
    out = {}
    with open(SUBSCRIPTIONS_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            sid = (row.get("subscription_id") or "").strip()
            if sid:
                out[sid] = row
    return out


def save_subscriptions(subs: dict[str, dict]) -> None:
    """Atomically rewrite subscriptions.csv from a dict keyed by subscription_id."""
    rows = [
        {col: v.get(col, "") for col in SUBSCRIPTION_COLUMNS}
        for v in subs.values()
    ]
    backup_file("subscriptions", SUBSCRIPTIONS_CSV)
    tx_engine._atomic_csv_rewrite(SUBSCRIPTIONS_CSV, SUBSCRIPTION_COLUMNS, rows)


def _next_subscription_id(existing: dict[str, dict], slug_hint: str = "") -> str:
    """Return a free `sub-<slug>` id. If the slug collides, fall back
    to a numeric `sub-NNN` so we never overwrite an existing row.
    """
    if slug_hint:
        slug = re.sub(r"[^a-z0-9]+", "-", slug_hint.lower()).strip("-")
        if slug:
            candidate = f"sub-{slug}"
            if candidate not in existing:
                return candidate
    max_n = 0
    for sid in existing.keys():
        m = re.match(r"^sub-(\d+)$", sid)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"sub-{max_n + 1:03d}"


def add_subscription(row: dict) -> str:
    """Append a new subscription. Returns the assigned subscription_id.

    Required: name, currency, amount, billing_months. Everything else
    is optional. The auto_tag is derived from the name on first add
    unless the caller supplied an explicit one — keeps the column
    populated by default so Phase-2 TX matching has something to work
    with right away.
    """
    name = (row.get("name") or "").strip()
    if not name:
        raise ValueError("name is required")
    currency = (row.get("currency") or "").strip()
    if not currency:
        raise ValueError("currency is required")
    amount = (str(row.get("amount") or "")).strip()
    if not amount:
        raise ValueError("amount is required")
    billing_months = (str(row.get("billing_months") or "1")).strip()
    if not billing_months.isdigit() or int(billing_months) < 1:
        raise ValueError("billing_months must be a positive integer")

    subs = load_subscriptions()
    sid = (row.get("subscription_id") or "").strip() or _next_subscription_id(subs, name)
    if sid in subs:
        raise ValueError(f"subscription_id '{sid}' already exists")

    new_row = {}
    for col in SUBSCRIPTION_COLUMNS:
        v = row.get(col, "")
        new_row[col] = v.strip() if isinstance(v, str) else (v or "")
    new_row["subscription_id"] = sid
    new_row["name"] = name
    new_row["currency"] = currency
    new_row["amount"] = amount
    new_row["billing_months"] = billing_months
    if not new_row.get("active"):
        new_row["active"] = "true"
    if not new_row.get("auto_tag"):
        new_row["auto_tag"] = derive_auto_tag(name)
    subs[sid] = new_row
    save_subscriptions(subs)
    return sid


def update_subscription(subscription_id: str, updates: dict) -> bool:
    """Patch a subscription row in place. Returns True if found.

    Field-presence-aware: only columns explicitly present in `updates`
    are changed. That way a PATCH-style call from the UI does not need
    to re-send unchanged fields.
    """
    subs = load_subscriptions()
    if subscription_id not in subs:
        return False
    row = subs[subscription_id]
    for col in SUBSCRIPTION_COLUMNS:
        if col == "subscription_id":
            continue
        if col in updates:
            val = updates[col]
            row[col] = val.strip() if isinstance(val, str) else (val or "")
    subs[subscription_id] = row
    save_subscriptions(subs)
    return True


def delete_subscription(subscription_id: str) -> bool:
    """Remove a subscription. Returns True if found, False otherwise.

    Does not cascade-delete subscription_log rows — those keep the
    orphan reference so historical aggregates stay intact, mirroring
    the property/vehicle delete semantics. The API layer should
    enforce a "no log entries" precondition before calling this.
    """
    subs = load_subscriptions()
    if subscription_id not in subs:
        return False
    del subs[subscription_id]
    save_subscriptions(subs)
    return True


# ── Log CRUD (Phase 2 prep) ─────────────────────────────────────────────────

def load_subscription_log() -> list[dict]:
    """Load subscription_log.csv as a list of rows in file order."""
    if not SUBSCRIPTION_LOG_CSV.exists():
        return []
    with open(SUBSCRIPTION_LOG_CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_subscription_log(rows: list[dict]) -> None:
    """Atomically rewrite subscription_log.csv."""
    backup_file("subscription_log", SUBSCRIPTION_LOG_CSV)
    tx_engine._atomic_csv_rewrite(
        SUBSCRIPTION_LOG_CSV, SUBSCRIPTION_LOG_COLUMNS, rows,
    )


def next_log_id() -> str:
    """Return the next free `slog-NNN` id."""
    rows = load_subscription_log()
    max_n = 0
    for r in rows:
        m = re.match(r"^slog-(\d+)$", r.get("log_id", ""))
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"slog-{max_n + 1:03d}"


def append_subscription_log(row: dict) -> str:
    """Append a single row to subscription_log.csv. Returns the assigned log_id.

    Phase-2 helper — Phase 1 never calls this. Kept so the schema is
    end-to-end testable from CLI and the file structure is locked in.
    """
    new_row = {col: (row.get(col, "") or "") for col in SUBSCRIPTION_LOG_COLUMNS}
    if not new_row.get("log_id"):
        new_row["log_id"] = next_log_id()
    rows = load_subscription_log()
    rows.append(new_row)
    save_subscription_log(rows)
    return new_row["log_id"]


# ── Aggregates / list helpers ───────────────────────────────────────────────

def _safe_float(s: str) -> float:
    """Parse a CSV amount string. Returns 0.0 on any parse error so a
    malformed row never crashes the listing — the UI just shows 0 and
    the user can fix it inline."""
    try:
        return float((s or "").replace(",", "").strip() or 0)
    except (ValueError, TypeError):
        return 0.0


def list_subscriptions_with_summary() -> list[dict]:
    """Return all subscriptions enriched with derived billing-cycle fields.

    Adds `amount_monthly` (= amount / billing_months) and
    `amount_yearly` (= amount * 12 / billing_months) so the dashboard
    can render a "monthly equivalent" total without having to repeat
    the math in JS. Currency stays per-row; FX conversion to the
    user's display currency is the frontend's job.
    """
    subs = load_subscriptions()
    out = []
    for sub in subs.values():
        amt = _safe_float(sub.get("amount", ""))
        cycle = max(1, int((sub.get("billing_months") or "1") or 1))
        monthly = amt / cycle if cycle else 0.0
        out.append({
            **sub,
            "amount_monthly": round(monthly, 4),
            "amount_yearly": round(monthly * 12, 4),
        })
    # Stable sort: active first, then by group + name so the page is
    # deterministic across reloads regardless of CSV row order.
    def _sort_key(s):
        active_rank = 0 if (s.get("active", "").lower() == "true") else 1
        return (active_rank, s.get("group", "").lower(), s.get("name", "").lower())
    out.sort(key=_sort_key)
    return out


def find_log_by_tx(tx_import_id: str) -> dict | None:
    """Return the subscription_log row linked to a TX, or None.

    Used by TX-edit / TX-delete to detect existing links so the cascade
    can fire. tx_import_id is unique per TX so at most one row matches.
    """
    if not tx_import_id:
        return None
    for row in load_subscription_log():
        if row.get("tx_import_id") == tx_import_id:
            return row
    return None


def unlink_tx(tx_import_id: str) -> bool:
    """Remove the subscription_log row pointing to a TX. Returns True if removed.

    Idempotent: if no row matches, returns False without touching the file.
    Caller is responsible for the subscription_log backup before calling.
    """
    if not tx_import_id:
        return False
    rows = load_subscription_log()
    new_rows = [r for r in rows if r.get("tx_import_id") != tx_import_id]
    if len(new_rows) == len(rows):
        return False
    save_subscription_log(new_rows)
    return True


def list_log_for_subscription(subscription_id: str) -> list[dict]:
    """Return all charges linked to a subscription, newest first."""
    if not subscription_id:
        return []
    rows = [r for r in load_subscription_log()
            if r.get("subscription_id") == subscription_id]
    rows.sort(key=lambda r: r.get("date", ""), reverse=True)
    return rows


def list_active_for_picker() -> list[dict]:
    """Return active subscriptions trimmed to fields the TX-link picker needs.

    Used by the Add-TX / Edit-TX dropdowns to populate the optional
    "Link to subscription" select. Inactive rows are filtered out so
    cancelled subs do not pollute the picker. Sort order is
    group → name (case-insensitive) so the dropdown groups visually
    even before any optgroup styling.
    """
    subs = load_subscriptions()
    out = []
    for sub in subs.values():
        if (sub.get("active", "").lower() != "true"):
            continue
        out.append({
            "subscription_id": sub.get("subscription_id", ""),
            "name": sub.get("name", ""),
            "group": sub.get("group", ""),
            "payee": sub.get("payee", ""),
            "amount": sub.get("amount", ""),
            "currency": sub.get("currency", ""),
            "billing_months": sub.get("billing_months", "1"),
        })
    out.sort(key=lambda s: (s["group"].lower(), s["name"].lower()))
    return out


# ── CLI ─────────────────────────────────────────────────────────────────────

def cmd_list(_args: argparse.Namespace) -> int:
    """Print a one-line summary per subscription."""
    rows = list_subscriptions_with_summary()
    if not rows:
        print("(no subscriptions configured)")
        return 0
    for r in rows:
        status = "active" if r.get("active", "").lower() == "true" else "inactive"
        print(
            f"{r['subscription_id']:<20} "
            f"{r.get('group', ''):<14} "
            f"{r.get('name', ''):<32} "
            f"{r.get('amount', ''):>10} {r.get('currency', ''):<4} "
            f"every {r.get('billing_months', '1')}m  [{status}]"
        )
    return 0


# ── Phase 3: Drift Detection ───────────────────────────────────────────────


DEFAULT_DRIFT_THRESHOLD_PCT = 5.0


def compute_drift_alerts(threshold_pct: float = DEFAULT_DRIFT_THRESHOLD_PCT) -> list[dict]:
    """Find subscriptions whose most recent charge is meaningfully higher
    than the prior charge.

    A charge drifts when (last - prev) / prev * 100 >= threshold_pct.
    Inactive subscriptions are skipped (cancelled / paused — the user can't
    act on the alert without first re-activating). Subscriptions with <2
    logged charges are skipped because there's nothing to compare against.

    Returns: list of alert dicts sorted by largest % increase first.
    """
    logs = load_subscription_log()
    subs = load_subscriptions()

    by_sub: dict[str, list[dict]] = {}
    for row in logs:
        sid = (row.get("subscription_id") or "").strip()
        if not sid:
            continue
        by_sub.setdefault(sid, []).append(row)

    alerts: list[dict] = []
    for sid, rows in by_sub.items():
        sub = subs.get(sid)
        if not sub:
            continue
        if (sub.get("active") or "").strip().lower() != "true":
            continue
        # Newest first; tie-break on log_id so duplicate-date posts still
        # have a deterministic order.
        rows.sort(key=lambda r: (r.get("date", ""), r.get("log_id", "")), reverse=True)
        if len(rows) < 2:
            continue
        last, prev = rows[0], rows[1]
        try:
            last_amt = abs(float(last.get("amount") or 0))
            prev_amt = abs(float(prev.get("amount") or 0))
        except (TypeError, ValueError):
            continue
        if prev_amt <= 0 or last_amt <= 0:
            continue
        increase_pct = ((last_amt - prev_amt) / prev_amt) * 100.0
        if increase_pct < threshold_pct:
            continue
        alerts.append({
            "subscription_id": sid,
            "name": sub.get("name", sid),
            "payee": sub.get("payee", ""),
            "group": sub.get("group", ""),
            "last_amount": round(last_amt, 2),
            "prev_amount": round(prev_amt, 2),
            "currency": last.get("currency") or sub.get("currency") or "",
            "last_date": last.get("date", ""),
            "prev_date": prev.get("date", ""),
            "increase_pct": round(increase_pct, 1),
        })

    alerts.sort(key=lambda a: a.get("increase_pct", 0), reverse=True)
    return alerts


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="subscriptions")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="List all subscriptions").set_defaults(func=cmd_list)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
