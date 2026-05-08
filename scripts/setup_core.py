"""FinanceOS Setup-Wizard core (Block C.2).

Pure-logic module that finalizes a fresh FinanceOS instance. Side-effect
boundaries are explicit: every write target is derived from the ``root``
argument so the same code path can be exercised against a temp dir in tests
and against the real project tree in production.

Called by:
  - ``scripts/setup.py`` (CLI wizard, Block C.2)
  - ``scripts/serve.py`` ``/api/setup/finalize`` (Web wizard, Block C.3)

Block C.2a scope: empty-start path (no MMEX). Block C.2b will plug the
MMEX-staging payload into ``run_setup(..., staging=...)``.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Schema version for ``data/.setup_state.json`` — bump when fields change.
SETUP_STATE_SCHEMA_VERSION = 1
WIZARD_VERSION = "1.4.0-rc.2"

# CSV headers — must match data/*.csv exactly. Single source of truth lives
# in docs/schema.md; these constants mirror it.
ACCOUNTS_HEADER = [
    "alias", "name", "currency", "type", "owner", "status",
    "pass_through_payee", "initial_balance", "initial_balance_date", "notes",
]
CATEGORIES_HEADER = ["path", "type", "active", "note", "pnl", "essential"]
TAGS_HEADER = ["tag", "description", "auto_rule", "active"]
TRANSACTIONS_HEADER = [
    "import_id", "date", "account", "type", "amount", "currency", "payee",
    "category", "note", "raw_note", "transfer_to_account",
    "transfer_to_amount", "receipt_group", "receipt_url", "tags",
    "third_party_id",
]


class SetupError(Exception):
    """Raised when setup cannot proceed (already initialized, bad input, ...)."""


# ── Empty-start seed ────────────────────────────────────────────────────────

def empty_seed_accounts(currency: str) -> list[dict[str, str]]:
    """Return the four generic starter accounts in the user-chosen currency."""
    return [
        {
            "alias": "cash", "name": "Cash Wallet", "currency": currency,
            "type": "cash", "owner": "self", "status": "active",
            "pass_through_payee": "", "initial_balance": "0",
            "initial_balance_date": "", "notes": "Daily cash on hand",
        },
        {
            "alias": "checking", "name": "Checking Account", "currency": currency,
            "type": "bank", "owner": "self", "status": "active",
            "pass_through_payee": "", "initial_balance": "0",
            "initial_balance_date": "", "notes": "Primary bank account",
        },
        {
            "alias": "savings", "name": "Savings Account", "currency": currency,
            "type": "savings", "owner": "self", "status": "active",
            "pass_through_payee": "", "initial_balance": "0",
            "initial_balance_date": "", "notes": "Long-term savings",
        },
        {
            "alias": "credit", "name": "Credit Card", "currency": currency,
            "type": "credit", "owner": "self", "status": "active",
            "pass_through_payee": "", "initial_balance": "0",
            "initial_balance_date": "", "notes": "Default credit card",
        },
    ]


# Neutral starter taxonomy — covers the major personal-finance buckets without
# leaking any project-specific upstream categories. Locale-agnostic English.
EMPTY_SEED_CATEGORIES: list[dict[str, str]] = [
    # Income
    {"path": "Income", "type": "income", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Income:Salary", "type": "income", "active": "true", "note": "Regular employment income", "pnl": "true", "essential": "true"},
    {"path": "Income:Bonus", "type": "income", "active": "true", "note": "", "pnl": "true", "essential": "false"},
    {"path": "Income:Dividends", "type": "income", "active": "true", "note": "Stock / fund / ETF dividend distributions", "pnl": "true", "essential": "false"},
    {"path": "Income:Investments", "type": "income", "active": "true", "note": "Capital gains and interest (dividends have their own category)", "pnl": "true", "essential": "false"},
    {"path": "Income:Other", "type": "income", "active": "true", "note": "Catch-all for one-off income", "pnl": "true", "essential": "false"},
    # Bills
    {"path": "Bills", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Bills:Electricity", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Bills:Internet", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Bills:Phone", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Bills:Rent", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Bills:Water", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    # Food
    {"path": "Food", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Food:Groceries", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Food:Dining out", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "false"},
    # Transport
    {"path": "Transport", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Transport:Fuel", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Transport:Public transit", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Transport:Taxi", "type": "expense", "active": "true", "note": "Taxi / rideshare / on-demand", "pnl": "true", "essential": "false"},
    # Healthcare
    {"path": "Healthcare", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Healthcare:Doctor", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Healthcare:Pharmacy", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    # Leisure
    {"path": "Leisure", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "false"},
    {"path": "Leisure:Entertainment", "type": "expense", "active": "true", "note": "Movies, events, hobbies", "pnl": "true", "essential": "false"},
    {"path": "Leisure:Sports", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "false"},
    # Subscriptions
    {"path": "Subscriptions", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "false"},
    {"path": "Subscriptions:Streaming", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "false"},
    {"path": "Subscriptions:Software", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "false"},
    # Travel
    {"path": "Travel", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "false"},
    {"path": "Travel:Flights", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "false"},
    {"path": "Travel:Accommodation", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "false"},
    # Fees
    {"path": "Fees", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Fees:Bank Fees", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    {"path": "Fees:ATM", "type": "expense", "active": "true", "note": "", "pnl": "true", "essential": "true"},
    # Catch-all
    {"path": "Other Expenses", "type": "expense", "active": "true", "note": "Catch-all", "pnl": "true", "essential": "false"},
]


# ── Internal write helpers ─────────────────────────────────────────────────

def _now_iso() -> str:
    """Return current UTC time as ISO-8601 with second precision."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _hash_password(password: str) -> str:
    """Bcrypt-hash a password. Imported lazily so auth=none has no extra dep."""
    try:
        import bcrypt
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise SetupError(
            "bcrypt is required for basic auth. Install with: pip install bcrypt"
        ) from exc
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _write_csv(path: Path, header: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in header})


