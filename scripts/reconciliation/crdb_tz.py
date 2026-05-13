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

from typing import Any

from .base import BankAdapter, BankRow, PayeeMatch, Suggestion


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
        import sys
        import xlrd

        wb = xlrd.open_workbook(filepath, formatting_info=False)
        ws = wb.sheet_by_index(0)
        rows: list[BankRow] = []
        # Reset per-call so callers can inspect parse_errors right after
        # parse() (or via reconcile, which delegates to parse).
        self.parse_errors: list[dict] = []

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
                else:
                    self.parse_errors.append({
                        "row": i + 1,
                        "posting_date": posting_date,
                        "reason": "expected DD.MM.YYYY date format",
                    })
            except Exception as e:
                self.parse_errors.append({
                    "row": i + 1,
                    "posting_date": posting_date,
                    "reason": f"{type(e).__name__}: {e}",
                })

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
        if self.parse_errors:
            print(
                f"[crdb_tz] {len(self.parse_errors)} date-parse error(s) in "
                f"{filepath}; first={self.parse_errors[0]}",
                file=sys.stderr,
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

    def reconcile(
        self,
        filepath: str,
        existing_tx: list[dict[str, Any]],
        account: str | None = None,
    ) -> list[Suggestion]:
        """Match bank rows against existing FOS transactions, CRDB-tuned.

        The default base implementation does an exact (date, amount)
        lookup with a ±1-day shift. CRDB statements routinely violate
        that pattern in three ways, so this override relaxes along
        three axes:

        1. **Cent rounding** — TZS has no real sub-unit; the bank
           prints e.g. ``305.10`` while FOS booked ``305.00``. We
           round both sides to whole TZS for the lookup, eliminating
           single-cent jitter without false-positives in practice.
        2. **±2-day window** — E-COM purchases sometimes post 2 days
           after the booking date the user typed in (Session 26's
           ``±1`` was too tight; observed in Apr 2026 Claude.AI sub).
        3. **Same-payee aggregation** — receipt splits in FOS sum to
           a single bank line. After a direct miss we check whether
           the FOS rows for the payee resolved by :meth:`match_payee`
           sum to the bank amount within ±2 days (1 TZS tolerance).
           Aggregation buckets are consumed once so two bank rows
           cannot both claim the same set of FOS splits.

        FOS payees are normalised to their canonical form via
        ``payees.json`` aliases, so a typo'd ``Village Supermerket``
        still aggregates under the canonical ``Village Supermarket``.
        """
        from datetime import date as dt_date, timedelta
        from tx_engine import load_payees

        target_account = account or self.default_account
        rows = self.parse(filepath)

        # Build alias→canonical map for payee normalisation. Falls
        # back to the raw payee (lower-cased) if not in the register.
        alias_to_canon: dict[str, str] = {}
        for p in load_payees():
            canon = (p.get("payee") or "").strip().lower()
            if not canon:
                continue
            alias_to_canon[canon] = canon
            for a in p.get("aliases") or []:
                a_norm = (a or "").strip().lower()
                if a_norm:
                    alias_to_canon[a_norm] = canon

        def canon_of(payee_raw: str) -> str:
            norm = (payee_raw or "").strip().lower()
            return alias_to_canon.get(norm, norm)

        # Direct match index: (date, rounded_int_amount) with ±2-day shifts.
        existing_keys: set[tuple[str, int]] = set()
        # Aggregation index: (date, canonical_payee) → list of FOS rows
        # for that day. Pass 2 only uses buckets that are clearly a
        # single split (shared receipt_group, multiple rows summing to
        # one bank line) — see ambiguity guard below.
        by_date_payee: dict[tuple[str, str], list[dict]] = {}

        for t in existing_tx:
            if target_account and t.get("account") != target_account:
                continue
            try:
                amt = abs(float(t.get("amount", 0)))
            except (TypeError, ValueError):
                continue
            iso = t.get("date", "")
            if not iso:
                continue
            amt_int = round(amt)
            existing_keys.add((iso, amt_int))
            try:
                d = dt_date.fromisoformat(iso)
                for delta in (-2, -1, 1, 2):
                    shifted = (d + timedelta(days=delta)).isoformat()
                    existing_keys.add((shifted, amt_int))
            except ValueError:
                pass
            canon = canon_of(t.get("payee", ""))
            if canon:
                key = (iso, canon)
                by_date_payee.setdefault(key, []).append({
                    "amount": amt,
                    "receipt_group": (t.get("receipt_group") or "").strip(),
                })

        # M-B8 (Sprint 22) — Pass-2 aggregation now requires the FOS
        # bucket to be a designed receipt-split (all rows share the
        # same non-empty receipt_group). Without that guard, three
        # separate same-day Same-Payee TX (e.g. three Google purchases
        # at 28976.27 + 32199 + 9605) would collapse into one bucket
        # and the first bank line whose amount coincidentally summed
        # would over-claim. April 2026 statement had 12 of 49 bank
        # rows hit this shape — risk is real, not theoretical.
        #
        # Trade-off: aggregation only catches actual splits now. A
        # genuine "single receipt, multiple non-split FOS rows" is
        # rare and the user reviews unmatched anyway.
        def _bucket_is_safe(bucket: list[dict]) -> tuple[bool, float]:
            """Bucket qualifies for Pass-2 only when all rows share
            one non-empty receipt_group (a real receipt-split). Returns
            (qualified, sum) so the caller can compare against bank
            amount without re-walking.
            """
            if not bucket:
                return (False, 0.0)
            if len(bucket) == 1:
                # Single-row "bucket" is just the Pass-1 case — but
                # Pass-1 already failed (cent rounding diff?), let it
                # through so e.g. 305.10 vs 305.00 still matches.
                return (True, bucket[0]["amount"])
            rgs = {r["receipt_group"] for r in bucket}
            # Multi-row bucket is safe ONLY when every row is part of
            # the same designed receipt-group. Any non-split row or
            # mixed receipt_groups → ambiguous → no aggregation.
            if "" in rgs or len(rgs) > 1:
                return (False, 0.0)
            return (True, sum(r["amount"] for r in bucket))

        # Buckets we have already consumed by aggregation matches —
        # prevents two bank rows claiming the same split set.
        consumed_aggs: set[tuple[str, str]] = set()
        suggestions: list[Suggestion] = []

        for row in rows:
            amt_int = round(row.amount)
            # Pass 1: direct cent-rounded lookup with ±2-day shifts.
            if (row.date, amt_int) in existing_keys:
                continue

            # Pass 2: same-payee aggregation in ±2-day window.
            match = self.match_payee(row.details)
            matched_via_agg = False
            if match.payee:
                canon = canon_of(match.payee)
                try:
                    d = dt_date.fromisoformat(row.date)
                    # Closest-day-first so a same-day split wins over
                    # a 2-day-shifted neighbour with identical sum.
                    for delta in (0, -1, 1, -2, 2):
                        target_date = (d + timedelta(days=delta)).isoformat()
                        bucket_key = (target_date, canon)
                        if bucket_key in consumed_aggs:
                            continue
                        bucket = by_date_payee.get(bucket_key)
                        if not bucket:
                            continue
                        # M-B8 (Sprint 22) — only aggregate when the bucket
                        # is a designed receipt-split. See _bucket_is_safe.
                        qualified, bucket_sum = _bucket_is_safe(bucket)
                        if not qualified:
                            continue
                        if abs(bucket_sum - row.amount) < 1.0:
                            consumed_aggs.add(bucket_key)
                            matched_via_agg = True
                            break
                except ValueError:
                    pass
            if matched_via_agg:
                continue

            # Still unmatched → render as suggestion.
            suggestions.append(
                Suggestion(
                    date=row.date,
                    bank_details=row.details,
                    amount=round(row.amount, 2),
                    type=row.type,
                    account=target_account,
                    currency=self.default_currency,
                    payee=match.payee,
                    category=match.category,
                    match_confidence=match.confidence,
                    note="",
                )
            )
        return suggestions


def _parse_amount(s: str) -> float:
    """Parse '28,874.40' → 28874.40. Empty / unparseable → 0.0."""
    s = s.replace(",", "").replace(" ", "")
    try:
        return float(s)
    except (ValueError, TypeError):
        return 0.0
