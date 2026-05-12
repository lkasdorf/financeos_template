"""Config loader for FinanceOS.

Reads JSON config files at the repo root under ``config/``:
- ``features.json``       — feature flags (boolean toggles)
- ``defaults.json``       — system-level defaults (server, backup, currency, auto-tags)
- ``smart_defaults.json`` — UX-level smart defaults (display currency, etc.)
- ``reports.json``        — category mappings for the 8 category-driven reports

All loaders fail-safe: missing file, missing key, or malformed JSON return
the caller-supplied fallback. The private repo therefore keeps running with
hardcoded fallbacks even if a config file is removed.

Usage:
    from config_loader import is_enabled, get_default, get_smart_default

    if not is_enabled("metals"):
        return

    port = get_default("server.default_port", 8080)
    auto_tags = get_default("auto_tag.by_account", {})
    primary = get_smart_default("ui.default_display_currency", "TZS")
"""
from __future__ import annotations

import json
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any

# Repo root = two levels above this file (scripts/config_loader.py → repo root).
_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
_FEATURES_PATH = _CONFIG_DIR / "features.json"
_DEFAULTS_PATH = _CONFIG_DIR / "defaults.json"
_SMART_DEFAULTS_PATH = _CONFIG_DIR / "smart_defaults.json"
_REPORTS_PATH = _CONFIG_DIR / "reports.json"


def _load_json(path: Path) -> dict:
    """Load a JSON file, returning {} on any I/O or parse error."""
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _dot_lookup(data: dict, path: str, fallback: Any) -> Any:
    """Walk a dotted key path through nested dicts. Return fallback if any step misses."""
    cur: Any = data
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return fallback
    return cur


@lru_cache(maxsize=1)
def get_features() -> dict:
    """Return the feature-flag map. Empty dict if file is missing or invalid."""
    raw = _load_json(_FEATURES_PATH)
    return {k: bool(v) for k, v in raw.items()}


def is_enabled(feature: str) -> bool:
    """True unless the flag is explicitly set to false. Unknown keys default to enabled."""
    return get_features().get(feature, True)


@lru_cache(maxsize=1)
def get_defaults() -> dict:
    """Return the system-defaults map. Empty dict if file is missing or invalid."""
    return _load_json(_DEFAULTS_PATH)


def get_default(path: str, fallback: Any = None) -> Any:
    """Read a value from defaults.json by dotted path (e.g. 'server.default_port').

    Returns the caller-supplied fallback if the file, branch, or key is missing.
    """
    return _dot_lookup(get_defaults(), path, fallback)


@lru_cache(maxsize=1)
def get_smart_defaults() -> dict:
    """Return the smart-defaults (UX) map. Empty dict if file is missing or invalid."""
    return _load_json(_SMART_DEFAULTS_PATH)


def get_smart_default(path: str, fallback: Any = None) -> Any:
    """Read a value from smart_defaults.json by dotted path (e.g. 'ui.default_display_currency').

    Returns the caller-supplied fallback if the file, branch, or key is missing.
    """
    return _dot_lookup(get_smart_defaults(), path, fallback)


# ── Reports config (category mappings) ──────────────────────────────────────

# Hardcoded fallback if config/reports.json is absent. Kept in sync with
# dashboard/core.js window.REPORTS_CONFIG defaults so server-side and
# client-side behavior match when no config file is present.
_REPORTS_FALLBACK: dict = {
    "dining_out":    {"categories": ["Food:Dining out"]},
    "ai_costs":      {"match": "prefix", "categories": ["Subscriptions:AI"]},
    "vice_spending": {"categories": ["Leisure:Alcohol", "Leisure:Smoking", "Leisure:Vaping"]},
    "bank_fees":     {"match": "prefix", "categories": ["Fees:"]},
    "cash_discrepancy": {
        "expense_categories": ["Other Expenses:Cash Discrepancy"],
        "income_categories":  ["Income:Cash Discrepancy"],
    },
    "bills": {
        "buckets": {
            "rent":        {"categories": ["Bills:Rent"]},
            "electricity": {"categories": ["Bills:Electricity"]},
            "water":       {"categories": ["Bills:Water"]},
            "internet":    {"categories": ["Bills:Internet"]},
        },
    },
    "automobile": {
        "buckets": {
            "purchase":     {"categories": ["Automobile:Purchase"]},
            "petrol":       {"categories": ["Automobile:Petrol"]},
            "maintenance":  {"categories": ["Automobile:Maintenance"]},
            "toll":         {"categories": ["Automobile:Toll"]},
            "parking":      {"categories": ["Automobile:Parking"]},
            "insurance":    {"categories": ["Automobile:Insurance"]},
            "registration": {"categories": ["Automobile:Registration"]},
            "accessories":  {"categories": ["Automobile:Accessories"]},
            "car_rental":   {"categories": ["Automobile:Car Rental"]},
            "other":        {"categories": ["Automobile"]},
        },
    },
    "discretionary_fixed": {
        "fixed_prefixes": ["Rent", "Bills:", "Subscriptions:", "Insurance:", "Fees:"],
    },
    "income_sources": {
        "buckets": {
            "salary":            {"categories": []},
            "interest":          {"categories": ["Income:Interest"]},
            "dividends":         {"categories": ["Income:Dividends"]},
            "investments_sales": {"categories": ["Income:Investments", "Income:Sales"]},
            "reimbursement":     {"categories": ["Income:Reimbursement"]},
            "refunds":           {"categories": ["Income:Refund"]},
        },
    },
}


