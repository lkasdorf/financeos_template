"""Shared transaction processing engine for FinanceOS.

This module is the core data layer — it is imported by serve.py (API server),
cron_sched.py (scheduled TX execution), cron_fx.py (FX rate commits),
and cron_integrity.py (data validation). It should NOT be run directly.

Key responsibilities:
    - CSV CRUD for all data files (transactions, accounts, categories,
      payees, tags, scheduled, debts, quick expenses, prompt log)
    - Amount parsing with shorthand notation (45k, 2.5m)
    - Import ID generation (SHA1-based, collision-resistant)
    - Auto-tag application (business accounts, known payees)
    - Pass-through counter-entry generation for business reimbursements
    - Transaction validation (account, category, currency, amount checks)
    - Git operations (commit + push after every data mutation)

Data model:
    All data lives in CSV/JSON files under data/. There is no database.
    This keeps the system portable, version-controlled, and inspectable.
    The trade-off is that concurrent writes could conflict — mitigated by
    the single-user design and mandatory backup-before-write rule.
"""

from __future__ import annotations

import csv
import functools
import io
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

# Local config loader (sibling module). Path append keeps both direct script
# execution and `from scripts.tx_engine import ...` import styles working.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import config_loader  # noqa: E402

# ── Path Constants ──────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

# Cross-platform "no console flash" subprocess kwargs. On Windows, Python's
# default subprocess invocation pops up a transient console window for each
# child process — visible to the user as a flash on every git commit. The
# CREATE_NO_WINDOW flag (0x08000000) suppresses that. Non-Windows: no-op.
_NO_WINDOW_KWARGS: dict = {"creationflags": 0x08000000} if sys.platform == "win32" else {}


def _windowless_python() -> str:
    """Pick the python interpreter that does NOT pop a console window.

    On Windows, ``python.exe`` is a console application — even with
    ``CREATE_NO_WINDOW`` it briefly attaches/detaches a console host
    (visible as a flash). ``pythonw.exe`` is the GUI variant that has
    no console at all. Use it for detached background spawns where
    we have no use for the console anyway.
    """
    if sys.platform != "win32":
        return sys.executable
    candidate = Path(sys.executable).with_name("pythonw.exe")
    return str(candidate) if candidate.exists() else sys.executable


# Cross-platform exclusive file lock for cross-process serialization of
# transactions.csv rewrites. HTTPServer alone is single-threaded, but cron
# jobs (cron_sched.py) and the PWA sync path run concurrently and all
# rewrite the same file whole. The lock is held only for the duration of
# one CRUD call.
if sys.platform == "win32":
    import msvcrt

    def _lock_fh(fh) -> None:
        msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)

    def _unlock_fh(fh) -> None:
        try:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
else:
    import fcntl

    def _lock_fh(fh) -> None:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)

    def _unlock_fh(fh) -> None:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass


@contextmanager
def tx_write_lock():
    """Hold an exclusive cross-process lock on transactions.csv."""
    lock_path = DATA_DIR / ".transactions.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "a") as fh:
        _lock_fh(fh)
        try:
            yield
        finally:
            _unlock_fh(fh)


def with_tx_lock(fn):
    """Decorator: hold tx_write_lock for the duration of the call.

    Applied to every function that reads-then-rewrites transactions.csv, so
    concurrent writers (server + cron_sched + any future process) cannot
    interleave and lose updates.
    """
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with tx_write_lock():
            return fn(*args, **kwargs)
    return wrapper


def _atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    """Write text to `path` atomically.

    A crash mid-write (disk full, power loss) leaves the original file
    intact because the replace is an OS-level atomic rename on the same
    filesystem. Callers never observe a truncated JSON/CSV.
    """
    tmp_fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent),
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(tmp_fd, "w", encoding=encoding, newline="") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise


def _atomic_csv_rewrite(
    path: Path,
    fieldnames: list[str],
    rows: list[dict],
    extrasaction: str = "raise",
) -> None:
    """Rewrite a CSV file atomically (header + rows).

    Builds the full CSV in memory via StringIO, then hands the string to
    :func:`_atomic_write_text` — so a crash during update_transaction /
    delete_transaction / batch_* can never leave a truncated
    transactions.csv. Use this instead of ``open(path, "w")`` for any
    full-file CSV rewrite.
    """
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction=extrasaction)
    writer.writeheader()
    writer.writerows(rows)
    _atomic_write_text(path, buf.getvalue())


# ── Data Loading ─────────────────────────────────────────────────────────────

