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
import calendar
import csv
import re
import sys
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import alert_acks  # noqa: E402
import tx_engine  # noqa: E402
from backup import backup_file  # noqa: E402

DATA_DIR = REPO_ROOT / "data"
SUBSCRIPTIONS_CSV = DATA_DIR / "subscriptions.csv"
SUBSCRIPTION_LOG_CSV = DATA_DIR / "subscription_log.csv"

# A charge counts as drifted once it moves this far from the previous
# one; also the tolerance for matching a charge to a subscription.
DEFAULT_DRIFT_THRESHOLD_PCT = 5.0

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


def _csv_content_changed(path, columns: list[str], rows: list[dict]) -> bool:
    """Return True if writing ``rows`` to ``path`` would change the file.

    Used to gate backup_file() calls (H-18, Sprint 10): every save_subscriptions
    used to create a fresh backup, and a rapid edit session of >30 saves
    could roll the last good snapshot out of the 30-retain ring before any
    corruption was noticed. Now we skip the backup when the new content
    matches what's already on disk, which is the common case in edit
    sessions (open modal → no actual change → save).
    """
    if not path.exists():
        return True
    import io
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({c: ("" if row.get(c) is None else row.get(c, "")) for c in columns})
    try:
        return path.read_text(encoding="utf-8") != buf.getvalue()
    except OSError:
        return True


def save_subscriptions(subs: dict[str, dict]) -> None:
    """Atomically rewrite subscriptions.csv from a dict keyed by subscription_id.

    H-18 (Sprint 10): backup_file() only fires when the would-be content
    actually differs from disk. The atomic rewrite still happens (cheap)
    so the file's mtime stays current and any cron-mtime check still
    triggers, but the backup ring is no longer spammed by no-op saves.
    """
    rows = [
        {col: v.get(col, "") for col in SUBSCRIPTION_COLUMNS}
        for v in subs.values()
    ]
    if _csv_content_changed(SUBSCRIPTIONS_CSV, SUBSCRIPTION_COLUMNS, rows):
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
    """Atomically rewrite subscription_log.csv.

    H-18 (Sprint 10): same content-changed gate as save_subscriptions so
    the subscription_log backup ring doesn't get rotated out by no-op
    saves either.
    """
    if _csv_content_changed(SUBSCRIPTION_LOG_CSV, SUBSCRIPTION_LOG_COLUMNS, rows):
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