# ── Public API ─────────────────────────────────────────────────────────────

def check_not_initialized(data_dir: Path) -> None:
    """Refuse to run if ``data/.setup_state.json`` already marks the repo as initialized."""
    state_file = data_dir / ".setup_state.json"
    if not state_file.exists():
        return
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return  # corrupted / unreadable → treat as fresh and let setup overwrite
    if state.get("initialized") is True:
        raise SetupError(
            f"FinanceOS is already initialized (see {state_file}). "
            "Refusing to overwrite. Remove the file to re-run setup."
        )


def write_branding(config_dir: Path, display_name: str, accent_color: str = "#1e40af") -> Path:
    target = config_dir / "branding.json"
    # Mirror display_name into display_name_html so the dashboard sidebar logo
    # (which binds via [data-brand-html]) updates after the wizard finalizes.
    # rc.11 fix — without this the sidebar kept showing the template default.
    _write_json(target, {
        "display_name": display_name,
        "display_name_html": display_name,
        "accent_color": accent_color,
    })
    return target


def write_auth(
    config_dir: Path,
    mode: str,
    user: str | None = None,
    password: str | None = None,
) -> Path:
    """Write ``config/auth.json`` for the chosen auth mode.

    mode='none' writes ``{"mode": "none"}`` only — no credentials stored.
    mode='basic' requires both ``user`` and ``password`` and writes a bcrypt hash.
    """
    target = config_dir / "auth.json"
    if mode == "none":
        payload: dict[str, Any] = {"mode": "none"}
    elif mode == "basic":
        if not user or not password:
            raise SetupError("Basic auth requires both user and password.")
        payload = {
            "mode": "basic",
            "user": user,
            "password_bcrypt": _hash_password(password),
        }
    else:
        raise SetupError(f"Unknown auth mode: {mode!r} (expected 'basic' or 'none')")
    _write_json(target, payload)
    return target


