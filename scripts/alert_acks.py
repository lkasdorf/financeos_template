"""Acknowledgement store for derived alerts.

Most alerts in the Alerts tab are recomputed from scratch on every
render and carry no state — an overdue scheduled TX disappears once it
is booked, a kWh spike once the next month evens out. Two of them have
no such natural end: a subscription price jump and a LUKU price/kWh
anomaly stay up until the *following* charge lands, which can be a
month later. They describe an observation, not a to-do, so the user
needs a way to say "seen it".

The fingerprint is what keeps that honest. An ack is stored against the
concrete observation (which subscription, which charge date, which
amount) rather than against the alert type, so acknowledging the August
jump cannot silence a second jump in September — that one hashes to a
different key and alerts again.

Append-only, like the reconciliation dismiss list: a concurrent reader
never sees a truncated file, and there is no rewrite path that could
lose earlier acks.
"""

from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
ALERT_ACKS_PATH = DATA_DIR / "alert_acks.csv"

ALERT_ACK_COLUMNS = ["ack_key", "alert_type", "acked_at"]


def ack_key(kind: str, *parts: object) -> str:
    """Build the fingerprint of one concrete alert observation.

    ``kind`` is a short producer-owned prefix (``sub_drift``,
    ``luku_price``); the parts identify the observation itself. Callers
    pass amounts pre-formatted to two decimals so float noise cannot
    produce two keys for the same charge.
    """
    tail = ":".join(str(p).strip() for p in parts)
    return f"{kind}:{tail}"


def load_acks() -> set[str]:
    """Return all acknowledged fingerprints. Missing file yields an
    empty set — an unreadable store must degrade to "show everything",
    never to "hide everything"."""
    if not ALERT_ACKS_PATH.exists():
        return set()
    out: set[str] = set()
    with ALERT_ACKS_PATH.open("r", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = (row.get("ack_key") or "").strip()
            if key:
                out.add(key)
    return out


def add_ack(key: str, alert_type: str) -> bool:
    """Record one acknowledgement. Returns True if it was new.

    Re-acking an already-stored key is a no-op rather than an error:
    the dashboard may retry the POST after a flaky response, and a
    duplicate row would only bloat the file.
    """
    key = (key or "").strip()
    if not key or key in load_acks():
        return False
    ensure_store()
    with ALERT_ACKS_PATH.open("a", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow([
            key, alert_type,
            datetime.now().isoformat(timespec="seconds"),
        ])
    return True


def filter_acked(alerts: list[dict]) -> list[dict]:
    """Drop alerts whose fingerprint has been acknowledged.

    Alerts without an ``ack_key`` pass through untouched — a missing
    key means "this type cannot be acked", never "already acked".
    """
    acked = load_acks()
    if not acked:
        return alerts
    return [a for a in alerts if (a.get("ack_key") or "") not in acked]


def ensure_store() -> None:
    """Create the store with its header if it does not exist yet."""
    if ALERT_ACKS_PATH.exists():
        return
    ALERT_ACKS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with ALERT_ACKS_PATH.open("w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(ALERT_ACK_COLUMNS)
