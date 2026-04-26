"""Generic CSV bank-statement adapter.

Block D default adapter. Handles the most common CSV layout exported
by retail banks: one row per transaction with a date column, a memo /
description column, and either a single signed amount column or a
``debit`` / ``credit`` pair.

Column names are configured in ``config/reconciliation.json`` under
``adapters.csv_generic``::

    {
      "adapters": {
        "csv_generic": {
          "date_column": "Date",
          "details_column": "Description",
          "amount_column": "Amount",
          "debit_column": null,
          "credit_column": null,
          "date_format": "%Y-%m-%d",
          "decimal_separator": ".",
          "thousands_separator": ","
        }
      }
    }

If ``amount_column`` is set, positive values are treated as income
and negatives as expense. If ``debit_column`` + ``credit_column`` are
set instead, debits become expenses and credits income (mirroring
the CRDB convention).
"""

from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

from .base import BankAdapter, BankRow, PayeeMatch


_DEFAULT_CONFIG: dict[str, object] = {
    "date_column": "Date",
    "details_column": "Description",
    "amount_column": "Amount",
    "debit_column": None,
    "credit_column": None,
    "date_format": "%Y-%m-%d",
    "decimal_separator": ".",
    "thousands_separator": ",",
}


class CsvGenericAdapter(BankAdapter):
    """Default adapter for plain-CSV bank statements."""

    name = "csv_generic"
    display_name = "Generic CSV"
    file_extensions = [".csv"]
    data_subdir = "bank_imports"
    default_account = ""
    default_currency = ""

    def _config(self) -> dict[str, object]:
        # Lazy import so the adapter package can be imported standalone.
        from . import load_recon_config

        cfg = load_recon_config()
        adapter_cfg = (cfg.get("adapters") or {}).get(self.name, {})
        merged = dict(_DEFAULT_CONFIG)
        if isinstance(adapter_cfg, dict):
            merged.update(adapter_cfg)
        return merged

    def parse(self, filepath: str) -> list[BankRow]:
        cfg = self._config()
        date_col = str(cfg["date_column"])
        details_col = str(cfg["details_column"])
        amount_col = cfg.get("amount_column")
        debit_col = cfg.get("debit_column")
        credit_col = cfg.get("credit_column")
        date_fmt = str(cfg["date_format"])
        dec_sep = str(cfg["decimal_separator"])
        thou_sep = str(cfg["thousands_separator"])

        rows: list[BankRow] = []
        with Path(filepath).open("r", newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for raw in reader:
                date_iso = _normalise_date(raw.get(date_col, ""), date_fmt)
                details = (raw.get(details_col, "") or "").strip()
                if not date_iso or not details:
                    continue

                debit = 0.0
                credit = 0.0
                if amount_col:
                    signed = _parse_amount(raw.get(str(amount_col), ""), dec_sep, thou_sep)
                    if signed >= 0:
                        credit = signed
                    else:
                        debit = abs(signed)
                else:
                    if debit_col:
                        debit = _parse_amount(raw.get(str(debit_col), ""), dec_sep, thou_sep)
                    if credit_col:
                        credit = _parse_amount(raw.get(str(credit_col), ""), dec_sep, thou_sep)

                amount = debit if debit > 0 else credit
                if amount <= 0:
                    continue
                tx_type = "expense" if debit > 0 else "income"

                rows.append(
                    BankRow(
                        date=date_iso,
                        details=details,
                        amount=amount,
                        type=tx_type,
                        debit=debit,
                        credit=credit,
                    )
                )
        return rows

    def match_payee(self, details: str) -> PayeeMatch:
        # Same longest-substring strategy as the CRDB adapter, minus
        # bank-specific fallback patterns.
        from tx_engine import load_payees

        details_lower = details.lower()
        best = None
        best_len = 0
        for p in load_payees():
            candidates = [p["payee"].lower()] + [a.lower() for a in p.get("aliases", [])]
            for c in candidates:
                if not c:
                    continue
                if c in details_lower and len(c) > best_len:
                    best = p
                    best_len = len(c)
        if best:
            return PayeeMatch(
                payee=best["payee"],
                category=best.get("default_category", ""),
                confidence="high" if best_len >= 4 else "medium",
            )
        return PayeeMatch(payee="", category="", confidence="none")


def _normalise_date(raw: str, fmt: str) -> str:
    """Parse ``raw`` per ``fmt`` and return ISO-8601, or '' on failure."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    try:
        return datetime.strptime(raw, fmt).date().isoformat()
    except ValueError:
        # Already ISO-8601?
        try:
            return datetime.fromisoformat(raw).date().isoformat()
        except ValueError:
            return ""


def _parse_amount(raw: object, dec_sep: str, thou_sep: str) -> float:
    """Parse a string amount with configurable separators. Empty → 0.0."""
    s = str(raw or "").strip()
    if not s:
        return 0.0
    if thou_sep:
        s = s.replace(thou_sep, "")
    if dec_sep and dec_sep != ".":
        s = s.replace(dec_sep, ".")
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0