def batch_link_tx_to_subscription(
    tx_import_ids: list[str], subscription_id: str
) -> dict:
    """Link a batch of TXs to a subscription via subscription_log rows.

    For each ``tx_import_id`` in the list, looks up the TX row to copy
    date/amount/currency/account into the new subscription_log entry.
    TXs already linked to the same subscription are skipped silently
    (idempotent re-runs). TXs linked to a DIFFERENT subscription are
    reported in ``skipped`` so the UI can show "X linked, Y already on
    another subscription" — matches the user's chosen Skip-with-Hint
    behavior, not the more aggressive overwrite path.

    Returns:
        {linked: int, skipped: [{import_id, reason, existing_subscription_id?}],
         missing: [import_id]}. ``missing`` covers IDs that don't exist
        in transactions.csv (most likely a stale frontend selection).
    """
    if not subscription_id or not tx_import_ids:
        return {"linked": 0, "skipped": [], "missing": list(tx_import_ids or [])}

    # Three writers touch subscriptions.csv / subscription_log.csv:
    # serve.py's TX-confirm mirror, cron_sched's SCHED mirror, and this
    # batch link. All three must serialize their read-modify-write cycles
    # under the same lock or a concurrent booking can clobber this batch's
    # rewrite (or vice versa) — last full-file rewrite wins. tx_write_lock
    # is reentrant, so nested acquisitions inside save_subscription_log /
    # save_subscriptions (if any) are safe.
    with tx_engine.tx_write_lock():
        # Index existing log rows by tx_import_id — lets us detect both
        # same-sub idempotency and cross-sub conflicts in O(1) per TX.
        existing_log = load_subscription_log()
        log_by_tx: dict[str, dict] = {}
        for r in existing_log:
            tid = (r.get("tx_import_id") or "").strip()
            if tid:
                log_by_tx[tid] = r

        # Load all transactions once so we can resolve every requested
        # import_id without re-reading the file per row.
        tx_path = tx_engine.DATA_DIR / "transactions.csv"
        tx_by_id: dict[str, dict] = {}
        if tx_path.exists():
            with open(tx_path, newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    tx_by_id[row["import_id"]] = row

        linked = 0
        skipped: list[dict] = []
        missing: list[str] = []
        new_rows: list[dict] = []
        for tid in tx_import_ids:
            tx = tx_by_id.get(tid)
            if tx is None:
                missing.append(tid)
                continue
            existing = log_by_tx.get(tid)
            if existing is not None:
                existing_sub = (existing.get("subscription_id") or "").strip()
                if existing_sub == subscription_id:
                    skipped.append({
                        "import_id": tid, "reason": "already_linked",
                        "existing_subscription_id": existing_sub,
                    })
                else:
                    skipped.append({
                        "import_id": tid, "reason": "linked_to_other",
                        "existing_subscription_id": existing_sub,
                    })
                continue
            new_rows.append({
                "log_id": "",  # filled below
                "date": (tx.get("date") or "").strip(),
                "subscription_id": subscription_id,
                "amount": (tx.get("amount") or "").strip(),
                "currency": (tx.get("currency") or "").strip(),
                "account": (tx.get("account") or "").strip(),
                "tx_import_id": tid,
                "note": "",
            })

        # Single rewrite at the end (one backup) instead of N appends.
        # next_log_id() reads the file each call, so we manually advance
        # the counter for the batch — otherwise every row in `new_rows`
        # would compete for the same id before the first save flushed.
        if new_rows:
            rows = existing_log[:]
            # Match next_log_id's `slog-NNN` convention. Pre-compute max so
            # the batch shares one save_subscription_log() backup write.
            max_num = 0
            for r in existing_log:
                m = re.match(r"^slog-(\d+)$", (r.get("log_id") or "").strip())
                if m:
                    max_num = max(max_num, int(m.group(1)))
            for r in new_rows:
                max_num += 1
                r["log_id"] = f"slog-{max_num:03d}"
                rows.append(r)
                linked += 1
            save_subscription_log(rows)

            # Renewal roll: the newest linked charge implies the next renewal.
            # Monotonic by design (rolled_renewal_after_charge), so linking a
            # batch of historical charges never moves the date backwards.
            # Failures must not undo the link itself.
            newest = max((r.get("date") or "" for r in new_rows), default="")
            if newest:
                try:
                    roll_renewal_for_charge(subscription_id, newest)
                except Exception as exc:
                    print(f"[subscriptions] renewal roll failed for "
                          f"{subscription_id}: {exc}", file=sys.stderr)

    return {"linked": linked, "skipped": skipped, "missing": missing}


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


def list_log_all() -> list[dict]:
    """Return every subscription_log row, newest first.

    Powers the Subscriptions page's cost-over-time chart — one fetch
    beats N per-subscription calls, and the file stays small (one row
    per linked charge). Tie-break on log_id keeps same-day rows stable.
    """
    rows = load_subscription_log()
    rows.sort(key=lambda r: (r.get("date", ""), r.get("log_id", "")), reverse=True)
    return rows


# ── Renewal rolling ─────────────────────────────────────────────────────────

# Days an overdue next_renewal stays visible before the daily cron
# advances it. Without the grace window the cron would hide every
# overdue state the morning after it appears — the user needs a few
# days to notice and link the charge (or investigate a missed one).
RENEWAL_GRACE_DAYS = 7

# Mirrors cron_sched.advance_next_run's runaway guard: a corrupt row
# can never make the catch-up loop spin forever.
_ROLL_ITERATION_CAP = 120


def add_months(d: date, months: int) -> date:
    """Return ``d`` shifted forward by ``months`` calendar months.

    The day-of-month is clamped to the target month's length, so
    Jan 31 + 1 month lands on Feb 28 (29 in leap years) instead of
    raising — same semantics the scheduled-TX frequency parser uses.
    """
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(d.day, last_day))


def _parse_iso(value: str) -> date | None:
    """Lenient ISO-date parse: None on any malformed/empty input."""
    try:
        return date.fromisoformat((value or "").strip())
    except (ValueError, TypeError):
        return None


def _billing_months(sub: dict) -> int:
    """billing_months as a safe positive int (malformed rows count as monthly)."""
    try:
        return max(1, int((sub.get("billing_months") or "1").strip() or 1))
    except (ValueError, AttributeError):
        return 1


def rolled_renewal_after_charge(sub: dict, charge_date: str) -> str | None:
    """Return the next_renewal a charge implies, or None when no roll applies.

    The candidate is charge date + billing_months. The roll is strictly
    monotonic: linking an OLD charge (history backfill) whose implied
    renewal is on or before the current next_renewal returns None, so
    imports never move the date backwards. An empty or unparseable
    current next_renewal counts as "no date yet" and always rolls.
    """
    paid = _parse_iso(charge_date)
    if paid is None:
        return None
    candidate = add_months(paid, _billing_months(sub))
    current = _parse_iso(sub.get("next_renewal", ""))
    if current is not None and candidate <= current:
        return None
    return candidate.isoformat()