def write_setup_state(
    data_dir: Path,
    *,
    datasource: str,
    default_currency: str,
) -> Path:
    """Mark the repo as initialized and record the wizard run."""
    target = data_dir / ".setup_state.json"
    _write_json(target, {
        "schema_version": SETUP_STATE_SCHEMA_VERSION,
        "wizard_version": WIZARD_VERSION,
        "initialized": True,
        "initialized_at": _now_iso(),
        "datasource": datasource,
        "default_currency": default_currency,
    })
    return target


def write_empty_seed(data_dir: Path, default_currency: str) -> dict[str, int]:
    """Write the empty-start seed CSVs into ``data_dir``. Returns row counts."""
    accounts = empty_seed_accounts(default_currency)
    _write_csv(data_dir / "accounts.csv", ACCOUNTS_HEADER, accounts)
    _write_csv(data_dir / "categories.csv", CATEGORIES_HEADER, EMPTY_SEED_CATEGORIES)
    _write_csv(data_dir / "tags.csv", TAGS_HEADER, [])
    _write_csv(data_dir / "transactions.csv", TRANSACTIONS_HEADER, [])
    # Payees follow the existing FOS convention: JSON list, not CSV.
    _write_json(data_dir / "payees.json", [])
    return {
        "accounts": len(accounts),
        "categories": len(EMPTY_SEED_CATEGORIES),
        "tags": 0,
        "payees": 0,
        "transactions": 0,
    }


# ── MMEX-staging conversion (Block C.2b) ───────────────────────────────────

# Mirrors mmex.py — kept local so we don't import from importers/.
_MMEX_TRANSCODE_EXPENSE = "Withdrawal"
_MMEX_TRANSCODE_INCOME = "Deposit"
_MMEX_TRANSCODE_TRANSFER = "Transfer"

# Canonical FinanceOS account-type vocabulary. The setup wizard offers
# exactly these as the curated choice set; users can still hand-edit
# `data/accounts.csv` to anything else later. Order is the order the
# dropdown shows them in (most-common first). Labels are translated at
# render time on the frontend; the keys stay stable for CSV round-trips.
ACCOUNT_TYPES: list[dict[str, str]] = [
    {"key": "cash",          "label": "Cash",           "hint": "Physical cash on hand"},
    {"key": "bank",          "label": "Bank account",   "hint": "Checking / current account"},
    {"key": "savings",       "label": "Savings",        "hint": "Savings account or term deposit"},
    {"key": "credit",        "label": "Credit card",    "hint": "Carries a credit limit; balance is debt"},
    {"key": "loan",          "label": "Loan",           "hint": "Outgoing personal/business loan"},
    {"key": "mobile_money",  "label": "Mobile money",   "hint": "M-PESA, Airtel Money, Wise, …"},
    {"key": "brokerage",     "label": "Brokerage",      "hint": "Investment / securities account"},
    {"key": "pass_through",  "label": "Pass-through",   "hint": "Held for someone else; auto counter-booked to balance 0"},
    {"key": "custody",       "label": "Custody",        "hint": "Held for someone else; balance excluded from Net Worth"},
    {"key": "other",         "label": "Other",          "hint": "Anything that doesn't fit above"},
]
ACCOUNT_TYPE_KEYS: set[str] = {t["key"] for t in ACCOUNT_TYPES}

# MMEX account-type strings → FOS account-type vocabulary.
# Anything not in the map is passed through lower-cased; the wizard's review
# step (C.2c interactive / C.3 web) is where the user fixes mis-mappings.
_MMEX_ACCOUNT_TYPE_MAP: dict[str, str] = {
    "checking": "bank",
    "savings": "savings",
    "credit card": "credit",
    "cash": "cash",
    "investment": "brokerage",
    "term deposit": "savings",
    "loan": "loan",
    "asset": "other",
}


def _slugify(name: str, *, fallback: str = "account") -> str:
    """ASCII-safe lowercase alias from a free-form name. Empty → fallback."""
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    return s or fallback


