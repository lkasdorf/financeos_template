#!/usr/bin/env python3
"""One-shot backfill: roll each subscription's next_renewal from its newest
linked charge.

Why this exists: the roll-on-link hooks (v2026-07-12.1) only fire when a
charge gets linked from now on. Charges linked BEFORE the hooks existed
never rolled the date, so next_renewal sat stale for months. The daily
cron fallback would catch up calendar-wise from the stale date, but that
can land a cycle off from the real billing anchor (e.g. a sub whose stale
date is the 18th while the provider actually bills on the 9th). Rolling
from the newest linked charge restores the true anchor in one pass.

Monotonic by construction (rolled_renewal_after_charge only moves dates
forward), so re-running is a no-op. Subscriptions without any linked
charge are left to the cron's calendar fallback. Only OVERDUE dates are
touched: a next_renewal already in the future is treated as deliberate
manual data (owner decision 2026-07-12 — Google One's 2027-01-17 stays).

Usage:
    python scripts/renewal_backfill.py --dry   # preview only
    python scripts/renewal_backfill.py         # apply + git commit
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import tx_engine
import subscriptions


def main(argv: list[str]) -> int:
    dry = "--dry" in argv

    subs = subscriptions.load_subscriptions()
    log = subscriptions.load_subscription_log()

    # Newest linked charge date per subscription (ISO strings compare fine).
    newest: dict[str, str] = {}
    for row in log:
        sid = (row.get("subscription_id") or "").strip()
        d = (row.get("date") or "").strip()
        if sid and d and d > newest.get(sid, ""):
            newest[sid] = d

    today_iso = date.today().isoformat()
    changed: list[tuple[str, str, str, str]] = []
    for sid, sub in subs.items():
        charge = newest.get(sid)
        if not charge:
            continue
        current = (sub.get("next_renewal") or "").strip()
        # Future dates are deliberate manual data — only fix stale/overdue ones.
        if current and current >= today_iso:
            continue
        new_date = subscriptions.rolled_renewal_after_charge(sub, charge)
        if new_date:
            changed.append((sid, current, new_date, charge))

    if not changed:
        print("Nothing to roll — every next_renewal is already at or past its newest charge.")
        return 0

    for sid, old, new, charge in changed:
        prefix = "[DRY] " if dry else ""
        print(f"{prefix}{sid}: {old or '(empty)'} -> {new}  (newest linked charge {charge})")

    if dry:
        return 0

    # Same discipline as the cron roll: serialize the read-modify-write
    # against concurrent bookings; one save = one backup for the batch.
    with tx_engine.tx_write_lock():
        subs = subscriptions.load_subscriptions()
        applied = 0
        for sid, _old, _new, charge in changed:
            sub = subs.get(sid)
            if not sub:
                continue
            new_date = subscriptions.rolled_renewal_after_charge(sub, charge)
            if new_date:
                sub["next_renewal"] = new_date
                applied += 1
        if applied:
            subscriptions.save_subscriptions(subs)

    ok = tx_engine.git_commit(
        f"Subscriptions: renewal backfill from linked charges ({applied})",
        files=["data/subscriptions.csv"],
    )
    print(f"Applied {applied} roll(s); git commit {'ok' if ok else 'FAILED'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
