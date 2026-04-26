"""Bank-statement reconciliation adapter registry.

Block D of the OSS-template roadmap. Adapters live in this package
and register themselves via :data:`ADAPTERS`. Callers route through
:func:`get_adapter` (by adapter name) or :func:`get_adapter_for_account`
(by account alias, using ``config/reconciliation.json``).

Adding a new adapter:
    1. Create ``scripts/reconciliation/<name>.py`` with a subclass of
       :class:`BankAdapter`.
    2. Append it to the ``ADAPTERS`` tuple below.
    3. Map the relevant account aliases in ``config/reconciliation.json``.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .base import BankAdapter, BankRow, PayeeMatch, Suggestion
from .crdb_tz import CrdbTzAdapter
from .csv_generic import CsvGenericAdapter

__all__ = [
    "BankAdapter",
    "BankRow",
    "PayeeMatch",
    "Suggestion",
    "ADAPTERS",
    "get_adapter",
    "get_adapter_for_account",
    "list_adapters",
    "load_recon_config",
]

# All built-in adapters. Community adapters can be appended here.
ADAPTERS: tuple[BankAdapter, ...] = (
    CrdbTzAdapter(),
    CsvGenericAdapter(),
)

_ADAPTER_INDEX: dict[str, BankAdapter] = {a.name: a for a in ADAPTERS}

# Path to the per-account adapter mapping.
_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "reconciliation.json"


@lru_cache(maxsize=1)
def load_recon_config() -> dict:
    """Load ``config/reconciliation.json`` with a safe fallback.

    Shape::

        {
          "default_adapter": "csv_generic",
          "account_adapters": {"crdb": "crdb_tz"}
        }
    """
    try:
        with _CONFIG_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    # Conservative fallback so the dashboard keeps working even without
    # the config file: route 'crdb' to the CRDB adapter, everything else
    # to the generic CSV adapter.
    return {
        "default_adapter": "csv_generic",
        "account_adapters": {"crdb": "crdb_tz"},
    }


def get_adapter(name: str) -> BankAdapter | None:
    """Return the adapter registered under ``name``, or ``None``."""
    return _ADAPTER_INDEX.get(name)


def get_adapter_for_account(account: str) -> BankAdapter:
    """Resolve the right adapter for a given account alias.

    Falls back to the configured default adapter, and then to the
    first registered adapter, so this never raises.
    """
    cfg = load_recon_config()
    name = cfg.get("account_adapters", {}).get(account)
    if name and name in _ADAPTER_INDEX:
        return _ADAPTER_INDEX[name]
    default_name = cfg.get("default_adapter", "")
    if default_name in _ADAPTER_INDEX:
        return _ADAPTER_INDEX[default_name]
    return ADAPTERS[0]


def list_adapters() -> list[dict[str, object]]:
    """Return UI-friendly metadata for every registered adapter."""
    return [
        {
            "name": a.name,
            "display_name": a.display_name,
            "file_extensions": list(a.file_extensions),
            "data_subdir": a.data_subdir,
            "default_account": a.default_account,
            "default_currency": a.default_currency,
        }
        for a in ADAPTERS
    ]
