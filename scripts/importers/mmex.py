"""MMEX .mmb (SQLite) reader for the FinanceOS Setup-Wizard.

Block C.1 of the OSS-template roadmap. Reads an MMEX .mmb file
read-only and returns a deterministic, JSON-serialisable staging
payload that the Setup-Wizard (CLI + Web) renders for user review.

This module is side-effect-free by design:
    - never writes to the .mmb file (connection is read-only)
    - never writes to data/*.csv (that is setup_core.finalize's job)
    - carries no Leon-specific payee/tag/alias heuristics

CLI usage:
    python scripts/importers/mmex.py --db path/to/file.mmb
    python scripts/importers/mmex.py --db path/to/file.mmb --staging out.json
    python scripts/importers/mmex.py --db path/to/file.mmb --pretty
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TRANSCODE_EXPENSE = "Withdrawal"
TRANSCODE_INCOME = "Deposit"
TRANSCODE_TRANSFER = "Transfer"


def _connect_readonly(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise FileNotFoundError(f"MMEX file not found: {db_path}")
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _table_exists(cur: sqlite3.Cursor, name: str) -> bool:
    cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
        (name,),
    )
    return cur.fetchone() is not None


def _column_names(cur: sqlite3.Cursor, table: str) -> set[str]:
    cur.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cur.fetchall()}


def _detect_schema_version(cur: sqlite3.Cursor) -> str | None:
    if not _table_exists(cur, "INFOTABLE_V1"):
        return None
    cur.execute(
        "SELECT INFOVALUE FROM INFOTABLE_V1 WHERE INFONAME = 'DATAVERSION'"
    )
    row = cur.fetchone()
    return str(row[0]) if row else None


def _read_currencies(cur: sqlite3.Cursor) -> dict[int, dict[str, Any]]:
    if not _table_exists(cur, "CURRENCYFORMATS_V1"):
        return {}
    cols = _column_names(cur, "CURRENCYFORMATS_V1")
    symbol_col = "CURRENCY_SYMBOL" if "CURRENCY_SYMBOL" in cols else (
        "CURRENCYSYMBOL" if "CURRENCYSYMBOL" in cols else None
    )
    name_col = "CURRENCYNAME" if "CURRENCYNAME" in cols else None
    select_parts = ["CURRENCYID"]
    if name_col:
        select_parts.append(name_col)
    if symbol_col:
        select_parts.append(symbol_col)
    cur.execute(f"SELECT {', '.join(select_parts)} FROM CURRENCYFORMATS_V1")
    result: dict[int, dict[str, Any]] = {}
    for row in cur.fetchall():
        cid = int(row["CURRENCYID"])
        result[cid] = {
            "id": cid,
            "name": str(row[name_col]) if name_col and row[name_col] is not None else "",
            "code": str(row[symbol_col]).strip() if symbol_col and row[symbol_col] is not None else "",
        }
    return result


def _read_accounts(
    cur: sqlite3.Cursor,
    currencies: dict[int, dict[str, Any]],
    warnings: list[str],
) -> list[dict[str, Any]]:
    if not _table_exists(cur, "ACCOUNTLIST_V1"):
        warnings.append("ACCOUNTLIST_V1 missing — no accounts imported")
        return []
    cols = _column_names(cur, "ACCOUNTLIST_V1")
    select = [
        ("id", "ACCOUNTID"),
        ("name", "ACCOUNTNAME"),
        ("type", "ACCOUNTTYPE" if "ACCOUNTTYPE" in cols else "NULL"),
        ("currency_id", "CURRENCYID" if "CURRENCYID" in cols else "NULL"),
        ("initial_balance", "INITIALBAL" if "INITIALBAL" in cols else "NULL"),
        ("initial_date", "INITIALDATE" if "INITIALDATE" in cols else "NULL"),
        ("status", "STATUS" if "STATUS" in cols else "NULL"),
        ("notes", "NOTES" if "NOTES" in cols else "NULL"),
    ]
    sql_cols = ", ".join(f"{c} AS {alias}" for alias, c in select)
    cur.execute(f"SELECT {sql_cols} FROM ACCOUNTLIST_V1 ORDER BY ACCOUNTID")
    out: list[dict[str, Any]] = []
    for row in cur.fetchall():
        cid = row["currency_id"]
        cur_info = currencies.get(int(cid)) if cid is not None else None
        out.append({
            "id": int(row["id"]),
            "name": row["name"] or "",
            "type": row["type"] or "",
            "currency_code": (cur_info or {}).get("code", ""),
            "currency_id": int(cid) if cid is not None else None,
            "initial_balance": float(row["initial_balance"] or 0.0),
            "initial_date": row["initial_date"] or None,
            "status": row["status"] or "",
            "notes": row["notes"] or "",
        })
    return out


def _read_payees(cur: sqlite3.Cursor) -> list[dict[str, Any]]:
    if not _table_exists(cur, "PAYEE_V1"):
        return []
    cur.execute("SELECT PAYEEID, PAYEENAME FROM PAYEE_V1 ORDER BY PAYEEID")
    return [
        {"id": int(r["PAYEEID"]), "name": r["PAYEENAME"] or ""}
        for r in cur.fetchall()
    ]


def _read_categories(cur: sqlite3.Cursor, warnings: list[str]) -> list[dict[str, Any]]:
    """Read categories from either the modern single-table schema (CATEGORY_V1
    with PARENTID) or the legacy two-table schema (CATEGORY_V1 + SUBCATEGORY_V1).

    Output always includes a flattened `full_path` string with `:` separator
    so downstream code can treat both schemas uniformly.
    """
    if not _table_exists(cur, "CATEGORY_V1"):
        warnings.append("CATEGORY_V1 missing — no categories imported")
        return []

    cat_cols = _column_names(cur, "CATEGORY_V1")
    has_parent = "PARENTID" in cat_cols
    has_sub_table = _table_exists(cur, "SUBCATEGORY_V1")

    raw: dict[int, dict[str, Any]] = {}

    if has_parent:
        cur.execute(
            "SELECT CATEGID, CATEGNAME, PARENTID FROM CATEGORY_V1 ORDER BY CATEGID"
        )
        for r in cur.fetchall():
            parent = r["PARENTID"]
            raw[int(r["CATEGID"])] = {
                "id": int(r["CATEGID"]),
                "name": r["CATEGNAME"] or "",
                "parent_id": int(parent) if parent not in (None, 0, -1) else None,
            }
    else:
        cur.execute("SELECT CATEGID, CATEGNAME FROM CATEGORY_V1 ORDER BY CATEGID")
        for r in cur.fetchall():
            raw[int(r["CATEGID"])] = {
                "id": int(r["CATEGID"]),
                "name": r["CATEGNAME"] or "",
                "parent_id": None,
            }
        if has_sub_table:
            # Legacy: SUBCATEGORY_V1 rows carry CATEGID pointing to parent in
            # CATEGORY_V1. Sub-IDs can collide with parent IDs, so offset them.
            offset = max(raw.keys(), default=0) + 1_000_000
            cur.execute(
                "SELECT SUBCATEGID, SUBCATEGNAME, CATEGID FROM SUBCATEGORY_V1 "
                "ORDER BY SUBCATEGID"
            )
            for r in cur.fetchall():
                sub_id = int(r["SUBCATEGID"]) + offset
                raw[sub_id] = {
                    "id": sub_id,
                    "name": r["SUBCATEGNAME"] or "",
                    "parent_id": int(r["CATEGID"]),
                }

    def full_path(cid: int, seen: frozenset[int] = frozenset()) -> str:
        if cid in seen:
            return raw[cid]["name"]  # break cycles defensively
        node = raw[cid]
        if node["parent_id"] is None or node["parent_id"] not in raw:
            return node["name"]
        return f"{full_path(node['parent_id'], seen | {cid})}:{node['name']}"

    return [
        {**node, "full_path": full_path(cid)}
        for cid, node in sorted(raw.items())
    ]


def _read_tags(cur: sqlite3.Cursor) -> list[dict[str, Any]]:
    if not _table_exists(cur, "TAG_V1"):
        return []
    cols = _column_names(cur, "TAG_V1")
    id_col = "TAGID" if "TAGID" in cols else next(iter(cols))
    name_col = "TAGNAME" if "TAGNAME" in cols else None
    if not name_col:
        return []
    cur.execute(f"SELECT {id_col} AS id, {name_col} AS name FROM TAG_V1 ORDER BY {id_col}")
    return [
        {"id": int(r["id"]), "name": r["name"] or ""}
        for r in cur.fetchall()
    ]


def _read_tag_links(cur: sqlite3.Cursor) -> dict[int, list[int]]:
    """Map of transaction id → list of tag ids. Empty if no TAGLINK_V1."""
    if not _table_exists(cur, "TAGLINK_V1"):
        return {}
    cols = _column_names(cur, "TAGLINK_V1")
    if "REFID" not in cols or "TAGID" not in cols:
        return {}
    ref_type_col = "REFTYPE" if "REFTYPE" in cols else None
    sql = "SELECT REFID, TAGID FROM TAGLINK_V1"
    params: tuple = ()
    if ref_type_col:
        sql += f" WHERE {ref_type_col} = ?"
        params = ("Transaction",)
    cur.execute(sql, params)
    out: dict[int, list[int]] = {}
    for r in cur.fetchall():
        out.setdefault(int(r["REFID"]), []).append(int(r["TAGID"]))
    return out


def _normalize_date(raw: Any) -> str | None:
    """MMEX stores TRANSDATE as ISO-ish text. Normalise to YYYY-MM-DD."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # MMEX uses "YYYY-MM-DD" natively in CHECKINGACCOUNT_V1
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    # Defensive: try parsing other formats
    for fmt in ("%Y/%m/%d", "%d/%m/%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s  # last resort: return as-is, let caller flag it


def _read_splits(cur: sqlite3.Cursor) -> dict[int, list[dict[str, Any]]]:
    if not _table_exists(cur, "SPLITTRANSACTIONS_V1"):
        return {}
    cols = _column_names(cur, "SPLITTRANSACTIONS_V1")
    notes_col = "NOTES" if "NOTES" in cols else None
    select_parts = ["TRANSID", "CATEGID", "SPLITTRANSAMOUNT"]
    if notes_col:
        select_parts.append(notes_col)
    cur.execute(
        f"SELECT {', '.join(select_parts)} FROM SPLITTRANSACTIONS_V1 "
        "ORDER BY TRANSID, SPLITTRANSID"
    )
    out: dict[int, list[dict[str, Any]]] = {}
    for r in cur.fetchall():
        tid = int(r["TRANSID"])
        out.setdefault(tid, []).append({
            "category_id": int(r["CATEGID"]) if r["CATEGID"] is not None else None,
            "amount": float(r["SPLITTRANSAMOUNT"] or 0.0),
            "notes": (r[notes_col] or "") if notes_col else "",
        })
    return out


def _read_transactions(
    cur: sqlite3.Cursor,
    tag_links: dict[int, list[int]],
    splits: dict[int, list[dict[str, Any]]],
    warnings: list[str],
) -> list[dict[str, Any]]:
    if not _table_exists(cur, "CHECKINGACCOUNT_V1"):
        warnings.append("CHECKINGACCOUNT_V1 missing — no transactions imported")
        return []
    cols = _column_names(cur, "CHECKINGACCOUNT_V1")
    has_deleted = "DELETEDTIME" in cols
    notes_col = "NOTES" if "NOTES" in cols else None

    where_clauses = ["STATUS != 'V'"]
    if has_deleted:
        where_clauses.append("TRIM(COALESCE(DELETEDTIME, '')) = ''")
    where = " AND ".join(where_clauses)

    select_parts = [
        "TRANSID", "ACCOUNTID", "TOACCOUNTID", "PAYEEID",
        "TRANSCODE", "TRANSAMOUNT", "TOTRANSAMOUNT",
        "TRANSDATE", "STATUS", "CATEGID",
    ]
    if notes_col:
        select_parts.append(notes_col)

    cur.execute(
        f"SELECT {', '.join(select_parts)} FROM CHECKINGACCOUNT_V1 "
        f"WHERE {where} ORDER BY TRANSDATE, TRANSID"
    )

    out: list[dict[str, Any]] = []
    for r in cur.fetchall():
        tid = int(r["TRANSID"])
        to_acc = r["TOACCOUNTID"]
        to_amount = r["TOTRANSAMOUNT"]
        out.append({
            "id": tid,
            "date": _normalize_date(r["TRANSDATE"]),
            "account_id": int(r["ACCOUNTID"]),
            "to_account_id": int(to_acc) if to_acc not in (None, 0, -1) else None,
            "payee_id": int(r["PAYEEID"]) if r["PAYEEID"] not in (None, -1) else None,
            "category_id": int(r["CATEGID"]) if r["CATEGID"] not in (None, -1) else None,
            "amount": float(r["TRANSAMOUNT"] or 0.0),
            "to_amount": float(to_amount) if to_amount not in (None, 0, 0.0) else None,
            "trans_code": r["TRANSCODE"] or "",
            "status": r["STATUS"] or "",
            "notes": (r[notes_col] or "") if notes_col else "",
            "tag_ids": sorted(tag_links.get(tid, [])),
            "splits": splits.get(tid, []),
        })
    return out


def _build_stats(
    accounts: list[dict[str, Any]],
    categories: list[dict[str, Any]],
    payees: list[dict[str, Any]],
    tags: list[dict[str, Any]],
    transactions: list[dict[str, Any]],
) -> dict[str, Any]:
    by_account = {a["id"]: a for a in accounts}
    currency_counter: Counter[str] = Counter()
    transfer_count = 0
    expense_count = 0
    income_count = 0
    split_count = 0
    dates: list[str] = []
    for tx in transactions:
        acc = by_account.get(tx["account_id"])
        code = (acc or {}).get("currency_code") or "?"
        currency_counter[code] += 1
        if tx["trans_code"] == TRANSCODE_TRANSFER:
            transfer_count += 1
        elif tx["trans_code"] == TRANSCODE_EXPENSE:
            expense_count += 1
        elif tx["trans_code"] == TRANSCODE_INCOME:
            income_count += 1
        if tx["splits"]:
            split_count += 1
        if tx["date"]:
            dates.append(tx["date"])
    date_range: list[str] | None = None
    if dates:
        dates.sort()
        date_range = [dates[0], dates[-1]]
    return {
        "account_count": len(accounts),
        "category_count": len(categories),
        "payee_count": len(payees),
        "tag_count": len(tags),
        "transaction_count": len(transactions),
        "expense_count": expense_count,
        "income_count": income_count,
        "transfer_count": transfer_count,
        "split_count": split_count,
        "date_range": date_range,
        "currency_counts": dict(sorted(currency_counter.items())),
    }


def read_mmex(db_path: Path) -> dict[str, Any]:
    """Read an MMEX .mmb file and return a JSON-serialisable staging payload.

    The returned structure is deterministic: same .mmb → same dict.
    Open read-only so the file on disk is never touched.
    """
    db_path = Path(db_path)
    warnings: list[str] = []
    with _connect_readonly(db_path) as conn:
        cur = conn.cursor()
        schema_version = _detect_schema_version(cur)
        currencies_by_id = _read_currencies(cur)
        accounts = _read_accounts(cur, currencies_by_id, warnings)
        categories = _read_categories(cur, warnings)
        payees = _read_payees(cur)
        tags = _read_tags(cur)
        tag_links = _read_tag_links(cur)
        splits = _read_splits(cur)
        transactions = _read_transactions(cur, tag_links, splits, warnings)

    currencies = sorted(currencies_by_id.values(), key=lambda c: c["id"])
    stats = _build_stats(accounts, categories, payees, tags, transactions)

    return {
        "source": "mmex",
        "schema_version": schema_version,
        "db_path": db_path.as_posix(),
        "read_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "currencies": currencies,
        "accounts": accounts,
        "categories": categories,
        "payees": payees,
        "tags": tags,
        "transactions": transactions,
        "stats": stats,
        "warnings": warnings,
    }


def _print_summary(payload: dict[str, Any]) -> None:
    s = payload["stats"]
    print(f"MMEX file: {payload['db_path']}")
    if payload["schema_version"]:
        print(f"Schema version: {payload['schema_version']}")
    print(f"Accounts:     {s['account_count']}")
    print(f"Categories:   {s['category_count']}")
    print(f"Payees:       {s['payee_count']}")
    print(f"Tags:         {s['tag_count']}")
    print(f"Transactions: {s['transaction_count']}"
          f"  (expense {s['expense_count']}, income {s['income_count']},"
          f" transfer {s['transfer_count']}, with-splits {s['split_count']})")
    if s["date_range"]:
        print(f"Date range:   {s['date_range'][0]} … {s['date_range'][1]}")
    if s["currency_counts"]:
        per_cur = ", ".join(f"{c}:{n}" for c, n in s["currency_counts"].items())
        print(f"Currencies:   {per_cur}")
    if payload["warnings"]:
        print()
        print("Warnings:")
        for w in payload["warnings"]:
            print(f"  - {w}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", required=True, type=Path,
                        help="Path to the MMEX .mmb file (SQLite).")
    parser.add_argument("--staging", type=Path, default=None,
                        help="If set, write the full staging payload as JSON "
                             "to this path. Default: print summary only.")
    parser.add_argument("--pretty", action="store_true",
                        help="Pretty-print the JSON (requires --staging or "
                             "--stdout).")
    parser.add_argument("--stdout", action="store_true",
                        help="Write the full staging payload to stdout "
                             "instead of a file.")
    args = parser.parse_args()

    try:
        payload = read_mmex(args.db)
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except sqlite3.DatabaseError as exc:
        print(f"ERROR: not a valid SQLite database: {exc}", file=sys.stderr)
        return 2

    indent = 2 if args.pretty else None
    if args.stdout:
        json.dump(payload, sys.stdout, indent=indent, ensure_ascii=False,
                  default=str)
        sys.stdout.write("\n")
    elif args.staging:
        args.staging.parent.mkdir(parents=True, exist_ok=True)
        with args.staging.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=indent, ensure_ascii=False,
                      default=str)
        print(f"Staging written to {args.staging}")
        _print_summary(payload)
    else:
        _print_summary(payload)

    return 0


if __name__ == "__main__":
    sys.exit(main())
