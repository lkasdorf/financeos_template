"""Rule layer for statement import.

Holds the two pieces of persisted knowledge the importer needs and that
``data/payees.json`` structurally cannot express: ordered pattern rules
that map a bank line onto a complete booking template, and the dismiss
list of lines the user never wants to be asked about again.

Rules live in ``config/recon_rules.json``, keyed by adapter name so a
second bank can be added without touching this module.
"""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = REPO_ROOT / "config"
DATA_DIR = REPO_ROOT / "data"
RECON_RULES_PATH = CONFIG_DIR / "recon_rules.json"
RECON_DISMISSED_PATH = DATA_DIR / "recon_dismissed.csv"

RECON_DISMISSED_COLUMNS = [
    "dismissed_id", "account", "date", "amount",
    "details_hash", "label", "reason", "created_at",
]


def load_rules(adapter: str) -> list[dict]:
    """Return the ordered rule list for one adapter.

    Missing file, unreadable JSON or an unknown adapter key all yield an
    empty list: a broken rule file must degrade to "ask about everything",
    never to a wrong auto-booking.
    """
    try:
        raw = json.loads(RECON_RULES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    rules = raw.get("rules", {})
    if not isinstance(rules, dict):
        return []
    entries = rules.get(adapter, [])
    return entries if isinstance(entries, list) else []


def match_rule(details: str, rules: list[dict]) -> dict | None:
    """Return the first rule whose ``contains`` appears in ``details``.

    Matching is a case-insensitive substring test and the list order is
    semantics, not cosmetics: specific patterns must be listed before
    generic ones. The payee register learned this the hard way — generic
    entries won the longest-substring match against more specific payees
    and had to be cleaned up.
    """
    haystack = (details or "").lower()
    for rule in rules:
        needle = str(rule.get("contains", "")).strip().lower()
        if needle and needle in haystack:
            return rule
    return None


# ── Dismiss list ─────────────────────────────────────────────────────

def details_hash(details: str) -> str:
    """Stable 16-hex-char fingerprint of a bank detail string.

    The raw details carry the account number (``AC-TZS…``) and this file,
    unlike ``data/crdb_data/*``, IS tracked in git — so only the hash and
    a hand-written label are ever persisted.
    """
    return hashlib.sha256(details.strip().encode("utf-8")).hexdigest()[:16]


def dismiss_key(account: str, date: str, amount: float, details: str) -> tuple[str, str, str, str]:
    """Lookup key for the dismiss list.

    The amount is formatted to two decimals so float noise from the XLS
    parser cannot produce two keys for the same line.
    """
    return (account, date, f"{float(amount):.2f}", details_hash(details))


def load_dismissed() -> set[tuple[str, str, str, str]]:
    """Return dismiss keys as a set. Missing file yields an empty set."""
    if not RECON_DISMISSED_PATH.exists():
        return set()
    out: set[tuple[str, str, str, str]] = set()
    with RECON_DISMISSED_PATH.open("r", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                amount = f"{float(row.get('amount') or 0):.2f}"
            except ValueError:
                continue
            out.add((row.get("account", ""), row.get("date", ""),
                     amount, row.get("details_hash", "")))
    return out


def add_dismissed(account: str, date: str, amount: float, details: str,
                  label: str, reason: str) -> str:
    """Append one dismiss entry and return its id.

    Appends rather than rewrites, so a concurrent reader never sees a
    truncated file. The header is written if the file does not exist yet.
    """
    key = dismiss_key(account, date, amount, details)
    new_id = f"dis-{key[3]}"
    exists = RECON_DISMISSED_PATH.exists()
    RECON_DISMISSED_PATH.parent.mkdir(parents=True, exist_ok=True)
    with RECON_DISMISSED_PATH.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if not exists:
            writer.writerow(RECON_DISMISSED_COLUMNS)
        writer.writerow([
            new_id, account, date, f"{float(amount):.2f}",
            key[3], label, reason, datetime.now().isoformat(timespec="seconds"),
        ])
    return new_id