def _unique_slug(name: str, taken: set[str], *, fallback: str = "account") -> str:
    """``_slugify(name)`` plus a numeric suffix on collision."""
    base = _slugify(name, fallback=fallback)
    if base not in taken:
        taken.add(base)
        return base
    n = 2
    while f"{base}_{n}" in taken:
        n += 1
    candidate = f"{base}_{n}"
    taken.add(candidate)
    return candidate


def _map_account_type(mmex_type: str) -> str:
    return _MMEX_ACCOUNT_TYPE_MAP.get(mmex_type.strip().lower(), mmex_type.strip().lower())


def _map_account_status(mmex_status: str) -> str:
    """MMEX uses ``Open`` / ``Closed``; FOS uses ``active`` / ``archived``."""
    return "active" if mmex_status.strip().lower().startswith("open") else "archived"


def _generate_import_id(
    date: str, account: str, amount: float, payee: str,
    category: str, note: str, taken: set[str],
) -> str:
    """SHA1-based 12-char id, mirrored from tx_engine.generate_import_id."""
    raw = f"{date}{account}{amount}{payee}{category}{note}"
    base = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
    if base not in taken:
        taken.add(base)
        return base
    n = 2
    while f"{base}_{n}" in taken:
        n += 1
    suffix = f"{base}_{n}"
    taken.add(suffix)
    return suffix


def _format_amount(value: float) -> str:
    """MMEX amounts are floats; FOS stores 2 decimals as plain text.

    Always positive — the transaction `type` column carries the direction
    (expense / income / transfer). Use _format_signed_amount when the sign
    itself is meaningful (e.g. account opening balances, where negative
    means debt on credit cards or loans).
    """
    return f"{abs(float(value)):.2f}"


def _format_signed_amount(value: float) -> str:
    """Like _format_amount but preserves the sign.

    Used for accounts.csv `initial_balance` where MMEX stores negative
    values for credit-card debt or outstanding loans. rc.14 fix: previous
    versions called _format_amount on initial_balance, stripping the sign
    so credit cards started life as positive assets and Net Worth /
    account balances were off by 2 × |initial_balance|.
    """
    return f"{float(value):.2f}"


def _convert_accounts(
    staging_accounts: list[dict[str, Any]],
    default_currency: str,
) -> tuple[list[dict[str, str]], dict[int, str]]:
    """Return (accounts.csv rows, mmex_id → alias lookup)."""
    rows: list[dict[str, str]] = []
    id_to_alias: dict[int, str] = {}
    taken: set[str] = set()
    for acc in staging_accounts:
        # ``preferred_alias`` is set by the C.3 web wizard when the user
        # renames an account on the review screen. It still goes through
        # _unique_slug to enforce slug rules + collision suffixing.
        seed = acc.get("preferred_alias") or acc.get("name", "")
        alias = _unique_slug(seed, taken, fallback="account")
        id_to_alias[int(acc["id"])] = alias
        # ``preferred_type`` (set by the wizard's per-account type dropdown)
        # wins over the MMEX-heuristic mapping. If the user picked
        # "custody" via the type dropdown we also want owner != self so
        # the account drops out of Net Worth correctly.
        chosen_type = acc.get("preferred_type") or _map_account_type(acc.get("type", ""))
        owner = acc.get("preferred_owner") or ("self" if chosen_type != "custody" else "custody")
        rows.append({
            "alias": alias,
            "name": acc.get("name", "") or alias,
            "currency": acc.get("currency_code") or default_currency,
            "type": chosen_type,
            "owner": owner,
            "status": _map_account_status(acc.get("status", "")),
            "pass_through_payee": acc.get("preferred_pass_through_payee", ""),
            "initial_balance": _format_signed_amount(acc.get("initial_balance", 0.0)),
            "initial_balance_date": acc.get("initial_date") or "",
            "notes": acc.get("notes", "") or "",
        })
    return rows, id_to_alias