def roll_renewal_for_charge(subscription_id: str, charge_date: str) -> str | None:
    """Persist the charge-implied next_renewal for one subscription.

    Loads the master, applies rolled_renewal_after_charge and saves only
    when the date actually moves. Returns the new ISO date or None.
    Callers treat failures as non-fatal — the charge itself is already
    booked; the daily cron fallback catches the date up later.
    """
    subs = load_subscriptions()
    sub = subs.get((subscription_id or "").strip())
    if not sub:
        return None
    new_date = rolled_renewal_after_charge(sub, charge_date)
    if not new_date:
        return None
    sub["next_renewal"] = new_date
    save_subscriptions(subs)
    return new_date


def roll_overdue_renewals(today: date | None = None,
                          grace_days: int = RENEWAL_GRACE_DAYS,
                          dry_run: bool = False) -> list[dict]:
    """Cron fallback: advance next_renewal for active subs more than
    ``grace_days`` overdue, in billing_months steps until >= today.

    Returns a change list of {subscription_id, old, new}; empty when
    nothing rolled. ``dry_run`` computes the same list without writing —
    used by cron_sched --dry.
    """
    today = today or date.today()
    subs = load_subscriptions()
    changed: list[dict] = []
    for sid, sub in subs.items():
        if (sub.get("active") or "").strip().lower() != "true":
            continue
        due = _parse_iso(sub.get("next_renewal", ""))
        if due is None or (today - due).days <= grace_days:
            continue
        months = _billing_months(sub)
        nxt = due
        for _ in range(_ROLL_ITERATION_CAP):
            nxt = add_months(nxt, months)
            if nxt >= today:
                break
        changed.append({"subscription_id": sid,
                        "old": due.isoformat(), "new": nxt.isoformat()})
        sub["next_renewal"] = nxt.isoformat()
    if changed and not dry_run:
        save_subscriptions(subs)
    return changed


# Amount tolerance for matching a statement row against a subscription.
# Reuses the drift threshold: a price move small enough to be "the same
# subscription, slightly repriced" is exactly what the drift alert
# tolerates before it speaks up.
MATCH_AMOUNT_TOLERANCE_PCT = DEFAULT_DRIFT_THRESHOLD_PCT

# Slack on the period guard below. The bank posts a recurring charge
# within a few days of its nominal date, so the previous period's log
# entry must not be mistaken for one inside the current period.
MATCH_PERIOD_GRACE_DAYS = 7


def _expected_charge(sub: dict, account: str) -> float:
    """What this subscription should cost on ``account``, or 0.

    Most subscriptions are priced in USD/EUR but settle on a TZS
    account, so the master amount is not comparable to the statement
    figure. The most recent logged charge on the same account is — it is
    already in the account's currency and carries the bank's FX markup.
    The master price is only used as a fallback when the subscription is
    billed in the account's own currency; otherwise there is nothing
    meaningful to compare and the caller must not match.
    """
    last = _last_logged_amount(sub.get("subscription_id", ""), account)
    if last > 0:
        return last
    sub_currency = (sub.get("currency") or "").strip().upper()
    account_currency = ""
    try:
        account_currency = (tx_engine.load_accounts()
                            .get(account, {})
                            .get("currency", "") or "").strip().upper()
    except Exception:
        return 0.0
    if not sub_currency or sub_currency != account_currency:
        return 0.0
    return _safe_float(sub.get("amount", ""))


def _last_logged_amount(subscription_id: str, account: str) -> float:
    """Amount of the newest logged charge for this sub on this account."""
    sid = (subscription_id or "").strip()
    if not sid:
        return 0.0
    rows = [
        r for r in load_subscription_log()
        if (r.get("subscription_id") or "").strip() == sid
        and (r.get("account") or "").strip() == account
    ]
    if not rows:
        return 0.0
    # Newest first; tie-break on log_id so same-day posts stay ordered.
    rows.sort(key=lambda r: (r.get("date", ""), r.get("log_id", "")), reverse=True)
    return _safe_float(rows[0].get("amount", ""))


