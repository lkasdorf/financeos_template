"""Base classes for bank-statement reconciliation adapters.

Block D of the OSS-template roadmap. Every concrete bank/file format
plugs into the reconciliation pipeline by subclassing :class:`BankAdapter`
and registering itself in :mod:`scripts.reconciliation` (the package
``__init__``).

A reconciliation adapter has three responsibilities:

1. Discover statement files in its assigned ``data/`` subdirectory.
2. Parse a chosen statement file into a stable list of :class:`BankRow`.
3. Match each unmatched bank row to an existing payee + category, so
   the dashboard can present a one-click "book it" suggestion list.

Adapters are intentionally side-effect-free. They never write to
``data/transactions.csv`` — finalising a suggestion is the dashboard /
TX-engine's job. This keeps adapters trivially unit-testable and safe
to ship as community contributions.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ── Data classes ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class BankRow:
    """A single normalised row from a parsed bank statement.

    Adapters convert their native format (XLS, CSV, OFX, …) into a list
    of ``BankRow`` so the rest of the pipeline can treat all banks the
    same way.
    """

    date: str            # ISO 8601 (YYYY-MM-DD); empty string if unparseable.
    details: str         # Raw description / memo text from the bank.
    amount: float        # Positive magnitude; sign is implied by ``type``.
    type: str            # 'expense' (debit) or 'income' (credit).
    debit: float = 0.0   # Original debit value (informational).
    credit: float = 0.0  # Original credit value (informational).
    extras: dict = field(default_factory=dict)  # Adapter-specific extras.


@dataclass(frozen=True)
class PayeeMatch:
    """Result of matching a bank-statement detail line to a known payee."""

    payee: str           # Empty string if no match.
    category: str        # Default category for the matched payee.
    confidence: str      # 'high' | 'medium' | 'low' | 'none'.


@dataclass
class Suggestion:
    """A single import suggestion ready to render in the dashboard.

    Carries everything the dashboard's recon-import tab needs to render
    a row, plus the bank's raw details so the user can decide whether
    to book it.
    """

    date: str
    bank_details: str
    amount: float
    type: str
    account: str
    currency: str
    payee: str
    category: str
    match_confidence: str
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Plain-dict form for JSON serialisation."""
        return {
            "date": self.date,
            "bank_details": self.bank_details,
            "amount": self.amount,
            "type": self.type,
            "account": self.account,
            "currency": self.currency,
            "payee": self.payee,
            "category": self.category,
            "match_confidence": self.match_confidence,
            "note": self.note,
        }


# ── Abstract adapter ─────────────────────────────────────────────────

class BankAdapter(ABC):
    """Abstract base class for bank-statement reconciliation adapters.

    Subclasses must set the three class attributes (``name``,
    ``display_name``, ``file_extensions``) and implement :meth:`parse`
    and :meth:`match_payee`. The :meth:`reconcile` method has a working
    default that delegates to those two — override it only if your bank
    needs custom matching beyond the standard (date, amount) lookup
    against existing transactions.
    """

    # Stable identifier used in config/reconciliation.json. Lowercase,
    # snake_case (e.g. 'crdb_tz', 'csv_generic').
    name: str = ""

    # Human-readable label shown in the UI dropdown.
    display_name: str = ""

    # File extensions this adapter accepts (lowercase, leading dot).
    file_extensions: list[str] = []

    # Subdirectory under ``data/`` where statement files live. Each
    # adapter gets its own folder so files cannot collide.
    data_subdir: str = ""

    # Default account alias this adapter targets. Adapters may handle
    # multiple accounts; this is just the first-class one.
    default_account: str = ""

    # Default currency for produced suggestions (3-letter ISO).
    default_currency: str = ""

    # ── Required overrides ───────────────────────────────────────────

    @abstractmethod
    def parse(self, filepath: str) -> list[BankRow]:
        """Parse a single statement file into normalised :class:`BankRow`s."""

    @abstractmethod
    def match_payee(self, details: str) -> PayeeMatch:
        """Map a free-text bank-detail line to a known payee + category."""

    # ── Default behaviour ────────────────────────────────────────────

    def list_files(self, data_dir: Path) -> list[dict[str, str]]:
        """Return statement files in ``data/<data_subdir>/``, newest first.

        The default implementation lists every file whose suffix matches
        :attr:`file_extensions`, sorted by name descending — adequate when
        filenames carry an ISO-like date prefix (e.g. ``2026_04.xls``).
        """
        folder = data_dir / self.data_subdir
        if not folder.exists():
            return []
        files: list[dict[str, str]] = []
        for f in folder.iterdir():
            if f.suffix.lower() in self.file_extensions:
                files.append({"name": f.name, "path": str(f)})
        files.sort(key=lambda d: d["name"], reverse=True)
        return files

    def reconcile(
        self,
        filepath: str,
        existing_tx: list[dict[str, Any]],
        account: str | None = None,
    ) -> list[Suggestion]:
        """Return unmatched bank rows as :class:`Suggestion` objects.

        Standard algorithm: build a (date, amount) lookup of existing
        transactions for the target account, including ±1-day shifts to
        absorb posting-date drift, then drop every bank row that hits
        the lookup. Subclasses may override for fancier matching.
        """
        from datetime import date as dt_date, timedelta

        target_account = account or self.default_account
        rows = self.parse(filepath)

        existing_keys: set[tuple[str, float]] = set()
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
            existing_keys.add((iso, round(amt, 2)))
            try:
                d = dt_date.fromisoformat(iso)
                existing_keys.add(((d + timedelta(days=1)).isoformat(), round(amt, 2)))
                existing_keys.add(((d - timedelta(days=1)).isoformat(), round(amt, 2)))
            except ValueError:
                pass

        suggestions: list[Suggestion] = []
        for row in rows:
            key = (row.date, round(row.amount, 2))
            if key in existing_keys:
                continue
            match = self.match_payee(row.details)
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