def _convert_categories(
    staging_categories: list[dict[str, Any]],
) -> tuple[list[dict[str, str]], dict[int, str]]:
    """Return (categories.csv rows, mmex_id → full_path lookup)."""
    rows: list[dict[str, str]] = []
    id_to_path: dict[int, str] = {}
    seen_paths: set[str] = set()
    for cat in staging_categories:
        path = cat.get("full_path") or cat.get("name") or ""
        if not path or path in seen_paths:
            # Skip duplicates (legacy schemas can produce them) — keep first.
            id_to_path[int(cat["id"])] = path
            continue
        seen_paths.add(path)
        id_to_path[int(cat["id"])] = path
        top = path.split(":", 1)[0].strip().lower()
        cat_type = "income" if top == "income" else "expense"
        rows.append({
            "path": path,
            "type": cat_type,
            "active": "true",
            "note": "",
            "pnl": "true",
            "essential": "false",
        })
    return rows, id_to_path


def _convert_payees(
    staging_payees: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[int, str]]:
    """Return (payees.json entries, mmex_id → name lookup)."""
    entries: list[dict[str, Any]] = []
    id_to_name: dict[int, str] = {}
    used_ids: set[str] = set()
    for p in staging_payees:
        name = p.get("name", "") or ""
        if not name:
            continue
        slug = _unique_slug(name, used_ids, fallback="payee")
        id_to_name[int(p["id"])] = name
        entries.append({
            "id": slug,
            "payee": name,
            "aliases": [],
            "default_category": "",
            "default_account": "",
            "auto_tag": "",
            "notes": "",
            "group": "",
        })
    return entries, id_to_name


def _convert_tags(
    staging_tags: list[dict[str, Any]],
) -> tuple[list[dict[str, str]], dict[int, str]]:
    """Return (tags.csv rows, mmex_id → tag-name lookup)."""
    rows: list[dict[str, str]] = []
    id_to_name: dict[int, str] = {}
    seen: set[str] = set()
    for t in staging_tags:
        name = (t.get("name") or "").strip()
        if not name:
            continue
        id_to_name[int(t["id"])] = name
        if name in seen:
            continue
        seen.add(name)
        rows.append({
            "tag": name,
            "description": "",
            "auto_rule": "",
            "active": "true",
        })
    return rows, id_to_name