def resolve_links_for_lines(lines: list[dict]) -> int:
    """Fill in subscription_id on booking lines that lack one.

    For callers that assemble lines themselves and post them straight to
    /api/tx/confirm — today the dashboard's Reconciliation tab — where no
    subscription picker was ever shown. Keeping this server-side means
    the matching rules exist once, in Python, instead of a second
    approximation in JS.

    Only plain expense lines are considered: income and transfers cannot
    settle a subscription, and auto-generated counter-entries mirror an
    expense that is linked already. An explicit subscription_id is never
    overwritten — the user's choice outranks the matcher.

    Lines are resolved one at a time and a subscription is handed out at
    most once per batch: the period guard reads subscription_log, which
    this batch has not written yet, so two same-period charges in one
    request would otherwise both claim the same subscription.

    Returns the number of lines that gained a link. Never raises — a
    failure here must leave the booking itself untouched.
    """
    linked = 0
    claimed: set[str] = set()
    for line in lines:
        if line.get("subscription_id") or line.get("is_auto_generated"):
            continue
        if line.get("type") != "expense" or not line.get("payee"):
            continue
        try:
            sid = match_for_charge(
                line.get("payee", ""), line.get("account", ""),
                float(line.get("amount", 0) or 0), line.get("date", ""))
        except Exception:
            continue
        if not sid or sid in claimed:
            continue
        line["subscription_id"] = sid
        claimed.add(sid)
        linked += 1
    return linked


def subscription_candidates(payee: str, account: str) -> list[str]:
    """Active subscription ids sharing this payee and account, any amount.

    Looser than match_for_charge on purpose: it answers "could this row
    belong to a subscription?" rather than "does it, beyond doubt?". The
    reconciliation import uses it to flag rows it is sending to the ask
    bucket, so a recurring charge is never booked without the question
    of its subscription link at least being raised.
    """
    key = (payee or "").strip().lower()
    acct = (account or "").strip()
    if not key or not acct:
        return []
    return [
        (sub.get("subscription_id") or "").strip()
        for sub in load_subscriptions().values()
        if (sub.get("active") or "").strip().lower() == "true"
        and (sub.get("payee") or "").strip().lower() == key
        and (sub.get("account") or "").strip() == acct
        and (sub.get("subscription_id") or "").strip()
    ]


def match_for_charge(payee: str, account: str, amount: float,
                     charge_date: str) -> str:
    """Return the subscription_id a charge belongs to, or "".

    Used by the reconciliation import so a booked statement row carries
    its subscription link from the start — without it subscription_log
    stays empty and next_renewal never rolls off the real charge.

    This runs unattended, so it is deliberately strict; a wrong link is
    worse than no link. All of the following must hold:

    * the subscription is active
    * payee matches case-insensitively (both sides trimmed, both set)
    * account matches exactly (an unset column is not a wildcard)
    * the amount is within MATCH_AMOUNT_TOLERANCE_PCT of the expected
      charge (see _expected_charge — the last real charge, or the master
      price when the subscription is billed in the account's currency)
    * exactly one subscription qualifies — ambiguity asks a human
    * no charge is already logged inside the current billing period,
      which would make this a duplicate or an extra purchase

    Returns "" whenever any check fails or the inputs are unparseable.
    """
    key = (payee or "").strip().lower()
    acct = (account or "").strip()
    if not key or not acct:
        return ""
    try:
        charged = float(amount)
    except (TypeError, ValueError):
        return ""

    candidates = []
    for sub in load_subscriptions().values():
        if (sub.get("active") or "").strip().lower() != "true":
            continue
        if (sub.get("payee") or "").strip().lower() != key:
            continue
        if (sub.get("account") or "").strip() != acct:
            continue
        expected = _expected_charge(sub, acct)
        if expected <= 0:
            continue
        if abs(charged - expected) / expected * 100 > MATCH_AMOUNT_TOLERANCE_PCT:
            continue
        candidates.append(sub)

    if len(candidates) != 1:
        return ""
    sub = candidates[0]
    sid = (sub.get("subscription_id") or "").strip()
    if not sid or _has_logged_charge_in_period(sid, sub, charge_date):
        return ""
    return sid


def _has_logged_charge_in_period(subscription_id: str, sub: dict,
                                 charge_date: str) -> bool:
    """True when this subscription already logged a charge this period.

    The period is the billing cycle ending at ``charge_date``, shortened
    by MATCH_PERIOD_GRACE_DAYS at the start so the *previous* cycle's
    entry stays outside it even when the bank posts a few days early or
    late. An unparseable date is treated as "blocked" — the safe answer
    when the guard cannot be evaluated.
    """
    charged_on = _parse_iso(charge_date)
    if not charged_on:
        return True
    window_start = add_months(charged_on, -_billing_months(sub))
    window_start += timedelta(days=MATCH_PERIOD_GRACE_DAYS)
    for row in load_subscription_log():
        if (row.get("subscription_id") or "").strip() != subscription_id:
            continue
        logged_on = _parse_iso(row.get("date", ""))
        if logged_on and window_start < logged_on <= charged_on:
            return True
    return False


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
            # Fingerprint of *this* jump — the charge that triggered it.
            # The next price step carries a different date/amount, so an
            # ack here cannot swallow it.
            "ack_key": alert_acks.ack_key(
                "sub_drift", sid, last.get("date", ""), f"{last_amt:.2f}"),
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
