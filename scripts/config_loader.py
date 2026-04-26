"""Config loader for FinanceOS.

Reads JSON config files at the repo root under ``config/``:
- ``features.json``      — feature flags (boolean toggles)
- ``defaults.json``      — system-level defaults (server, backup, currency, auto-tags)
- ``smart_defaults.json``— UX-level smart defaults (display currency, etc.)

All three loaders fail-safe: missing file, missing key, or malformed JSON return
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
from functools import lru_cache
from pathlib import Path
from typing import Any

# Repo root = two levels above this file (scripts/config_loader.py → repo root).
_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
_FEATURES_PATH = _CONFIG_DIR / "features.json"
_DEFAULTS_PATH = _CONFIG_DIR / "defaults.json"
_SMART_DEFAULTS_PATH = _CONFIG_DIR / "smart_defaults.json"


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