def _convert_transactions(
    staging_transactions: list[dict[str, Any]],
    accounts_by_id: dict[int, str],
    accounts_index: dict[int, dict[str, Any]],
    categories_by_id: dict[int, str],
    payees_by_id: dict[int, str],
    tags_by_id: dict[int, str],
) -> tuple[list[dict[str, str]], list[str]]:
    """Convert staging transactions into transactions.csv rows.

    Splits become N rows sharing a ``receipt_group``. Transfers become a
    single row with ``transfer_to_account`` / ``transfer_to_amount`` set.
    """
    rows: list[dict[str, str]] = []
    warnings: list[str] = []
    taken_ids: set[str] = set()

    def _account_currency(acc_id: int) -> str:
        info = accounts_index.get(acc_id, {})
        return (info.get("currency_code") or "").strip()

    for tx in staging_transactions:
        date = tx.get("date") or ""
        account_id = tx.get("account_id")
        if account_id is None or account_id not in accounts_by_id:
            warnings.append(f"tx {tx.get('id')}: unknown account_id={account_id}, skipped")
            continue
        account_alias = accounts_by_id[account_id]
        currency = _account_currency(account_id)
        payee_name = payees_by_id.get(tx.get("payee_id"), "") if tx.get("payee_id") else ""
        note = tx.get("notes") or ""
        tag_names = [tags_by_id[t] for t in tx.get("tag_ids", []) if t in tags_by_id]
        tags_field = ";".join(tag_names)

        trans_code = tx.get("trans_code") or ""
        amount = float(tx.get("amount") or 0.0)

        # Transfer
        if trans_code == _MMEX_TRANSCODE_TRANSFER:
            to_acc_id = tx.get("to_account_id")
            if to_acc_id is None or to_acc_id not in accounts_by_id:
                warnings.append(f"tx {tx.get('id')}: transfer to unknown account_id={to_acc_id}, skipped")
                continue
            to_amount = tx.get("to_amount")
            if to_amount in (None, 0, 0.0):
                to_amount = amount
            to_alias = accounts_by_id[to_acc_id]
            category = ""  # transfers carry no category in FOS
            row = {
                "import_id": _generate_import_id(date, account_alias, amount, "", category, note, taken_ids),
                "date": date,
                "account": account_alias,
                "type": "transfer",
                "amount": _format_amount(amount),
                "currency": currency,
                "payee": "",
                "category": category,
                "note": note,
                "raw_note": "",
                "transfer_to_account": to_alias,
                "transfer_to_amount": _format_amount(to_amount),
                "receipt_group": "",
                "receipt_url": "",
                "tags": tags_field,
                "third_party_id": "",
            }
            rows.append(row)
            continue

        # Type from trans_code
        if trans_code == _MMEX_TRANSCODE_EXPENSE:
            tx_type = "expense"
        elif trans_code == _MMEX_TRANSCODE_INCOME:
            tx_type = "income"
        else:
            warnings.append(f"tx {tx.get('id')}: unknown trans_code={trans_code!r}, treated as expense")
            tx_type = "expense"

        splits = tx.get("splits") or []
        if splits:
            # One row per split, all sharing a receipt_group derived from the
            # MMEX TRANSID so re-imports are deterministic.
            receipt_group = f"mmex-split-{tx.get('id')}"
            for idx, sp in enumerate(splits, start=1):
                cat_id = sp.get("category_id")
                category = categories_by_id.get(cat_id, "") if cat_id else ""
                sp_note = sp.get("notes") or note
                sp_amount = float(sp.get("amount") or 0.0)
                row = {
                    "import_id": _generate_import_id(
                        date, account_alias, sp_amount, payee_name, category,
                        f"{sp_note}#{idx}", taken_ids,
                    ),
                    "date": date,
                    "account": account_alias,
                    "type": tx_type,
                    "amount": _format_amount(sp_amount),
                    "currency": currency,
                    "payee": payee_name,
                    "category": category,
                    "note": sp_note,
                    "raw_note": "",
                    "transfer_to_account": "",
                    "transfer_to_amount": "",
                    "receipt_group": receipt_group,
                    "receipt_url": "",
                    "tags": tags_field,
                    "third_party_id": "",
                }
                rows.append(row)
            continue

        # Single-line expense / income
        cat_id = tx.get("category_id")
        category = categories_by_id.get(cat_id, "") if cat_id else ""
        row = {
            "import_id": _generate_import_id(date, account_alias, amount, payee_name, category, note, taken_ids),
            "date": date,
            "account": account_alias,
            "type": tx_type,
            "amount": _format_amount(amount),
            "currency": currency,
            "payee": payee_name,
            "category": category,
            "note": note,
            "raw_note": "",
            "transfer_to_account": "",
            "transfer_to_amount": "",
            "receipt_group": "",
            "receipt_url": "",
            "tags": tags_field,
            "third_party_id": "",
        }
        rows.append(row)

    return rows, warnings