def get_reports_config() -> dict:
    """Return the reports config map merged over the hardcoded fallback.

    Cache disabled — this is hit infrequently (boot + saves) and Settings →
    Reports edits must be picked up without a server restart.
    """
    raw = _load_json(_REPORTS_PATH)
    raw.pop("_comment", None)
    merged = {k: v for k, v in _REPORTS_FALLBACK.items()}
    for k, v in raw.items():
        merged[k] = v
    return merged


def get_auto_tags_config() -> dict:
    """Return the auto-tag rule maps from defaults.json.

    Returns a dict with keys `by_account`, `by_payee`, `by_category_prefix`,
    and `bridge`. Missing keys default to empty maps so the dashboard's
    Auto-Tag Settings tab can render even on fresh installs.
    """
    cfg = get_default("auto_tag", {}) or {}
    return {
        "by_account": cfg.get("by_account", {}) or {},
        "by_payee": cfg.get("by_payee", {}) or {},
        "by_category_prefix": cfg.get("by_category_prefix", {}) or {},
        "bridge": cfg.get("bridge", {}) or {},
    }


def save_auto_tags_config(data: dict) -> None:
    """Atomically write the auto-tag block back into defaults.json.

    Preserves every other top-level key (server, smart_defaults, etc.)
    untouched. After write, clears the get_defaults() lru_cache so
    subsequent reads — including the next call to apply_auto_tags() —
    see the new rules without a server restart.

    Args:
        data: dict with the four auto-tag sub-keys. Anything outside
            the known keys is dropped to keep the file shape clean.
    """
    if not isinstance(data, dict):
        raise ValueError("auto-tag config must be a dict")
    sanitized = {
        "by_account": dict(data.get("by_account", {}) or {}),
        "by_payee": dict(data.get("by_payee", {}) or {}),
        "by_category_prefix": dict(data.get("by_category_prefix", {}) or {}),
        "bridge": {
            k: list(v or [])
            for k, v in (data.get("bridge", {}) or {}).items()
        },
    }
    # Load the existing defaults file directly (not via the cached
    # get_defaults()) so we don't accidentally drop other keys.
    existing: dict = {}
    if _DEFAULTS_PATH.exists():
        try:
            with _DEFAULTS_PATH.open("r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                existing = loaded
        except (json.JSONDecodeError, OSError):
            existing = {}
    existing["auto_tag"] = sanitized

    _CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_name = tempfile.mkstemp(
        dir=str(_DEFAULTS_PATH.parent),
        prefix=f".{_DEFAULTS_PATH.name}.",
        suffix=".tmp",
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8", newline="") as f:
            json.dump(existing, f, indent=2, ensure_ascii=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, _DEFAULTS_PATH)
    except Exception:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise
    # Invalidate the cached defaults so the next get_default() call
    # picks up the new rules immediately.
    get_defaults.cache_clear()


def save_reports_config(data: dict) -> None:
    """Atomically write the reports config to config/reports.json.

    Strips the ``_comment`` field from input and re-adds the canonical comment
    so the file stays self-documenting.
    """
    if not isinstance(data, dict):
        raise ValueError("reports config must be a dict")
    payload = {k: v for k, v in data.items() if k != "_comment"}
    payload = {
        "_comment": (
            "Maps category strings to report filters. Edit via Settings → "
            "Reports or the Setup wizard. match=exact (default) means the tx "
            "category must equal one of categories. match=prefix means "
            "tx.category.startsWith(one_of_categories). buckets are "
            "sub-groupings (e.g. Bills.electricity)."
        ),
        **payload,
    }
    _CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_name = tempfile.mkstemp(
        dir=str(_REPORTS_PATH.parent),
        prefix=f".{_REPORTS_PATH.name}.",
        suffix=".tmp",
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8", newline="") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, _REPORTS_PATH)
    except Exception:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise
