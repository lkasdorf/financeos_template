"""CRDB Bank Tanzania reconciliation adapter.

Block D reference adapter. Parses CRDB's monthly account-statement
XLS export and matches each bank row against the FinanceOS payee
register. Originally lived inline in ``tx_engine.py`` (Session 26);
extracted here so the OSS template can ship CRDB as a real plugin
example rather than a hardcoded feature.

CRDB statement format (xlrd-readable XLS):
    rows 0-13 : header / account metadata
    row 14    : column titles
    rows 15+  : data — Posting Date | Details | Value Date | Debit | Credit | Book Balance

Date format is ``DD.MM.YYYY HH:MM:SS``. Amounts use comma as the
thousands separator and dot as the decimal (e.g. ``28,874.40``).
"""

from __future__ import annotations

from .base import BankAdapter, BankRow, PayeeMatch


class CrdbTzAdapter(BankAdapter):
    """Reference adapter: CRDB Bank Tanzania statement (.xls)."""

    name = "crdb_tz"
    display_name = "CRDB Bank (Tanzania)"
    file_extensions = [".xls"]
    data_subdir = "crdb_data"
    default_account = "crdb"
    default_currency = "TZS"

    # Bank-specific fallback patterns when no payee alias hits. Mirrors
    # the original Session-26 list verbatim so behaviour is preserved.
    _FALLBACK_PATTERNS: tuple[tuple[str, tuple[str, str, str]], ...] = (
        ("interest", ("CRDB", "Income:Interest", "medium")),
        ("sms alert", ("CRDB", "Fees:Bank Fees", "high")),
        ("maintenance fee", ("CRDB", "Fees:Bank Fees", "high")),
        ("debit arrangement tax", ("CRDB", "Fees:Bank Fees", "high")),
        ("excise duty", ("CRDB", "Fees:Bank Fees", "high")),
        ("withholding tax", ("CRDB", "Fees:Bank Fees", "high")),
        ("atm withdrawal", ("ATM", "Transfer", "medium")),
        ("e-com purchase", ("", "", "none")),
        ("pos purchase", ("", "", "none")),
    )

    def parse(self, filepath: str) -> list[BankRow]:
        # xlrd is the only optional dep; importing lazily keeps the
        # module load-light for installs that don't use this adapter.
        import xlrd

        wb = xlrd.open_workbook(filepath, formatting_info=False)
        ws = wb.sheet_by_index(0)
        rows: list[BankRow] = []

        for i in range(15, ws.nrows):
            raw = [ws.cell_value(i, j) for j in range(ws.ncols)]
            posting_date = str(raw[0]).strip()
            details = str(raw[1]).strip()
            debit_str = str(raw[3]).strip()
            credit_str = str(raw[4]).strip()

            if not posting_date or not details:
                continue

            # '01.04.2026 20:30:00' → '2026-04-01'.
            date_iso = ""
            try:
                parts = posting_date.split(" ")[0].split(".")
                if len(parts) == 3:
                    date_iso = f"{parts[2]}-{parts[1]}-{parts[0]}"
            except Exception:
                pass

            debit = _parse_amount(debit_str)
            credit = _parse_amount(credit_str)
            amount = debit if debit > 0 else credit
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
        # Lazy import to break the tx_engine ↔ reconciliation cycle.
        from tx_engine import load_payees

        details_lower = details.lower()

        # Phase 1: longest substring match against payee names + aliases.
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

        # Phase 2: bank-specific fallbacks (statement noise lines).
        for pattern, (payee, cat, conf) in self._FALLBACK_PATTERNS:
            if pattern in details_lower:
                return PayeeMatch(payee=payee, category=cat, confidence=conf)

        return PayeeMatch(payee="", category="", confidence="none")


def _parse_amount(s: str) -> float:
    """Parse '28,874.40' → 28874.40. Empty / unparseable → 0.0."""
    s = s.replace(",", "").replace(" ", "")
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0