def write_mmex_seed(
    data_dir: Path,
    staging: dict[str, Any],
    default_currency: str,
) -> dict[str, int]:
    """Convert a C.1 MMEX staging payload into the six CSV/JSON files."""
    accounts_rows, id_to_alias = _convert_accounts(
        staging.get("accounts", []),
        default_currency,
    )
    categories_rows, id_to_path = _convert_categories(staging.get("categories", []))
    payees_entries, id_to_payee_name = _convert_payees(staging.get("payees", []))
    tag_rows, id_to_tag_name = _convert_tags(staging.get("tags", []))

    accounts_index = {int(a["id"]): a for a in staging.get("accounts", [])}
    tx_rows, tx_warnings = _convert_transactions(
        staging.get("transactions", []),
        id_to_alias,
        accounts_index,
        id_to_path,
        id_to_payee_name,
        id_to_tag_name,
    )

    _write_csv(data_dir / "accounts.csv", ACCOUNTS_HEADER, accounts_rows)
    _write_csv(data_dir / "categories.csv", CATEGORIES_HEADER, categories_rows)
    _write_csv(data_dir / "tags.csv", TAGS_HEADER, tag_rows)
    _write_csv(data_dir / "transactions.csv", TRANSACTIONS_HEADER, tx_rows)
    _write_json(data_dir / "payees.json", payees_entries)

    return {
        "accounts": len(accounts_rows),
        "categories": len(categories_rows),
        "tags": len(tag_rows),
        "payees": len(payees_entries),
        "transactions": len(tx_rows),
        "warnings": len(staging.get("warnings", [])) + len(tx_warnings),
    }


def run_setup(
    config: dict[str, Any],
    *,
    root: Path | None = None,
    staging: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run the end-to-end setup. Returns a summary dict for the caller to print.

    Required ``config`` keys:
      - ``brand``: display name (str)
      - ``currency``: default ISO-4217 code (str)
      - ``auth_mode``: ``'basic'`` or ``'none'``
      - ``datasource``: ``'empty'`` or ``'mmex'``

    Optional:
      - ``accent_color`` (default '#1e40af')
      - ``auth_user`` / ``auth_password`` — required when auth_mode='basic'
      - ``features`` — dict of feature toggles; written to features.json if given

    ``staging`` is the C.1 MMEX payload; only used when datasource='mmex'
    (wired up in C.2b — currently raises NotImplementedError).
    """
    root = root or Path.cwd()
    config_dir = root / "config"
    data_dir = root / "data"

    check_not_initialized(data_dir)

    # Accept either {brand: "name", accent_color: "#hex"} (CLI shape) or
    # {brand: {display_name, accent_color}} (web wizard shape). The web
    # wizard nests them inside `brand`, the CLI keeps them flat — both
    # call run_setup with their native config dict, so normalise here.
    brand_cfg = config["brand"]
    if isinstance(brand_cfg, dict):
        display_name = brand_cfg.get("display_name") or "FinanceOS"
        accent_color = brand_cfg.get("accent_color") or config.get("accent_color", "#1e40af")
    else:
        display_name = str(brand_cfg) or "FinanceOS"
        accent_color = config.get("accent_color", "#1e40af")
    write_branding(config_dir, display_name, accent_color)
    write_auth(
        config_dir,
        config["auth_mode"],
        user=config.get("auth_user"),
        password=config.get("auth_password"),
    )

    datasource = config["datasource"]
    if datasource == "empty":
        counts = write_empty_seed(data_dir, config["currency"])
    elif datasource == "mmex":
        if staging is None:
            raise SetupError("MMEX datasource requires a staging payload.")
        counts = write_mmex_seed(data_dir, staging, config["currency"])
    else:
        raise SetupError(f"Unknown datasource: {datasource!r}")

    features = config.get("features")
    if features is not None:
        _write_json(config_dir / "features.json", features)

    # config/reports.json — only written if the user picked "customize" in the
    # wizard step. With "defaults" / no payload, the file stays absent and
    # config_loader falls back to the canonical defaults.
    reports_cfg = config.get("reports_config")
    if reports_cfg:
        from config_loader import save_reports_config
        save_reports_config(reports_cfg)

    state_path = write_setup_state(
        data_dir,
        datasource=datasource,
        default_currency=config["currency"],
    )

    return {
        "brand": config["brand"],
        "currency": config["currency"],
        "auth_mode": config["auth_mode"],
        "datasource": datasource,
        "counts": counts,
        "state_file": str(state_path),
    }