def load_accounts() -> dict[str, dict]:
    """Load accounts.csv as dict keyed by alias (e.g. 'crdb', 'cash', 'kft')."""
    accounts = {}
    with open(DATA_DIR / "accounts.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            accounts[row["alias"]] = row
    return accounts


def load_categories() -> dict[str, dict]:
    """Load categories.csv as dict keyed by hierarchical path (e.g. 'Food:Groceries')."""
    cats = {}
    with open(DATA_DIR / "categories.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cats[row["path"]] = row
    return cats


def load_existing_import_ids() -> set[str]:
    """Load all import_ids from transactions.csv for collision detection."""
    ids = set()
    tx_path = DATA_DIR / "transactions.csv"
    if not tx_path.exists():
        return ids
    with open(tx_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            ids.add(row["import_id"])
    return ids


def load_payees() -> list[dict]:
    """Load payees from data/payees.json."""
    json_path = DATA_DIR / "payees.json"
    if not json_path.exists():
        return []
    return json.loads(json_path.read_text(encoding="utf-8"))


def save_payees(payees: list[dict]) -> None:
    """Write payees to data/payees.json."""
    json_path = DATA_DIR / "payees.json"
    _atomic_write_text(
        json_path,
        json.dumps(payees, indent=2, ensure_ascii=False) + "\n",
    )


def _slugify(text: str) -> str:
    """Convert text to a URL/ID-safe slug (e.g. 'Whole Foods Market' -> 'whole-foods-market')."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def add_payee(data: dict) -> str:
    """Add a payee to payees.json. Returns the auto-generated slug ID.

    If the slugified payee name collides with an existing ID, appends
    a numeric suffix (e.g. 'jumbo-2') to ensure uniqueness.
    """
    payees = load_payees()
    pid = _slugify(data.get("payee", ""))
    # Ensure unique id by appending numeric suffix on collision
    existing_ids = {p["id"] for p in payees}
    base = pid
    n = 2
    while pid in existing_ids:
        pid = f"{base}-{n}"
        n += 1
    entry = {
        "id": pid,
        "payee": data.get("payee", ""),
        "aliases": data.get("aliases", []),
        "default_category": data.get("default_category", ""),
        "default_account": data.get("default_account", ""),
        "auto_tag": data.get("auto_tag", ""),
        "notes": data.get("notes", ""),
        "group": data.get("group", ""),
    }
    payees.append(entry)
    save_payees(payees)
    return pid


def update_payee(pid: str, updated: dict) -> bool:
    """Update a payee by id. Returns True on success."""
    payees = load_payees()
    for p in payees:
        if p["id"] == pid:
            for k, v in updated.items():
                if k != "id":
                    p[k] = v
            save_payees(payees)
            return True
    return False


def delete_payee(pid: str) -> bool:
    """Delete a payee by id. Returns True on success."""
    payees = load_payees()
    new = [p for p in payees if p["id"] != pid]
    if len(new) == len(payees):
        return False
    save_payees(new)
    return True


# ── Budgets ───────────────────────────────────────────────────────────────────

def load_budgets() -> list[dict]:
    """Load budgets from data/budgets.json."""
    json_path = DATA_DIR / "budgets.json"
    if not json_path.exists():
        return []
    return json.loads(json_path.read_text(encoding="utf-8"))


def save_budgets(budgets: list[dict]) -> None:
    """Write budgets to data/budgets.json."""
    json_path = DATA_DIR / "budgets.json"
    _atomic_write_text(
        json_path,
        json.dumps(budgets, indent=2, ensure_ascii=False) + "\n",
    )


def add_budget(data: dict) -> str:
    """Add a budget rule. Returns the auto-generated slug ID."""
    budgets = load_budgets()
    bid = _slugify(data.get("category", "budget"))
    existing_ids = {b["id"] for b in budgets}
    base = bid
    n = 2
    while bid in existing_ids:
        bid = f"{base}-{n}"
        n += 1
    entry = {
        "id": bid,
        "category": data.get("category", ""),
        "amount": float(data.get("amount", 0)),
        "currency": data.get("currency", "TZS"),
        "period": data.get("period", "monthly"),
    }
    budgets.append(entry)
    save_budgets(budgets)
    return bid


def update_budget(bid: str, updated: dict) -> bool:
    """Update a budget by id. Returns True on success."""
    budgets = load_budgets()
    for b in budgets:
        if b["id"] == bid:
            for k, v in updated.items():
                if k != "id":
                    if k == "amount":
                        v = float(v)
                    b[k] = v
            save_budgets(budgets)
            return True
    return False


def delete_budget(bid: str) -> bool:
    """Delete a budget by id. Returns True on success."""
    budgets = load_budgets()
    new = [b for b in budgets if b["id"] != bid]
    if len(new) == len(budgets):
        return False
    save_budgets(new)
    return True


# ── Savings Goals ─────────────────────────────────────────────────────────────

def load_savings_goals() -> list[dict]:
    """Load savings goals from data/savings_goals.json."""
    json_path = DATA_DIR / "savings_goals.json"
    if not json_path.exists():
        return []
    return json.loads(json_path.read_text(encoding="utf-8"))


def save_savings_goals(goals: list[dict]) -> None:
    """Write savings goals to data/savings_goals.json."""
    json_path = DATA_DIR / "savings_goals.json"
    _atomic_write_text(
        json_path,
        json.dumps(goals, indent=2, ensure_ascii=False) + "\n",
    )


def add_savings_goal(data: dict) -> str:
    """Add a savings goal. Returns the auto-generated slug ID."""
    goals = load_savings_goals()
    gid = _slugify(data.get("name", "goal"))
    existing_ids = {g["id"] for g in goals}
    base = gid
    n = 2
    while gid in existing_ids:
        gid = f"{base}-{n}"
        n += 1
    entry = {
        "id": gid,
        "name": data.get("name", ""),
        "target": float(data.get("target", 0)),
        "currency": data.get("currency", "TZS"),
        "account": data.get("account", ""),
        "start_date": data.get("start_date", ""),
        "deadline": data.get("deadline", ""),
        "active": True,
    }
    goals.append(entry)
    save_savings_goals(goals)
    return gid


def update_savings_goal(gid: str, updated: dict) -> bool:
    """Update a savings goal by id. Returns True on success."""
    goals = load_savings_goals()
    for g in goals:
        if g["id"] == gid:
            for k, v in updated.items():
                if k != "id":
                    if k == "target":
                        v = float(v)
                    g[k] = v
            save_savings_goals(goals)
            return True
    return False


def delete_savings_goal(gid: str) -> bool:
    """Delete a savings goal by id. Returns True on success."""
    goals = load_savings_goals()
    new = [g for g in goals if g["id"] != gid]
    if len(new) == len(goals):
        return False
    save_savings_goals(new)
    return True


def auto_learn_payees(lines: list[dict]) -> list[str]:
    """Learn new payees from confirmed transactions.

    Automatically adds unknown payees to payees.json using the transaction's
    account and category as defaults. This means the next time a user types
    the same payee, autocomplete and category suggestions will work.

    Skips auto-generated lines (pass-through counter-entries) and transfers
    to avoid learning internal/system payees.

    Returns:
        List of newly learned payee names.
    """
    payees = load_payees()
    # Build a set of all known payee names + aliases for fast lookup
    known = set()
    for p in payees:
        known.add(p["payee"].lower())
        for alias in p.get("aliases", []):
            if alias.strip():
                known.add(alias.strip().lower())

    learned = []
    seen = set()  # Avoid learning the same payee twice from a single batch
    for line in lines:
        payee = line.get("payee", "").strip()
        if not payee or payee.lower() in known or payee.lower() in seen:
            continue
        if line.get("is_auto_generated") or line.get("type") == "transfer":
            continue
        seen.add(payee.lower())
        add_payee({
            "payee": payee,
            "default_category": line.get("category", ""),
            "default_account": line.get("account", ""),
        })
        learned.append(payee)
    return learned


def load_payee_defaults() -> dict[str, dict]:
    """Load payee defaults from data/payees.json.
    Returns dict: lowercase_alias -> {payee, category, account, auto_tag}
    """
    defaults = {}
    for p in load_payees():
        entry = {
            "payee": p["payee"],
            "category": p.get("default_category", ""),
            "account": p.get("default_account", ""),
            "auto_tag": p.get("auto_tag", ""),
        }
        defaults[p["payee"].lower()] = entry
        for alias in p.get("aliases", []):
            alias = alias.strip().lower()
            if alias:
                defaults[alias] = entry
    return defaults


# ── Tags ─────────────────────────────────────────────────────────────────────

def load_tags() -> list[dict]:
    """Load tags from data/tags.csv."""
    tags = []
    tags_path = DATA_DIR / "tags.csv"
    if not tags_path.exists():
        return tags
    with open(tags_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tags.append(row)
    return tags


def save_tags(tags: list[dict]) -> None:
    """Write tags to data/tags.csv."""
    tags_path = DATA_DIR / "tags.csv"
    fieldnames = ["tag", "description", "auto_rule", "active"]
    _atomic_csv_rewrite(tags_path, fieldnames, tags)


def add_tag(data: dict) -> bool:
    """Add a tag. Returns True on success."""
    tags = load_tags()
    if any(t["tag"] == data.get("tag") for t in tags):
        return False
    tags.append({
        "tag": data.get("tag", ""),
        "description": data.get("description", ""),
        "auto_rule": data.get("auto_rule", ""),
        "active": data.get("active", "true"),
    })
    save_tags(tags)
    return True


def update_tag(tag_name: str, updated: dict) -> bool:
    """Update a tag by name. Returns True on success."""
    tags = load_tags()
    for t in tags:
        if t["tag"] == tag_name:
            for k, v in updated.items():
                if k in t:
                    t[k] = v
            save_tags(tags)
            return True
    return False


def delete_tag(tag_name: str) -> bool:
    """Delete a tag by name. Returns True on success."""
    tags = load_tags()
    new = [t for t in tags if t["tag"] != tag_name]
    if len(new) == len(tags):
        return False
    save_tags(new)
    return True


# ── Scheduled Transactions ───────────────────────────────────────────────────

# Column order for scheduled.csv — must match the CSV header exactly
SCHEDULED_FIELDS = [
    "sched_id", "name", "account", "amount", "currency", "payee",
    "category", "note", "manual_tags", "frequency", "next_run", "last_run", "active",
]


def load_scheduled() -> list[dict]:
    """Load scheduled transactions from data/scheduled.csv."""
    items = []
    sched_path = DATA_DIR / "scheduled.csv"
    if not sched_path.exists():
        return items
    with open(sched_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            items.append(row)
    return items


def save_scheduled(items: list[dict]) -> None:
    """Write scheduled transactions to data/scheduled.csv."""
    sched_path = DATA_DIR / "scheduled.csv"
    _atomic_csv_rewrite(sched_path, list(SCHEDULED_FIELDS), items)


def add_scheduled(data: dict) -> str:
    """Add a scheduled transaction template. Returns the generated sched_id.

    IDs are auto-incremented from the highest existing number
    (e.g. sched-007 -> sched-008).
    """
    items = load_scheduled()
    # Find max existing number to generate next sequential ID
    max_num = 0
    for item in items:
        sid = item.get("sched_id", "")
        if sid.startswith("sched-"):
            try:
                num = int(sid.split("-", 1)[1])
                if num > max_num:
                    max_num = num
            except ValueError:
                pass
    new_id = f"sched-{max_num + 1:03d}"
    row = {"sched_id": new_id}
    for field in SCHEDULED_FIELDS:
        if field == "sched_id":
            continue
        row[field] = data.get(field, "")
    items.append(row)
    save_scheduled(items)
    return new_id


def update_scheduled(sched_id: str, updated: dict) -> bool:
    """Update a scheduled transaction by sched_id. Returns True on success."""
    items = load_scheduled()
    for item in items:
        if item["sched_id"] == sched_id:
            for k, v in updated.items():
                if k in item:
                    item[k] = v
            save_scheduled(items)
            return True
    return False


def delete_scheduled(sched_id: str) -> bool:
    """Delete a scheduled transaction by sched_id. Returns True on success."""
    items = load_scheduled()
    new = [i for i in items if i["sched_id"] != sched_id]
    if len(new) == len(items):
        return False
    save_scheduled(new)
    return True


# ── Debts CRUD ──────────────────────────────────────────────────────────────

# Column definitions for debt-related CSVs
DEBT_FIELDS = ["id", "person_name", "type", "original_amount", "amount", "currency",
               "date_created", "date_settled", "settled", "note"]
# Payments support cross-currency: 'amount' is in payment currency,
# 'converted_amount' is in the debt's native currency
DEBT_PAYMENT_FIELDS = ["id", "debt_id", "date", "amount", "currency", "converted_amount", "note"]


def load_debts() -> list[dict]:
    """Load debts from data/third_party.csv."""
    path = DATA_DIR / "third_party.csv"
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_debts(items: list[dict]) -> None:
    """Write debts to data/third_party.csv."""
    path = DATA_DIR / "third_party.csv"
    _atomic_csv_rewrite(path, list(DEBT_FIELDS), items)


def _create_debt_origination_tx(debt: dict, amount: float, account: str) -> str | None:
    """Create a TX for debt origination (lending out or borrowing).

    owed_to_me (I lent)  -> expense on account, category Loans:Outgoing
    owed_by_me (I borrowed) -> income on account,  category Loans:Incoming

    Returns the new import_id, or None if no account was given.
    """
    if not account:
        return None
    accounts = load_accounts()
    acc = accounts.get(account, {})
    tx_currency = acc.get("currency", debt.get("currency", "TZS"))
    is_lending = debt["type"] == "owed_to_me"
    tx_type = "expense" if is_lending else "income"
    tx_category = "Loans:Outgoing" if is_lending else "Loans:Incoming"
    verb = "Lent to" if is_lending else "Borrowed from"
    tx_note = f"{verb} {debt['person_name']}"
    if debt.get("note"):
        tx_note += f" — {debt['note']}"

    existing_ids = set()
    tx_path = DATA_DIR / "transactions.csv"
    if tx_path.exists():
        with open(tx_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                existing_ids.add(row.get("import_id", ""))

    import_id = generate_import_id(
        date.today().isoformat(), account, amount,
        debt["person_name"], tx_category, tx_note, existing_ids
    )
    line = {
        "import_id": import_id,
        "date": date.today().isoformat(),
        "account": account,
        "type": tx_type,
        "amount": amount,
        "currency": tx_currency,
        "payee": debt["person_name"],
        "category": tx_category,
        "note": tx_note,
        "tags": "",
        "third_party_id": debt["id"],
    }
    append_transactions([line])
    return import_id


def add_debt(data: dict) -> dict:
    """Add a debt/receivable entry. Returns {id, import_id}.

    The 'amount' field tracks the remaining balance; 'original_amount' is
    kept unchanged for reference. Both start at the same value.

    Args:
        data: Dict with person_name, amount, type ('owed_by_me' or 'owed_to_me'),
              currency, date_created, note, plus optional account and skip_tx
              (when skip_tx is truthy no TX is created — used for backfilling
              historical debts that already have matching transactions).
    """
    items = load_debts()
    max_num = 0
    for item in items:
        did = item.get("id", "")
        if did.startswith("tp-"):
            try:
                num = int(did.split("-", 1)[1])
                if num > max_num:
                    max_num = num
            except ValueError:
                pass
    new_id = f"tp-{max_num + 1:04d}"
    amount = data.get("amount", "0")
    row = {
        "id": new_id,
        "person_name": data.get("person_name", ""),
        "type": data.get("type", "owed_by_me"),
        "original_amount": amount,  # Preserved for reference, never modified
        "amount": amount,           # Decremented by payments
        "currency": data.get("currency", "TZS"),
        "date_created": data.get("date_created", date.today().isoformat()),
        "date_settled": "",
        "settled": "false",
        "note": data.get("note", ""),
    }
    items.append(row)
    save_debts(items)

    import_id = None
    if not data.get("skip_tx"):
        try:
            import_id = _create_debt_origination_tx(row, float(amount), data.get("account", ""))
        except (ValueError, TypeError):
            import_id = None
    return {"id": new_id, "import_id": import_id}


def update_debt(debt_id: str, updated: dict) -> bool:
    """Update a debt by id. Returns True on success."""
    items = load_debts()
    for item in items:
        if item["id"] == debt_id:
            for k, v in updated.items():
                if k in item:
                    item[k] = v
            save_debts(items)
            return True
    return False


def topup_debt(debt_id: str, additional_amount: float, note: str = "",
               account: str = "", skip_tx: bool = False) -> dict | bool:
    """Increase an existing open debt by an additional amount.

    Both original_amount and current amount are increased. This is used
    when more money is lent/borrowed on top of an existing debt.

    When account is given and skip_tx is False, a matching TX is appended
    to transactions.csv so account balances stay consistent (expense for
    owed_to_me, income for owed_by_me).

    Returns False if the debt is already settled or not found. On success
    returns {"id": debt_id, "import_id": <str or None>}.
    """
    items = load_debts()
    for item in items:
        if item["id"] == debt_id:
            if item.get("settled") == "true":
                return False
            orig = float(item.get("original_amount", 0))
            cur = float(item.get("amount", 0))
            item["original_amount"] = str(orig + additional_amount)
            item["amount"] = str(cur + additional_amount)
            if note:
                existing_note = item.get("note", "")
                item["note"] = f"{existing_note}; +{additional_amount} ({note})" if existing_note else f"+{additional_amount} ({note})"
            save_debts(items)

            import_id = None
            if not skip_tx and account:
                tx_debt = dict(item)
                tx_debt["note"] = f"top-up +{additional_amount}" + (f" ({note})" if note else "")
                import_id = _create_debt_origination_tx(tx_debt, additional_amount, account)
            return {"id": debt_id, "import_id": import_id}
    return False


def delete_debt(debt_id: str) -> bool:
    """Delete a debt by id. Returns True on success."""
    items = load_debts()
    new = [i for i in items if i["id"] != debt_id]
    if len(new) == len(items):
        return False
    save_debts(new)
    return True


def load_debt_payments(debt_id: str | None = None) -> list[dict]:
    """Load debt payments, optionally filtered by debt_id."""
    path = DATA_DIR / "debt_payments.csv"
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if debt_id:
        rows = [r for r in rows if r.get("debt_id") == debt_id]
    return rows


def save_debt_payments(items: list[dict]) -> None:
    """Write debt payments to data/debt_payments.csv."""
    path = DATA_DIR / "debt_payments.csv"
    _atomic_csv_rewrite(path, list(DEBT_PAYMENT_FIELDS), items)


def pay_debt(debt_id: str, amount: float, currency: str,
             converted_amount: float, note: str = "",
             account: str = "") -> dict | None:
    """Record a payment against a debt and create a TX.

    Returns dict with payment_id and import_id, or None if debt not found.

    Args:
        debt_id: The debt to pay against
        amount: Amount paid in payment currency
        currency: Currency of payment (may differ from debt currency)
        converted_amount: Amount converted to debt currency
        note: Optional note
        account: Account alias for the TX (required for TX creation)
    """
    debts = load_debts()
    debt = None
    for d in debts:
        if d["id"] == debt_id:
            debt = d
            break
    if not debt:
        return None

    # Generate sequential payment ID (dp-001, dp-002, ...)
    all_payments = load_debt_payments()
    max_num = 0
    for p in all_payments:
        pid = p.get("id", "")
        if pid.startswith("dp-"):
            try:
                num = int(pid.split("-", 1)[1])
                if num > max_num:
                    max_num = num
            except ValueError:
                pass
    payment_id = f"dp-{max_num + 1:03d}"

    # Add payment record
    payment = {
        "id": payment_id,
        "debt_id": debt_id,
        "date": date.today().isoformat(),
        "amount": str(amount),
        "currency": currency,
        "converted_amount": str(converted_amount),
        "note": note,
    }
    all_payments.append(payment)
    save_debt_payments(all_payments)

    # Reduce remaining debt amount; auto-settle if fully paid
    remaining = float(debt["amount"]) - converted_amount
    if remaining <= 0:
        remaining = 0
        debt["settled"] = "true"
        debt["date_settled"] = date.today().isoformat()
    debt["amount"] = f"{remaining:.2f}"
    save_debts(debts)

    # Create a corresponding TX in transactions.csv so the payment
    # shows up in account balances and cash flow reports
    import_id = None
    if account:
        accounts = load_accounts()
        acc = accounts.get(account, {})
        tx_currency = acc.get("currency", currency)
        # owed_by_me = I owe someone = paying is an expense
        # owed_to_me = someone owes me = receiving payment is income
        tx_type = "expense" if debt["type"] == "owed_by_me" else "income"
        tx_category = "Debts:Repayment" if tx_type == "expense" else "Income:Debt Repayment"
        tx_note = f"Debt payment to {debt['person_name']}" if tx_type == "expense" else f"Debt repayment from {debt['person_name']}"
        if note:
            tx_note += f" — {note}"

        # Load existing IDs for collision avoidance
        existing_ids = set()
        tx_path = DATA_DIR / "transactions.csv"
        if tx_path.exists():
            import csv as csv_mod
            with open(tx_path, newline="", encoding="utf-8") as f:
                for row in csv_mod.DictReader(f):
                    existing_ids.add(row.get("import_id", ""))

        import_id = generate_import_id(
            date.today().isoformat(), account, amount,
            debt["person_name"], tx_category, tx_note, existing_ids
        )

        line = {
            "import_id": import_id,
            "date": date.today().isoformat(),
            "account": account,
            "type": tx_type,
            "amount": amount,
            "currency": tx_currency,
            "payee": debt["person_name"],
            "category": tx_category,
            "note": tx_note,
            "tags": "",
            "third_party_id": debt_id,
        }
        append_transactions([line])

    return {"payment_id": payment_id, "import_id": import_id}


# ── Quick Expenses CRUD ─────────────────────────────────────────────────────

# Quick expenses are preset "chips" in the dashboard for frequent small purchases
QUICKEXP_FIELDS = ["id", "name", "account", "payee", "category", "tags", "type", "note", "active"]


def load_quick_expenses() -> list[dict]:
    """Load quick expenses from data/quick_expenses.csv."""
    qe_path = DATA_DIR / "quick_expenses.csv"
    if not qe_path.exists():
        return []
    with open(qe_path, newline="", encoding="utf-8") as f:
        items = list(csv.DictReader(f))
    # Ensure all fields exist (handles older CSVs missing type/note)
    for item in items:
        for field in QUICKEXP_FIELDS:
            if field not in item:
                item[field] = ""
    return items


def save_quick_expenses(items: list[dict]) -> None:
    """Write quick expenses to data/quick_expenses.csv."""
    qe_path = DATA_DIR / "quick_expenses.csv"
    _atomic_csv_rewrite(qe_path, list(QUICKEXP_FIELDS), items)


def add_quick_expense(data: dict) -> str:
    """Add a quick expense. Returns the generated id."""
    items = load_quick_expenses()
    max_num = 0
    for item in items:
        qid = item.get("id", "")
        if qid.startswith("qe-"):
            try:
                num = int(qid.split("-", 1)[1])
                if num > max_num:
                    max_num = num
            except ValueError:
                pass
    new_id = f"qe-{max_num + 1:03d}"
    row = {"id": new_id}
    for field in QUICKEXP_FIELDS:
        if field == "id":
            continue
        row[field] = data.get(field, "")
    if not row.get("active"):
        row["active"] = "true"
    items.append(row)
    save_quick_expenses(items)
    return new_id


def update_quick_expense(qe_id: str, updated: dict) -> bool:
    """Update a quick expense by id. Returns True on success."""
    items = load_quick_expenses()
    for item in items:
        if item["id"] == qe_id:
            for k, v in updated.items():
                if k != "id" and k in QUICKEXP_FIELDS:
                    item[k] = v
            save_quick_expenses(items)
            return True
    return False


def delete_quick_expense(qe_id: str) -> bool:
    """Delete a quick expense by id. Returns True on success."""
    items = load_quick_expenses()
    new = [i for i in items if i["id"] != qe_id]
    if len(new) == len(items):
        return False
    save_quick_expenses(new)
    return True


# ── ATM Fees CRUD ────────────────────────────────────────────────────────────

# ATM fee presets are tiered withdrawal-fee rows used by the `TX atm` rule.
# One row per (bank, amount) — fee_net and levy are booked as-is, VAT is
# derived from fee_net × vat_rate. A withdrawal without a matching row falls
# back to a manual rückfrage in Claude Code.
ATMFEE_FIELDS = ["id", "bank", "amount", "currency", "fee_net", "levy", "vat_rate", "note", "active"]


def load_atm_fees() -> list[dict]:
    """Load ATM fee presets from data/atm_fees.csv."""
    path = DATA_DIR / "atm_fees.csv"
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        items = list(csv.DictReader(f))
    # Back-fill any missing field (tolerates older CSV shapes)
    for item in items:
        for field in ATMFEE_FIELDS:
            if field not in item:
                item[field] = ""
    return items


def save_atm_fees(items: list[dict]) -> None:
    """Write ATM fee presets to data/atm_fees.csv."""
    path = DATA_DIR / "atm_fees.csv"
    _atomic_csv_rewrite(path, list(ATMFEE_FIELDS), items)


def add_atm_fee(data: dict) -> str:
    """Add a new ATM fee preset. Returns the generated id."""
    items = load_atm_fees()
    max_num = 0
    for item in items:
        fid = item.get("id", "")
        if fid.startswith("atmfee-"):
            try:
                num = int(fid.split("-", 1)[1])
                if num > max_num:
                    max_num = num
            except ValueError:
                pass
    new_id = f"atmfee-{max_num + 1:03d}"
    row = {"id": new_id}
    for field in ATMFEE_FIELDS:
        if field == "id":
            continue
        row[field] = data.get(field, "")
    if not row.get("active"):
        row["active"] = "true"
    if not row.get("currency"):
        row["currency"] = "TZS"
    if not row.get("vat_rate"):
        row["vat_rate"] = "0.18"
    items.append(row)
    save_atm_fees(items)
    return new_id


def update_atm_fee(fee_id: str, updated: dict) -> bool:
    """Update an ATM fee preset by id. Returns True on success."""
    items = load_atm_fees()
    for item in items:
        if item["id"] == fee_id:
            for k, v in updated.items():
                if k != "id" and k in ATMFEE_FIELDS:
                    item[k] = v
            save_atm_fees(items)
            return True
    return False


def delete_atm_fee(fee_id: str) -> bool:
    """Delete an ATM fee preset by id. Returns True on success."""
    items = load_atm_fees()
    new = [i for i in items if i["id"] != fee_id]
    if len(new) == len(items):
        return False
    save_atm_fees(new)
    return True


def lookup_atm_fee(bank: str, amount: float) -> dict | None:
    """Return the active ATM fee preset matching (bank, amount), or None."""
    for item in load_atm_fees():
        if item.get("active", "true") != "true":
            continue
        if (item.get("bank", "").lower() == bank.lower()
                and abs(float(item.get("amount", 0) or 0) - float(amount)) < 0.5):
            return item
    return None


# ── Custom Reports CRUD ──────────────────────────────────────────────────────
# User-defined report definitions persisted in data/custom_reports.json.
# A definition is a flat dict with: id, name, description, match_mode (AND/OR),
# filters (categories/tags/accounts/payees, each with include/exclude mode),
# period (default view + preset), widgets (pie + top_n toggles).
# The actual TX filtering is done client-side; this module only stores config.

CUSTOM_REPORT_DIMENSIONS = ("category", "payee", "account", "tag")
CUSTOM_REPORT_MATCH_MODES = ("AND", "OR")
CUSTOM_REPORT_FILTER_MODES = ("include", "exclude")
CUSTOM_REPORT_FILTER_KEYS = ("categories", "tags", "accounts", "payees")
CUSTOM_REPORT_VIEWS = ("monthly", "yearly")
CUSTOM_REPORT_PRESETS = ("current", "ytd", "last12", "all", "custom")


def load_custom_reports() -> list[dict]:
    """Load custom report definitions from data/custom_reports.json."""
    json_path = DATA_DIR / "custom_reports.json"
    if not json_path.exists():
        return []
    return json.loads(json_path.read_text(encoding="utf-8"))


def save_custom_reports(reports: list[dict]) -> None:
    """Write custom report definitions to data/custom_reports.json."""
    json_path = DATA_DIR / "custom_reports.json"
    _atomic_write_text(
        json_path,
        json.dumps(reports, indent=2, ensure_ascii=False) + "\n",
    )


def _normalize_custom_report(data: dict) -> dict:
    """Fill in default fields for a custom report definition (without id/timestamps)."""
    filters = data.get("filters") or {}
    norm_filters = {}
    for key in CUSTOM_REPORT_FILTER_KEYS:
        block = filters.get(key) or {}
        norm_filters[key] = {
            "mode": block.get("mode", "include"),
            "values": list(block.get("values", [])),
        }
    period = data.get("period") or {}
    norm_period = {
        "default_view": period.get("default_view", "monthly"),
        "default_preset": period.get("default_preset", "current"),
        "custom_range": period.get("custom_range"),
    }
    widgets = data.get("widgets") or {}
    pie = widgets.get("pie") or {}
    top_n = widgets.get("top_n") or {}
    norm_widgets = {
        "pie": {
            "enabled": bool(pie.get("enabled", False)),
            "dimension": pie.get("dimension", "category"),
        },
        "top_n": {
            "enabled": bool(top_n.get("enabled", False)),
            "dimension": top_n.get("dimension", "payee"),
            "n": int(top_n.get("n", 10)),
        },
    }
    return {
        "name": (data.get("name") or "").strip(),
        "description": (data.get("description") or "").strip(),
        "match_mode": data.get("match_mode", "AND"),
        "filters": norm_filters,
        "period": norm_period,
        "widgets": norm_widgets,
    }


def _validate_custom_report(report: dict) -> str | None:
    """Validate a normalized custom report. Returns error string or None if valid."""
    if not report.get("name"):
        return "name is required"
    if report.get("match_mode") not in CUSTOM_REPORT_MATCH_MODES:
        return f"match_mode must be one of {CUSTOM_REPORT_MATCH_MODES}"
    for key in CUSTOM_REPORT_FILTER_KEYS:
        block = report["filters"][key]
        if block["mode"] not in CUSTOM_REPORT_FILTER_MODES:
            return f"filters.{key}.mode must be one of {CUSTOM_REPORT_FILTER_MODES}"
        if not isinstance(block["values"], list):
            return f"filters.{key}.values must be a list"
    if report["period"]["default_view"] not in CUSTOM_REPORT_VIEWS:
        return f"period.default_view must be one of {CUSTOM_REPORT_VIEWS}"
    if report["period"]["default_preset"] not in CUSTOM_REPORT_PRESETS:
        return f"period.default_preset must be one of {CUSTOM_REPORT_PRESETS}"
    for w_name, w_cfg in report["widgets"].items():
        if w_cfg["dimension"] not in CUSTOM_REPORT_DIMENSIONS:
            return f"widgets.{w_name}.dimension must be one of {CUSTOM_REPORT_DIMENSIONS}"
    return None


def _new_custom_report_id(existing_ids: set[str], seed: str) -> str:
    """Generate a unique short id 'cr_XXXXXXXX' (sha1[:8])."""
    base = f"{seed}|{datetime.now().isoformat()}"
    rid = "cr_" + hashlib.sha1(base.encode("utf-8")).hexdigest()[:8]
    n = 0
    while rid in existing_ids:
        n += 1
        rid = "cr_" + hashlib.sha1(f"{base}|{n}".encode("utf-8")).hexdigest()[:8]
    return rid


def add_custom_report(data: dict) -> dict:
    """Add a custom report. Returns the stored entry with its generated id.

    Raises ValueError if validation fails.
    """
    norm = _normalize_custom_report(data)
    err = _validate_custom_report(norm)
    if err:
        raise ValueError(err)
    reports = load_custom_reports()
    rid = _new_custom_report_id({r["id"] for r in reports}, norm["name"])
    now = datetime.now().isoformat(timespec="seconds")
    entry = {"id": rid, **norm, "created_at": now, "updated_at": now}
    reports.append(entry)
    save_custom_reports(reports)
    return entry


def update_custom_report(rid: str, updated: dict) -> dict | None:
    """Update a custom report by id. Returns the updated entry, or None if not found.

    Merges incoming fields onto the existing record before re-normalizing,
    so callers can send a partial payload.

    Raises ValueError if the merged record fails validation.
    """
    reports = load_custom_reports()
    for i, r in enumerate(reports):
        if r["id"] == rid:
            merged_input = {**r, **updated}
            norm = _normalize_custom_report(merged_input)
            err = _validate_custom_report(norm)
            if err:
                raise ValueError(err)
            entry = {
                "id": rid,
                **norm,
                "created_at": r.get("created_at"),
                "updated_at": datetime.now().isoformat(timespec="seconds"),
            }
            reports[i] = entry
            save_custom_reports(reports)
            return entry
    return None


def delete_custom_report(rid: str) -> bool:
    """Delete a custom report by id. Returns True on success."""
    reports = load_custom_reports()
    new = [r for r in reports if r["id"] != rid]
    if len(new) == len(reports):
        return False
    save_custom_reports(new)
    return True


def duplicate_custom_report(rid: str, new_name: str | None = None) -> dict | None:
    """Duplicate a custom report by id. Returns the new entry, or None if source missing.

    The new entry is named '<original> (copy)' unless new_name is provided.
    A fresh id and timestamps are generated.
    """
    reports = load_custom_reports()
    src = next((r for r in reports if r["id"] == rid), None)
    if not src:
        return None
    payload = {**src, "name": (new_name or f"{src['name']} (copy)").strip()}
    for k in ("id", "created_at", "updated_at"):
        payload.pop(k, None)
    return add_custom_report(payload)


# ── Categories CRUD ──────────────────────────────────────────────────────────

def save_categories(cats: list[dict]) -> None:
    """Write categories to data/categories.csv."""
    cats_path = DATA_DIR / "categories.csv"
    fieldnames = ["path", "type", "active", "note", "pnl", "essential"]
    # Default for legacy rows without the flag: treat expenses as essential
    # by default, non-expenses as non-essential (the flag is only consulted
    # for expense TX anyway).
    normalized = [
        c if ("essential" in c and c.get("essential") not in (None, ""))
        else {**c, "essential": "true" if c.get("type") == "expense" else "false"}
        for c in cats
    ]
    _atomic_csv_rewrite(cats_path, fieldnames, normalized, extrasaction="ignore")


def add_category(data: dict) -> bool:
    """Add a category. Returns True on success."""
    cats = load_categories()
    path = data.get("path", "")
    if path in cats:
        return False
    cat_list = [{"path": p, **c} for p, c in cats.items()]
    cat_list.append({
        "path": path,
        "type": data.get("type", "expense"),
        "active": data.get("active", "true"),
        "note": data.get("note", ""),
        "pnl": data.get("pnl", "true"),
        "essential": data.get("essential", "true" if data.get("type", "expense") == "expense" else "false"),
    })
    cat_list.sort(key=lambda c: c["path"])
    save_categories(cat_list)
    return True


def update_category(path: str, updated: dict) -> bool:
    """Update a category by path. Returns True on success."""
    cats = load_categories()
    if path not in cats:
        return False
    cat_list = []
    for p, c in cats.items():
        entry = {"path": p, **c}
        if p == path:
            for k, v in updated.items():
                if k != "path":
                    entry[k] = v
        cat_list.append(entry)
    cat_list.sort(key=lambda c: c["path"])
    save_categories(cat_list)
    return True


# ── Amount Parsing ───────────────────────────────────────────────────────────

def parse_amount(text: str) -> float:
    """Parse human-friendly amount strings with shorthand notation.

    Supports:
        '45k'   -> 45,000
        '2.5m'  -> 2,500,000
        '3200'  -> 3,200
        '1,500' -> 1,500 (comma stripped)

    Returns:
        Float amount value.
    """
    text = text.strip().lower()
    multipliers = {"k": 1_000, "m": 1_000_000}
    for suffix, mult in multipliers.items():
        if text.endswith(suffix):
            return float(text[:-1]) * mult
    # Strip commas used as thousands separators
    return float(text.replace(",", ""))


# ── Import ID ────────────────────────────────────────────────────────────────

def generate_import_id(
    dt: str, account: str, amount: float, payee: str,
    category: str, note: str, existing_ids: set[str]
) -> str:
    """Generate a unique 12-char import ID from transaction fields.

    Uses SHA1 hash of concatenated fields, truncated to 12 hex chars.
    If a collision is detected (same hash already in existing_ids),
    appends a numeric suffix (e.g. 'a1b2c3d4e5f6_2') until unique.

    This is the primary key for transactions and must be deterministic
    (same input -> same ID) for idempotency in re-imports.
    """
    raw = f"{dt}{account}{amount}{payee}{category}{note}"
    base = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
    if base not in existing_ids:
        return base
    # Collision tiebreaker: append incrementing suffix
    n = 2
    while f"{base}_{n}" in existing_ids:
        n += 1
    return f"{base}_{n}"


# ── Auto-Tags ────────────────────────────────────────────────────────────────

# Auto-tag rules: certain accounts and payees always get specific tags.
# These are applied automatically on every TX — no user action needed.

# Auto-tag rules are loaded entirely from config/defaults.json
# (auto_tag.by_account / by_payee). The maps default to empty so the
# template repo ships with no hardcoded user data; users (and the private
# repo) populate the JSON with whatever account/payee → tag rules they need.
AUTO_TAG_ACCOUNTS = config_loader.get_default("auto_tag.by_account", {})
AUTO_TAG_PAYEES = config_loader.get_default("auto_tag.by_payee", {})


def apply_auto_tags(account: str, payee: str, explicit_tags: list[str]) -> list[str]:
    """Apply auto-tag rules and merge with any explicitly specified tags.

    Auto-tags are additive: they never override or remove explicit tags.
    Deduplication ensures no tag appears twice.

    Args:
        account: Account alias (e.g. 'kft').
        payee: Payee name for payee-based tag rules.
        explicit_tags: Tags explicitly provided by user or scheduled entry.

    Returns:
        Merged list of all applicable tags.
    """
    tags = list(explicit_tags)
    # Account-based auto-tags (business accounts)
    auto = AUTO_TAG_ACCOUNTS.get(account.lower())
    if auto and auto not in tags:
        tags.append(auto)
    # Payee-based auto-tags (specific landlords, contacts)
    auto = AUTO_TAG_PAYEES.get(payee.lower(), "")
    if auto and auto not in tags:
        tags.append(auto)
    return tags


# ── Pass-Through ─────────────────────────────────────────────────────────────

# Maps pass-through payee names to their reimbursement income categories.
# These counter-entries ensure pass-through account balances stay at zero.
# Reimbursement categories loaded from config/defaults.json
# (pass_through.reimbursement_categories) — that is the single source of
# truth. The empty fallback below preserves the get_default() contract for
# missing config; unmapped payees fall through to the runtime default
# `f"Income:{ptp} Reimbursement"` in generate_pass_through_line(), which
# already covers every payee without needing a hard-coded list.
_REIMBURSEMENT_CATEGORIES_FALLBACK: dict[str, str] = {}
REIMBURSEMENT_CATEGORIES = config_loader.get_default(
    "pass_through.reimbursement_categories", _REIMBURSEMENT_CATEGORIES_FALLBACK
)


def generate_pass_through_line(
    expense_line: dict, account_info: dict, existing_ids: set[str]
) -> dict | None:
    """Generate the automatic income counter-entry for a pass-through expense.

    Pass-through accounts represent money spent on behalf of a business
    entity. Every expense gets a matching income line for reimbursement,
    keeping the pass-through account balance at zero. Account-to-business
    mapping is data-driven via accounts.csv (pass_through_payee column);
    reimbursement categories come from config/defaults.json.

    Args:
        expense_line: The original expense transaction dict.
        account_info: Account metadata (must contain 'pass_through_payee').
        existing_ids: Set of existing import IDs for collision avoidance.

    Returns:
        Income counter-entry dict, or None if account is not pass-through.
    """
    ptp = account_info.get("pass_through_payee", "").strip()
    if not ptp:
        return None

    # Look up the reimbursement category, with a dynamic fallback
    reimb_cat = REIMBURSEMENT_CATEGORIES.get(ptp, f"Income:{ptp} Reimbursement")

    line = {
        "date": expense_line["date"],
        "account": expense_line["account"],
        "type": "income",
        "amount": expense_line["amount"],
        "currency": expense_line["currency"],
        "payee": ptp,
        "category": reimb_cat,
        "note": "",
        "raw_note": "",
        "transfer_to_account": "",
        "transfer_to_amount": "",
        "receipt_group": expense_line.get("receipt_group", ""),
        "receipt_url": "",
        "tags": expense_line.get("tags", ""),
        "third_party_id": "",
        "is_auto_generated": True,
    }
    line["import_id"] = generate_import_id(
        line["date"], line["account"], float(line["amount"]),
        line["payee"], line["category"], line["note"], existing_ids,
    )
    return line


# ── Validation ───────────────────────────────────────────────────────────────

def validate_line(line: dict, accounts: dict, categories: dict) -> list[str]:
    """Validate a transaction line against known accounts and categories.

    Checks:
        - Account exists in accounts.csv
        - Currency matches the account's currency
        - Transaction type is one of: expense, income, transfer
        - Category exists (for expense/income)
        - Amount is a positive number
        - Transfer has a valid destination account

    Returns:
        List of error messages. Empty list means the line is valid.
    """
    errors = []
    alias = line.get("account", "")
    if alias not in accounts:
        errors.append(f"Unknown account: '{alias}'")
    else:
        acc = accounts[alias]
        # Catch currency mismatches (e.g. EUR amount on a TZS account)
        if acc.get("currency") and line.get("currency") != acc["currency"]:
            errors.append(f"Currency mismatch: line has '{line.get('currency')}', account '{alias}' expects '{acc['currency']}'")

    tx_type = line.get("type", "")
    if tx_type not in ("expense", "income", "transfer"):
        errors.append(f"Invalid type: '{tx_type}'")

    if tx_type in ("expense", "income"):
        cat = line.get("category", "")
        if cat and cat not in categories:
            errors.append(f"Unknown category: '{cat}'")

    try:
        amt = float(line.get("amount", 0))
        if amt <= 0:
            errors.append("Amount must be positive")
    except (ValueError, TypeError):
        errors.append(f"Invalid amount: '{line.get('amount')}'")

    if tx_type == "transfer":
        tta = line.get("transfer_to_account", "")
        if not tta:
            errors.append("Transfer requires transfer_to_account")
        elif tta not in accounts:
            errors.append(f"Unknown transfer_to_account: '{tta}'")

    return errors


# ── CSV Writing ──────────────────────────────────────────────────────────────

# Canonical column order for transactions.csv — must match docs/schema.md
TX_COLUMNS = [
    "import_id", "date", "account", "type", "amount", "currency",
    "payee", "category", "note", "raw_note", "transfer_to_account",
    "transfer_to_amount", "receipt_group", "receipt_url", "tags", "third_party_id",
]


# DV1 (2026-04-27): cross-reference validators for non-TX domain objects.
# Mirror validate_line() for budget / savings_goal / scheduled / third_party /
# quick_expense / atm_fee. Each is field-presence-aware (skip-if-absent), so
# the same function works for both add (full body) and update (partial dict).

_DV1_FREQ_RE = re.compile(
    # monthly:1..31 | last | weekly:mon..sun | yearly:MM-DD | quarterly:MM-DD
    # Day is bounded 01..31 and month 01..12 — so e.g. monthly:99,
    # yearly:13-32 are rejected at validate-time instead of slipping in
    # and exploding when calculate_next_run() tries to use them.
    r"^("
    r"monthly:(?:[1-9]|[12]\d|3[01]|last)"
    r"|weekly:(?:mon|tue|wed|thu|fri|sat|sun)"
    r"|yearly:(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])"
    r"|quarterly:(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])"
    r")$"
)
_DV1_CCY_RE = re.compile(r"^[A-Z]{3}$")
_DV1_TX_TYPES = frozenset({"expense", "income", "transfer"})


def _dv1_check_amount(body: dict, field: str, errors: list, label: str | None = None) -> None:
    """If body[field] is present and non-empty, require numeric > 0."""
    if field not in body or body[field] in ("", None):
        return
    name = label or field
    try:
        if float(body[field]) <= 0:
            errors.append(f"{name} must be positive (got {body[field]})")
    except (ValueError, TypeError):
        errors.append(f"{name} must be numeric (got {body[field]!r})")


def _dv1_check_currency(body: dict, errors: list) -> None:
    if body.get("currency") and not _DV1_CCY_RE.match(body["currency"]):
        errors.append(f"currency must be a 3-letter ISO code (got {body['currency']!r})")


def _dv1_check_account(body: dict, accounts: dict, errors: list, field: str = "account") -> None:
    if body.get(field) and body[field] not in accounts:
        errors.append(f"account '{body[field]}' does not exist")


def _dv1_check_category(body: dict, categories: dict, errors: list, field: str = "category") -> None:
    if body.get(field) and body[field] not in categories:
        errors.append(f"category '{body[field]}' does not exist")


def validate_scheduled(body: dict, accounts: dict, categories: dict) -> list[str]:
    errors: list[str] = []
    _dv1_check_amount(body, "amount", errors)
    _dv1_check_account(body, accounts, errors)
    _dv1_check_category(body, categories, errors)
    _dv1_check_currency(body, errors)
    if body.get("frequency") and not _DV1_FREQ_RE.match(body["frequency"]):
        errors.append(
            f"frequency '{body['frequency']}' must match "
            "monthly:N | weekly:DAY | yearly:MM-DD | quarterly:MM-DD"
        )
    return errors


def validate_third_party(body: dict, accounts: dict, categories: dict) -> list[str]:
    errors: list[str] = []
    _dv1_check_amount(body, "amount", errors)
    _dv1_check_amount(body, "original_amount", errors)
    _dv1_check_currency(body, errors)
    _dv1_check_account(body, accounts, errors)
    return errors


def validate_quick_expense(body: dict, accounts: dict, categories: dict) -> list[str]:
    errors: list[str] = []
    _dv1_check_account(body, accounts, errors)
    _dv1_check_category(body, categories, errors)
    if body.get("type") and body["type"] not in _DV1_TX_TYPES:
        errors.append(f"type '{body['type']}' must be one of {sorted(_DV1_TX_TYPES)}")
    return errors


def validate_atm_fee(body: dict, accounts: dict, categories: dict) -> list[str]:
    errors: list[str] = []
    _dv1_check_amount(body, "amount", errors)
    _dv1_check_amount(body, "fee_net", errors)
    _dv1_check_currency(body, errors)
    if "levy" in body and body["levy"] not in ("", None):
        try:
            if float(body["levy"]) < 0:
                errors.append(f"levy must be non-negative (got {body['levy']})")
        except (ValueError, TypeError):
            errors.append(f"levy must be numeric (got {body['levy']!r})")
    return errors


def validate_budget(body: dict, accounts: dict, categories: dict) -> list[str]:
    errors: list[str] = []
    _dv1_check_amount(body, "amount", errors)
    _dv1_check_currency(body, errors)
    _dv1_check_category(body, categories, errors)
    if body.get("period") and body["period"] != "monthly":
        errors.append(f"period '{body['period']}' must be 'monthly'")
    return errors


def validate_savings_goal(body: dict, accounts: dict, categories: dict) -> list[str]:
    errors: list[str] = []
    _dv1_check_amount(body, "target", errors)
    _dv1_check_currency(body, errors)
    _dv1_check_account(body, accounts, errors)
    return errors


@with_tx_lock
def append_transactions(lines: list[dict]) -> None:
    """Append transaction lines to transactions.csv (append-only, never overwrites).

    Amounts are normalized to 2 decimal places for consistency.
    Lines are written in TX_COLUMNS order regardless of dict key order.
    """
    tx_path = DATA_DIR / "transactions.csv"
    with open(tx_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        for line in lines:
            row = []
            for col in TX_COLUMNS:
                val = line.get(col, "")
                # Normalize amounts to 2 decimal places
                if col == "amount" and val:
                    val = f"{float(val):.2f}"
                elif col == "transfer_to_amount" and val:
                    val = f"{float(val):.2f}"
                row.append(val)
            writer.writerow(row)


@with_tx_lock
def update_transaction(import_id: str, updated: dict) -> bool:
    """Update specific fields of a transaction identified by import_id.

    Reads the entire CSV, modifies the matching row in memory, and
    rewrites the whole file. The import_id itself cannot be changed.

    Returns:
        True if the transaction was found and updated, False otherwise.
    """
    tx_path = DATA_DIR / "transactions.csv"
    rows = []
    found = False
    with open(tx_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            if row["import_id"] == import_id:
                for col in TX_COLUMNS:
                    if col in updated and col != "import_id":
                        val = updated[col]
                        # Normalize amounts to 2 decimal places
                        if col == "amount" and val:
                            val = f"{float(val):.2f}"
                        elif col == "transfer_to_amount" and val:
                            val = f"{float(val):.2f}"
                        row[col] = val
                found = True
            rows.append(row)
    if not found:
        return False
    _atomic_csv_rewrite(tx_path, fieldnames, rows)
    return True


@with_tx_lock
def delete_transaction(import_id: str) -> bool:
    """Delete a transaction by import_id. Returns True on success."""
    tx_path = DATA_DIR / "transactions.csv"
    rows = []
    found = False
    with open(tx_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            if row["import_id"] == import_id:
                found = True
                continue  # skip this row
            rows.append(row)
    if not found:
        return False
    _atomic_csv_rewrite(tx_path, fieldnames, rows)
    return True


@with_tx_lock
def batch_delete_transactions(import_ids: list[str]) -> int:
    """Delete multiple transactions by import_id. Returns count of deleted rows."""
    id_set = set(import_ids)
    tx_path = DATA_DIR / "transactions.csv"
    rows = []
    deleted = 0
    with open(tx_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            if row["import_id"] in id_set:
                deleted += 1
                continue
            rows.append(row)
    if deleted == 0:
        return 0
    _atomic_csv_rewrite(tx_path, fieldnames, rows)
    return deleted


@with_tx_lock
def batch_update_tags(import_ids: list[str], add_tags: list[str], remove_tags: list[str]) -> int:
    """Add/remove tags on multiple transactions. Returns count of modified rows."""
    id_set = set(import_ids)
    tx_path = DATA_DIR / "transactions.csv"
    rows = []
    modified = 0
    with open(tx_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            if row["import_id"] in id_set:
                tags = [t for t in (row.get("tags", "") or "").split(";") if t]
                changed = False
                for t in add_tags:
                    if t and t not in tags:
                        tags.append(t)
                        changed = True
                for t in remove_tags:
                    if t in tags:
                        tags.remove(t)
                        changed = True
                if changed:
                    row["tags"] = ";".join(tags)
                    modified += 1
            rows.append(row)
    if modified == 0:
        return 0
    _atomic_csv_rewrite(tx_path, fieldnames, rows)
    return modified


# ── Prompt Log ───────────────────────────────────────────────────────────────

@with_tx_lock
def log_to_prompt_log(raw_input: str, parsed_json: str) -> int:
    """Log a TX input attempt to prompt_log.csv for audit trail and offline recovery.

    Every TX input is logged BEFORE it is written to transactions.csv.
    If the write fails, the entry stays with booked=false (the offline queue).

    Args:
        raw_input: The original user input text.
        parsed_json: JSON string of the parsed transaction lines.

    Returns:
        The auto-incremented prompt log ID.
    """
    log_path = DATA_DIR / "prompt_log.csv"
    # Find max existing ID to generate next sequential one
    max_id = 0
    if log_path.exists():
        with open(log_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    max_id = max(max_id, int(row.get("id", 0)))
                except ValueError:
                    pass
    new_id = max_id + 1
    with open(log_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            new_id,
            datetime.now().isoformat(),
            raw_input,
            parsed_json,
            "false",
            "",
            "",
        ])
    return new_id


@with_tx_lock
def mark_prompt_booked(prompt_id: int) -> None:
    """Mark a prompt_log entry as successfully written to transactions.csv."""
    log_path = DATA_DIR / "prompt_log.csv"
    if not log_path.exists():
        return
    rows = []
    with open(log_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            if row.get("id") == str(prompt_id):
                row["booked"] = "true"
                row["booked_at"] = datetime.now().isoformat()
            rows.append(row)
    _atomic_csv_rewrite(log_path, list(fieldnames or []), rows)


# ── Git ──────────────────────────────────────────────────────────────────────

def _trigger_async_sync() -> None:
    """Spawn scripts/cron_commit.py as a fully detached background process.

    Used by git_commit() in default async mode so data/ changes reach
    origin within ~1-2 seconds of a user save instead of waiting up to
    5 minutes for the next cron tick. The */5 cron stays in place as a
    safety net for failed event spawns AND as the pull-side mechanism
    for laptop→Pi sync (event-sync only covers the push direction).

    The child fully detaches: it survives a serve.py restart between
    launch and completion, has stdin/stdout/stderr piped to DEVNULL,
    and inherits the same git config and SSH agent as the parent.
    Spawn failures are silently swallowed — the cron is the safety net,
    so a failed event spawn just means the change ships at the next
    */5 tick instead of immediately.

    Concurrency: cron_commit holds the cross-process tx_write_lock
    (shared with all data writers and the */5 cron itself) for its
    full run. Multiple concurrent invocations — rapid TX bursts, or
    an event spawn racing with the */5 cron tick — serialize on that
    lock. Whoever gets the lock first does the work; followers find
    nothing to commit and exit as no-ops.
    """
    try:
        cron_script = REPO_ROOT / "scripts" / "cron_commit.py"
        if not cron_script.exists():
            return
        kwargs: dict = {
            "cwd": str(REPO_ROOT),
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
            "stdin": subprocess.DEVNULL,
            "close_fds": True,
        }
        if sys.platform == "win32":
            # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
            # — child outlives parent AND no console flash on the user's screen.
            kwargs["creationflags"] = 0x00000008 | 0x00000200 | 0x08000000
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen([_windowless_python(), str(cron_script)], **kwargs)
    except Exception as e:
        # Never let an event-sync spawn failure break the user's request —
        # the */5 cron remains the safety net. But surface the failure on
        # stderr so a chronically broken spawn (missing python, perms, etc.)
        # doesn't stay silent forever.
        print(
            f"[tx_engine] _trigger_async_sync spawn failed: "
            f"{type(e).__name__}: {e}",
            file=sys.stderr,
        )


def git_commit(message: str, files: list[str] | None = None) -> bool:
    """Trigger a background git sync after a data mutation.

    Default behavior (async event-driven): spawns scripts/cron_commit.py
    in the background so the change is fetched-rebased-committed-pushed
    within ~1-2 seconds without blocking the request. The */5 cron keeps
    running as a safety net (catches failed event spawns) and as the
    pull-side mechanism for laptop→Pi sync.

    Modes (controlled by env vars on the running serve.py):
        FINANCEOS_DISABLE_EVENT_SYNC=1 → no spawn, pure cron-only (legacy
            pre-event-sync behavior; useful for CI / dev where you don't
            want every dashboard write to auto-push)
        GIT_COMMIT_SYNC=1 → synchronous in-process commit+pull--rebase+push
            (slow, blocks the request; useful for local debugging when
            you want to see exact git output and timing inline)
        (neither set) → async event-driven push via background spawn
            (default; what the Pi runs in production)

    Args:
        message: Commit message — currently used only by the synchronous
            legacy path. The async path delegates to cron_commit.py which
            generates its own message ("batch: N files (...) [timestamp]").
        files: Ignored. The cron commits everything under data/, which is
            the safer default — partial-file commits historically caused
            split states where related rows were committed in different
            commits.

    Returns:
        True. Actual commit/push status is async; observe via origin git
        log or scripts/cron_commit.py log output.
    """
    # Opt-out: legacy cron-only behavior, no background spawn.
    if os.environ.get("FINANCEOS_DISABLE_EVENT_SYNC") == "1":
        return True

    # Opt-in: synchronous in-process mode (slow, lets you see git output).
    if os.environ.get("GIT_COMMIT_SYNC") == "1":
        try:
            if files:
                subprocess.run(
                    ["git", "add"] + files,
                    cwd=REPO_ROOT, check=True, capture_output=True,
                    **_NO_WINDOW_KWARGS,
                )
            else:
                subprocess.run(
                    ["git", "add", "data/transactions.csv", "data/prompt_log.csv"],
                    cwd=REPO_ROOT, check=True, capture_output=True,
                    **_NO_WINDOW_KWARGS,
                )
            result = subprocess.run(
                ["git", "commit", "-m", message],
                cwd=REPO_ROOT, capture_output=True, text=True,
                **_NO_WINDOW_KWARGS,
            )
            if result.returncode != 0:
                return False
            subprocess.run(
                ["git", "pull", "origin", "main", "--rebase"],
                cwd=REPO_ROOT, capture_output=True, timeout=15,
                **_NO_WINDOW_KWARGS,
            )
            subprocess.run(
                ["git", "push", "origin", "main"],
                cwd=REPO_ROOT, capture_output=True, timeout=15,
                **_NO_WINDOW_KWARGS,
            )
            return True
        except Exception:
            return False

    # Default: async event-driven push via cron_commit.py background spawn.
    _trigger_async_sync()
    return True


def build_manual_lines(form_data: dict) -> dict:
    """Build transaction lines from structured form data.

    The dashboard's Add-TX page submits pre-structured data that just
    needs ID generation, auto-tags, pass-through handling, and validation.

    Supports receipt splits: if form_data contains a 'splits' list of
    [{amount, category}, ...], each split becomes a separate TX line
    sharing the same receipt_group (linked via a hash-based group ID).

    For pass-through splits, a single counter-entry is created for the
    total amount (not one per split line).
    """
    accounts = load_accounts()
    categories = load_categories()
    existing_ids = load_existing_import_ids()

    splits = form_data.get("splits")
    base_date = form_data.get("date", date.today().isoformat())
    base_account = form_data.get("account", "")
    base_type = form_data.get("type", "expense")
    base_payee = form_data.get("payee", "")
    base_note = form_data.get("note", "")
    base_tags = form_data.get("tags", "")
    base_currency = form_data.get("currency", "")

    # Auto-derive currency from account if not specified
    if not base_currency and base_account in accounts:
        base_currency = accounts[base_account]["currency"]

    # Auto-tags
    explicit_tags = [t for t in base_tags.split(";") if t]
    all_tags = apply_auto_tags(base_account, base_payee, explicit_tags)
    tags_str = ";".join(all_tags)

    final_lines = []

    if splits and len(splits) >= 2:
        # Split mode: generate receipt_group
        import hashlib
        rg_hash = hashlib.sha1(f"{base_date}{base_account}{base_payee}{id(splits)}".encode()).hexdigest()[:8]
        receipt_group = f"split-{rg_hash}"

        for sp in splits:
            # Per-split note overrides the form-level note. Empty per-split
            # note falls back to base_note so the main field still works as
            # a default for all lines.
            sp_note = (sp.get("note") or "").strip()
            line_note = sp_note if sp_note else base_note
            line = {
                "date": base_date,
                "account": base_account,
                "type": base_type,
                "amount": str(sp.get("amount", 0)),
                "currency": base_currency,
                "payee": base_payee,
                "category": sp.get("category", ""),
                "note": line_note,
                "raw_note": "",
                "transfer_to_account": "",
                "transfer_to_amount": "",
                "receipt_group": receipt_group,
                "receipt_url": "",
                "tags": tags_str,
                "third_party_id": "",
            }
            line["import_id"] = generate_import_id(
                line["date"], line["account"], float(line["amount"]),
                line["payee"], line["category"], line["note"], existing_ids,
            )
            existing_ids.add(line["import_id"])
            line["is_auto_generated"] = False
            final_lines.append(line)

        # Pass-through: one counter-entry for the total amount
        acc_info = accounts.get(base_account, {})
        if base_type == "expense" and acc_info.get("pass_through_payee"):
            total_amount = sum(float(sp.get("amount", 0)) for sp in splits)
            pt_base = dict(final_lines[0])
            pt_base["amount"] = str(total_amount)
            pt_line = generate_pass_through_line(pt_base, acc_info, existing_ids)
            if pt_line:
                existing_ids.add(pt_line["import_id"])
                final_lines.append(pt_line)
    else:
        # Single line mode
        line = {
            "date": base_date,
            "account": base_account,
            "type": base_type,
            "amount": str(form_data.get("amount", 0)),
            "currency": base_currency,
            "payee": base_payee,
            "category": form_data.get("category", ""),
            "note": base_note,
            "raw_note": "",
            "transfer_to_account": form_data.get("transfer_to_account", ""),
            "transfer_to_amount": str(form_data.get("transfer_to_amount", "")) if form_data.get("transfer_to_amount") else "",
            "receipt_group": "",
            "receipt_url": "",
            "tags": tags_str,
            "third_party_id": "",
        }

        line["import_id"] = generate_import_id(
            line["date"], line["account"], float(line["amount"]),
            line["payee"], line["category"], line["note"], existing_ids,
        )
        existing_ids.add(line["import_id"])
        line["is_auto_generated"] = False
        final_lines.append(line)

        # Pass-through
        acc_info = accounts.get(base_account, {})
        if base_type == "expense" and acc_info.get("pass_through_payee"):
            pt_line = generate_pass_through_line(line, acc_info, existing_ids)
            if pt_line:
                existing_ids.add(pt_line["import_id"])
                final_lines.append(pt_line)

    # Validate
    errors = []
    for l in final_lines:
        if not l.get("is_auto_generated"):
            errors.extend(validate_line(l, accounts, categories))

    if errors:
        return {"error": "; ".join(errors), "lines": final_lines}

    return {"lines": final_lines, "confidence": "high", "ambiguities": []}


# ── CRDB Bank Statement Import — thin wrappers ───────────────────────────
# Real implementation lives in scripts/reconciliation/crdb_tz.py (Block D
# of the OSS-template roadmap). The functions below are kept as stable
# entry points for serve.py and any external callers; they delegate to
# the registered adapter so swapping in a different bank-statement format
# is a config-only change (see config/reconciliation.json).

def parse_crdb_xls(filepath: str) -> list[dict]:
    """Parse a CRDB bank statement XLS file into structured row dicts.

    Backward-compat wrapper around
    :class:`reconciliation.crdb_tz.CrdbTzAdapter`. Returns the same
    ``{date, details, debit, credit, amount, type}`` dicts the original
    function produced before the Block D refactor.
    """
    from reconciliation.crdb_tz import CrdbTzAdapter

    return [
        {
            "date": r.date,
            "details": r.details,
            "debit": r.debit,
            "credit": r.credit,
            "amount": r.amount,
            "type": r.type,
        }
        for r in CrdbTzAdapter().parse(filepath)
    ]


def match_bank_to_payee(details: str) -> dict:
    """Match a CRDB statement 'Details' field to a known payee.

    Backward-compat wrapper around
    :meth:`reconciliation.crdb_tz.CrdbTzAdapter.match_payee`. Returns
    a ``{payee, category, confidence}`` dict.
    """
    from reconciliation.crdb_tz import CrdbTzAdapter

    m = CrdbTzAdapter().match_payee(details)
    return {"payee": m.payee, "category": m.category, "confidence": m.confidence}


def crdb_import_suggestions(xls_path: str) -> list[dict]:
    """Parse XLS and return unmatched bank rows as TX suggestions.

    Routes through :func:`reconciliation.get_adapter_for_account` so the
    CRDB → ``crdb_tz`` mapping in ``config/reconciliation.json`` controls
    which adapter actually parses the file. Output schema is unchanged.
    """
    from reconciliation import get_adapter_for_account

    adapter = get_adapter_for_account("crdb")
    tx_path = DATA_DIR / "transactions.csv"
    existing_tx: list[dict] = []
    if tx_path.exists():
        with open(tx_path, newline="", encoding="utf-8") as f:
            existing_tx = list(csv.DictReader(f))
    suggestions = adapter.reconcile(xls_path, existing_tx, account="crdb")
    return [s.to_dict() for s in suggestions]
