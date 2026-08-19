"""Cash Count subsystem (spec: docs/superpowers/specs/2026-07-19-cash-count-design.md).

Count physical cash, enter the counted balance in the dashboard modal, and
the backend books the difference against the configured discrepancy
categories. Every count — including a perfect match — is appended to
data/cash_count_log.csv so each account's "last counted" date is known.
"""
from __future__ import annotations

import csv
import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path

import config_loader
import linked_log
import tx_engine
from backup import backup_file

# Canonical column order for cash_count_log.csv. Append-only audit trail;
# tx_id is informational (no delete cascade — the count happened regardless
# of later TX corrections) and stays empty for zero-diff counts.
CASH_COUNT_LOG_COLUMNS = [
    "count_id", "date", "account", "expected", "counted", "diff",
    "tx_id", "created_at",
]


def _log_path() -> Path:
    # Resolved per call (not module-level) so tests can monkeypatch
    # tx_engine.DATA_DIR and everything follows.
    return tx_engine.DATA_DIR / "cash_count_log.csv"


def _f(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_transactions() -> list[dict]:
    """All transactions.csv rows as dicts (empty list if the file is missing)."""
    tx_path = tx_engine.DATA_DIR / "transactions.csv"
    if not tx_path.exists():
        return []
    with open(tx_path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def compute_balances(accounts: dict[str, dict], transactions: list[dict]) -> dict[str, float]:
    """Server-side mirror of computeBalances() in dashboard/core.js:840.

    Keep the two implementations in sync — the stale-expected check in
    confirm_counts() relies on both sides producing identical numbers.
    """
    balances = {alias: _f(row.get("initial_balance")) for alias, row in accounts.items()}
    for t in transactions:
        ttype = t.get("type")
        acc = t.get("account")
        amount = _f(t.get("amount"))
        if ttype == "expense":
            if acc in balances:
                balances[acc] -= amount
        elif ttype == "income":
            if acc in balances:
                balances[acc] += amount
        elif ttype == "transfer":
            if acc in balances:
                balances[acc] -= amount
            to_acc = t.get("transfer_to_account")
            if to_acc and to_acc in balances:
                to_amt = _f(t.get("transfer_to_amount"))
                balances[to_acc] += to_amt if to_amt > 0 else amount
    return balances


def _last_counted() -> dict[str, str]:
    """alias -> most recent count date. Log is append-only; latest date wins."""
    path = _log_path()
    if not path.exists():
        return {}
    last: dict[str, str] = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            alias = row.get("account") or ""
            date = row.get("date") or ""
            if alias and date >= last.get(alias, ""):
                last[alias] = date
    return last


def get_context() -> dict:
    """Payload for the Cash Count modal: configured accounts with fresh
    server-side book balances and last-counted dates."""
    cfg = config_loader.get_cash_count_config()
    accounts = tx_engine.load_accounts()
    balances = compute_balances(accounts, load_transactions())
    last = _last_counted()
    rows = []
    for alias in cfg["accounts"]:
        acc = accounts.get(alias)
        if not acc or acc.get("status") != "active":
            continue  # stale config entry (renamed/archived account) — skip
        rows.append({
            "alias": alias,
            "name": acc.get("name", alias),
            "currency": acc.get("currency", ""),
            "expected": round(balances.get(alias, 0.0), 2),
            "last_counted": last.get(alias, ""),
        })
    return {
        "accounts": rows,
        "expense_category": cfg["expense_category"],
        "income_category": cfg["income_category"],
    }


def _fmt_amount(v: float) -> str:
    """1234567.5 -> '1,234,567.5'; whole numbers drop the decimals."""
    s = f"{v:,.2f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def _build_discrepancy_tx(acc: dict, date: str, expected: float,
                          counted: float, diff: float, cfg: dict) -> dict:
    """TX line dict for one discrepancy. Same shape as utilities.build_luku_tx."""
    is_shortfall = diff < 0
    category = cfg["expense_category"] if is_shortfall else cfg["income_category"]
    payee = "Cash Count"
    note = f"Cash count: expected {_fmt_amount(expected)} — counted {_fmt_amount(counted)}"
    tags = ";".join(tx_engine.apply_auto_tags(acc["alias"], payee, [], category))
    return {
        "date": date,
        "account": acc["alias"],
        "type": "expense" if is_shortfall else "income",
        "amount": abs(diff),
        "currency": acc.get("currency", ""),
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


def confirm_counts(*, date: str, rows: list[dict], client_id: str = "") -> dict:
    """Book the discrepancies for a batch of counted accounts.

    Server-authoritative: the book balance is recomputed here; rows whose
    expected_client no longer matches are rejected with the fresh value
    (spec §2) instead of booking a wrong diff. That check doubles as the
    natural double-booking guard — a booked diff moves the balance, so an
    accidental resubmit of the same numbers comes back rejected_stale.
    """
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except (TypeError, ValueError):
        raise ValueError(f"invalid date: {date!r}")
    if not rows:
        raise ValueError("rows must not be empty")

    cfg = config_loader.get_cash_count_config()
    allowed = set(cfg["accounts"])

    # Atomic across balance snapshot + TX append + log append (fuel/LUKU
    # pattern) so a concurrent writer can't invalidate the stale check or
    # observe a TX without its log row. Reentrant lock — inner @with_tx_lock
    # decorators skip the OS re-acquire.
    with tx_engine.tx_write_lock():
        if client_id:
            replay = tx_engine.check_confirm_seen(client_id)
            if replay is not None:
                return {"results": [], "import_ids": replay,
                        "duplicate": True, "git_committed": False}

        accounts = tx_engine.load_accounts()
        balances = compute_balances(accounts, load_transactions())

        results: list[dict] = []
        log_rows: list[dict] = []
        pending: list[tuple[dict, dict, dict]] = []  # (tx_line, log_row, result)

        for r in rows:
            alias = str(r.get("account") or "")
            acc = accounts.get(alias)
            res: dict = {"account": alias}
            results.append(res)
            if alias not in allowed or not acc:
                res.update(status="rejected_invalid",
                           error="account not configured for cash count")
                continue
            try:
                counted = float(r.get("counted"))
                expected_client = float(r.get("expected_client"))
            except (TypeError, ValueError):
                res.update(status="rejected_invalid",
                           error="counted/expected_client must be numbers")
                continue
            if not (math.isfinite(counted) and math.isfinite(expected_client)):
                res.update(status="rejected_invalid",
                           error="counted/expected_client must be finite numbers")
                continue
            # Normalize to cents before diffing/logging — parseAmountInput can
            # emit sub-cent values.
            counted = round(counted, 2)
            if counted < 0:
                res.update(status="rejected_invalid",
                           error="counted balance cannot be negative")
                continue
            expected = round(balances.get(alias, 0.0), 2)
            res.update(expected=expected, counted=counted)
            if abs(expected - expected_client) > 0.004:
                res["status"] = "rejected_stale"
                continue
            diff = round(counted - expected, 2)
            res["diff"] = diff
            log_row = {
                "count_id": "cc-" + uuid.uuid4().hex[:12],
                "date": date,
                "account": alias,
                "expected": expected,
                "counted": counted,
                "diff": diff,
                "tx_id": "",
                "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            log_rows.append(log_row)
            if diff == 0:
                res["status"] = "logged_only"
            else:
                res["status"] = "booked"
                pending.append((_build_discrepancy_tx(acc, date, expected,
                                                      counted, diff, cfg),
                                log_row, res))

        import_ids: list[str] = []
        if log_rows:
            # Backups before any write — FinanceOS hard rule.
            if pending:
                backup_file("transactions", tx_engine.DATA_DIR / "transactions.csv")
            if _log_path().exists():
                backup_file("cash_count_log", _log_path())

            prompt_id = None
            if pending:
                existing_ids = tx_engine.load_existing_import_ids()
                lines = []
                for line, _log, _res in pending:
                    line["import_id"] = tx_engine.generate_import_id(
                        line["date"], line["account"], float(line["amount"]),
                        line["payee"], line["category"], line["note"],
                        existing_ids)
                    existing_ids.add(line["import_id"])
                    lines.append(line)
                prompt_id = tx_engine.log_to_prompt_log(
                    f"CASH COUNT {date}", json.dumps(lines, ensure_ascii=False))
                tx_engine.append_transactions(lines)
                for line, log_row, res in pending:
                    # append_transactions may rewrite import_id on collision —
                    # read it back off the line dict (mutated in place).
                    log_row["tx_id"] = line["import_id"]
                    res["tx_id"] = line["import_id"]
                    import_ids.append(line["import_id"])
            for log_row in log_rows:
                linked_log.append_log(_log_path(), CASH_COUNT_LOG_COLUMNS, log_row)
            if client_id:
                # record BEFORE mark_prompt_booked — same ordering as
                # handle_tx_confirm (P-H1).
                tx_engine.record_confirm_seen(client_id, import_ids)
            if prompt_id is not None:
                try:
                    tx_engine.mark_prompt_booked(prompt_id)
                except Exception:
                    pass  # booked TX is durable; a stuck queue row shows in QUEUE
        # Fully-rejected batches are deliberately NOT recorded in the
        # idempotency store — a retry must re-evaluate and return the same
        # rejection details, not a hollow duplicate response.

    committed = False
    if log_rows:
        committed = tx_engine.git_commit(
            f"cash count {date}",
            files=["data/transactions.csv", "data/cash_count_log.csv",
                   "data/prompt_log.csv"])
    return {"results": results, "import_ids": import_ids,
            "git_committed": committed}
