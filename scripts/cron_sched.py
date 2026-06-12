#!/usr/bin/env python3
"""Cron job: Execute due scheduled (recurring) transactions.

This script runs daily via cron on the Raspberry Pi. It checks
data/scheduled.csv for entries where active=true AND next_run <= today,
writes them as real transactions to transactions.csv, generates
pass-through counter-entries where applicable, and rolls each entry's
next_run date forward to the next occurrence.

Typical cron entry (Pi):
    0 6 * * * cd /srv/financeos && python scripts/cron_sched.py >> logs/cron_sched.log 2>&1

Safety features:
    - Backs up both transactions.csv and scheduled.csv before writing
    - Validates all generated lines before appending
    - Single atomic git commit for all changes
    - --dry flag for preview without side effects

Usage:
    python scripts/cron_sched.py          # Execute all due scheduled TXs
    python scripts/cron_sched.py --dry    # Preview only, no writes
"""

from __future__ import annotations

import calendar
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Ensure sibling modules (tx_engine, backup) are importable
sys.path.insert(0, str(Path(__file__).parent))

import tx_engine
from backup import backup_file, BACKUP_TARGETS

# ── Frequency Parsing ───────────────────────────────────────────────────────

# Maps weekday names/abbreviations to Python's weekday numbers (0=Monday)
WEEKDAY_MAP = {
    "mon": 0, "monday": 0,
    "tue": 1, "tuesday": 1,
    "wed": 2, "wednesday": 2,
    "thu": 3, "thursday": 3,
    "fri": 4, "friday": 4,
    "sat": 5, "saturday": 5,
    "sun": 6, "sunday": 6,
}


def _parse_md(spec: str) -> tuple[int, int]:
    """Parse an `MM-DD` token, raising ValueError on malformed input.

    Used by yearly:/quarterly: where the spec encodes both the anchor
    month and the day-of-month. Day capping for short months happens
    later, when we know which calendar month the next run lands in.
    """
    parts = spec.split("-")
    if len(parts) != 2:
        raise ValueError(f"expected MM-DD, got {spec!r}")
    month, day = int(parts[0]), int(parts[1])
    if not (1 <= month <= 12):
        raise ValueError(f"month out of range: {month}")
    if not (1 <= day <= 31):
        raise ValueError(f"day out of range: {day}")
    return month, day


def calculate_next_run(frequency: str, from_date: date) -> date:
    """Calculate the next run date based on frequency string.

    Supported formats:
      monthly:<day>     — day 1-31 or 'last' for last day of month
      weekly:<weekday>  — mon/tue/wed/thu/fri/sat/sun
      yearly:MM-DD      — once a year on MM-DD (e.g. yearly:09-15)
      quarterly:MM-DD   — every 3 months on day DD; MM anchors the
                          quarter set (e.g. quarterly:03-15 fires on
                          Mar/Jun/Sep/Dec, quarterly:01-01 on
                          Jan/Apr/Jul/Oct). Day capped per month length
                          (e.g. quarterly:03-31 → Mar 31, Jun 30, Sep 30,
                          Dec 31).
    """
    if frequency.startswith("weekly:"):
        day_name = frequency.split(":", 1)[1].strip().lower()
        target_weekday = WEEKDAY_MAP.get(day_name)
        if target_weekday is None:
            raise ValueError(f"Unknown weekday: {day_name}")
        days_ahead = (target_weekday - from_date.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7  # Always advance to NEXT week, never fire same day again
        return from_date + timedelta(days=days_ahead)

    if frequency.startswith("yearly:"):
        target_month, target_day = _parse_md(frequency.split(":", 1)[1].strip())
        # Try this calendar year first; if the target has already passed
        # (or is today), roll over to next year. Day capped to month
        # length so yearly:02-29 in a non-leap year lands on Feb 28.
        for year in (from_date.year, from_date.year + 1):
            last_day = calendar.monthrange(year, target_month)[1]
            candidate = date(year, target_month, min(target_day, last_day))
            if candidate > from_date:
                return candidate
        # Unreachable in practice (year+1 always strictly after from_date).
        raise RuntimeError(f"yearly: could not advance past {from_date}")

    if frequency.startswith("quarterly:"):
        anchor_month, target_day = _parse_md(frequency.split(":", 1)[1].strip())
        # MM anchors the set of 4 months that share the same offset
        # within a quarter. Sort so we walk forward chronologically when
        # searching for the next candidate strictly after from_date.
        anchor_months = sorted(
            {((anchor_month - 1 + 3 * k) % 12) + 1 for k in range(4)}
        )
        for year in (from_date.year, from_date.year + 1):
            for month in anchor_months:
                last_day = calendar.monthrange(year, month)[1]
                candidate = date(year, month, min(target_day, last_day))
                if candidate > from_date:
                    return candidate
        raise RuntimeError(f"quarterly: could not advance past {from_date}")

    if not frequency.startswith("monthly:"):
        raise ValueError(f"Unsupported frequency: {frequency}")

    day_spec = frequency.split(":", 1)[1].strip()

    # Advance to next month (handle December -> January year rollover)
    if from_date.month == 12:
        next_month = 1
        next_year = from_date.year + 1
    else:
        next_month = from_date.month + 1
        next_year = from_date.year

    last_day = calendar.monthrange(next_year, next_month)[1]

    if day_spec == "last":
        # "last" = always the last day of the month (28/29/30/31)
        return date(next_year, next_month, last_day)
    else:
        day = int(day_spec)
        # Cap to actual month length (e.g. day=31 in February -> day=28)
        day = min(day, last_day)
        return date(next_year, next_month, day)


def advance_next_run(frequency: str, old_due: date, today: date) -> date:
    """Return the first occurrence of ``frequency`` strictly after ``today``,
    iterating from the entry's OLD due date (O-M1, CODE_REVIEW_2026-06-12).

    Anchoring on today instead used to skip a cycle across month
    boundaries: ``monthly:15`` due Jun 15 but fired Jul 1 advanced
    straight to Aug 15 — Jul 15 was silently lost. Iterating from the
    due date lands on Jul 15. The cap mirrors _missed_periods so a
    malformed frequency cannot loop forever.
    """
    nxt = old_due
    for _ in range(120):
        nxt = calculate_next_run(frequency, nxt)
        if nxt > today:
            break
    return nxt


def _missed_periods(frequency: str, last_due: date, today: date) -> int:
    """Return the number of full periods skipped between ``last_due``
    and ``today`` because cron only fires once per due-entry.

    Used by ``_filter_due`` to surface multi-month Pi downtime (M-B7,
    Sprint 17). 0 means at most one fire would have produced the
    expected sequence; >0 means N intermediate periods got silently
    skipped — operator must decide whether to backfill manually.

    Defensive: returns 0 on any frequency-parse error so a single bad
    row can't blow up the whole _filter_due pass.
    """
    try:
        count = 0
        cur = last_due
        # Hard cap to keep a malformed frequency from looping forever.
        for _ in range(120):
            nxt = calculate_next_run(frequency, cur)
            if nxt > today:
                break
            count += 1
            cur = nxt
        return count
    except (ValueError, RuntimeError):
        return 0


def _filter_due(scheduled: list[dict], today: date) -> tuple[list[dict], list[str]]:
    """Return (due_entries, warnings). An entry is due when active=true AND
    next_run is a parseable ISO date <= today.

    M-B7 (Sprint 17): when next_run is multiple periods in the past
    (multi-month Pi downtime), only ONE fire happens and the missed
    intermediate periods would have been silently skipped. We now
    surface the missed count as a warning so the operator can decide
    whether to manually backfill or accept the gap.
    """
    due: list[dict] = []
    warnings: list[str] = []
    for entry in scheduled:
        if entry.get("active", "").lower() != "true":
            continue
        next_run = entry.get("next_run", "").strip()
        if not next_run:
            continue
        try:
            run_date = date.fromisoformat(next_run)
        except ValueError:
            warnings.append(f"Invalid next_run date for {entry.get('sched_id', '?')}: {next_run}")
            continue
        if run_date <= today:
            due.append(entry)
            # M-B7 — measure how many cycles got skipped past run_date.
            # _missed_periods counts strict-future iterations from
            # run_date itself, so a one-period overdue returns 0 (only
            # one fire was due) and the warning only triggers on real
            # gaps of two or more periods.
            missed = _missed_periods(entry.get("frequency", ""), run_date, today)
            if missed > 0:
                warnings.append(
                    f"{entry.get('sched_id', '?')}: next_run was {next_run} and "
                    f"{missed} intermediate period(s) would have fired between then "
                    f"and {today.isoformat()} — only one TX is being booked now. "
                    f"Manually backfill the missed periods if needed."
                )
    return due, warnings


def _build_primary_line(entry: dict, accounts: dict, categories: dict, today: date, existing_ids: set) -> dict:
    """Build the primary TX line from a scheduled entry. Does not mutate `entry`."""
    account_alias = entry.get("account", "")
    amount_str = entry.get("amount", "0")
    currency = entry.get("currency", "")
    payee = entry.get("payee", "")
    category = entry.get("category", "")
    note = entry.get("note", "")

    if not currency and account_alias in accounts:
        currency = accounts[account_alias]["currency"]

    manual_tags = [t.strip() for t in entry.get("manual_tags", "").split(";") if t.strip()]
    # Optional property link: mirror forms-add-tx.js Property-Picker behavior.
    # The property_id itself is never stored on transactions.csv — only the
    # resolved cost_tag is appended, then apply_auto_tags merges it with
    # account/payee/category rules and bridge tags.
    property_id = (entry.get("property_id") or "").strip()
    if property_id:
        cost_tag = tx_engine._resolve_property_cost_tag(property_id)
        if cost_tag and cost_tag not in manual_tags:
            manual_tags.append(cost_tag)
    all_tags = tx_engine.apply_auto_tags(account_alias, payee, manual_tags, category)

    cat_info = categories.get(category, {})
    tx_type = cat_info.get("type", "expense")
    if tx_type not in ("income", "expense"):
        tx_type = "expense"

    line = {
        "date": today.isoformat(),
        "account": account_alias,
        "type": tx_type,
        "amount": amount_str,
        "currency": currency,
        "payee": payee,
        "category": category,
        "note": note,
        "raw_note": "",
        "transfer_to_account": "",
        "transfer_to_amount": "",
        "receipt_group": "",
        "receipt_url": "",
        "tags": ";".join(all_tags),
        "third_party_id": "",
        # v1.5.1: optional subscription link carried in-memory only. Not a TX
        # column — run_due() mirrors this into subscription_log.csv after the
        # TX is appended. Pass-through reimbursement lines deliberately skip
        # this (see generate_pass_through_line — it never copies the field).
        "subscription_id": entry.get("subscription_id", ""),
    }
    line["import_id"] = tx_engine.generate_import_id(
        line["date"], line["account"], float(line["amount"]),
        line["payee"], line["category"], line["note"], existing_ids,
    )
    return line


def build_preview(today: date | None = None) -> dict:
    """Return a JSON-serializable preview of what would be booked today.

    Used by the dashboard's "Run due scheduled" widget to render the
    confirmation modal. Does not write anything and does not mutate
    `scheduled.csv`. Each entry includes an optional `pass_through`
    counter-line if the account is pass-through and the entry is an expense.
    """
    today = today or date.today()
    scheduled = tx_engine.load_scheduled()
    accounts = tx_engine.load_accounts()
    categories = tx_engine.load_categories()
    existing_ids = tx_engine.load_existing_import_ids()

    due, warnings = _filter_due(scheduled, today)
    entries_out: list[dict] = []
    for entry in due:
        # Use a working copy of existing_ids so preview-side import_ids do not
        # poison subsequent run_due() calls or leak across preview/run boundaries.
        scratch_ids = set(existing_ids)
        primary = _build_primary_line(entry, accounts, categories, today, scratch_ids)
        scratch_ids.add(primary["import_id"])
        pt_line: dict | None = None
        acc_info = accounts.get(entry.get("account", ""), {})
        if acc_info.get("pass_through_payee") and primary["type"] == "expense":
            pt_line = tx_engine.generate_pass_through_line(primary, acc_info, scratch_ids)
            if pt_line:
                pt_line.pop("is_auto_generated", None)
        try:
            next_after = calculate_next_run(entry.get("frequency", ""), today).isoformat()
        except ValueError as e:
            warnings.append(f"Could not calculate next_run for {entry.get('sched_id', '?')}: {e}")
            next_after = (today + timedelta(days=30)).isoformat()
        entries_out.append({
            "sched_id": entry.get("sched_id", ""),
            "name": entry.get("name", ""),
            "frequency": entry.get("frequency", ""),
            "current_next_run": entry.get("next_run", ""),
            "next_run_after": next_after,
            "primary": primary,
            "pass_through": pt_line,
            # v1.5.1: surface the linked subscription_id so the dashboard
            # preview can render a badge next to the entry. Empty when no link.
            "subscription_id": entry.get("subscription_id", ""),
        })
    return {
        "today": today.isoformat(),
        "due_count": len(entries_out),
        "entries": entries_out,
        "warnings": warnings,
    }


def run_due(today: date | None = None, *, selected_ids: list[str] | None = None,
            source: str = "cron") -> dict:
    """Book due scheduled entries, optionally filtered to `selected_ids`.

    Performs the full atomic flow: backup → append_transactions → save_scheduled
    → git_commit. Returns a JSON-serializable summary. The dashboard widget
    passes `selected_ids` (the user's checkbox selection) and `source="dashboard"`
    so the resulting commit message distinguishes UI runs from cron runs.

    Idempotency: if `selected_ids` references entries that are no longer due
    (e.g. the cron already fired between preview and run), they are silently
    filtered out and reported in `skipped_ids`.
    """
    today = today or date.today()
    scheduled = tx_engine.load_scheduled()
    accounts = tx_engine.load_accounts()
    categories = tx_engine.load_categories()

    due, warnings = _filter_due(scheduled, today)
    if selected_ids is not None:
        sel = set(selected_ids)
        skipped_ids = [sid for sid in selected_ids if not any(e.get("sched_id") == sid for e in due)]
        due = [e for e in due if e.get("sched_id", "") in sel]
    else:
        skipped_ids = []

    def _empty_result() -> dict:
        return {
            "today": today.isoformat(),
            "booked": 0,
            "tx_ids": [],
            "skipped_ids": skipped_ids,
            "commit_ok": True,
            "commit_msg": "",
            "warnings": warnings,
        }

    if not due:
        return _empty_result()

    all_tx_lines: list[dict] = []
    summaries: list[str] = []
    sub_log_written: list[str] = []

    # H-19 (Sprint 10): hold tx_write_lock across the full cascade
    # (append_transactions → save_scheduled → subscription_log append)
    # so a concurrent dashboard delete between the TX append and the
    # subscription_log append can't leave orphan log rows referencing a
    # since-removed import_id. The lock is reentrant (C-02) so nested
    # acquires from append_transactions / save_scheduled are fine.
    with tx_engine.tx_write_lock():
        # O-M2 (CODE_REVIEW_2026-06-12): the pre-lock due check above is
        # advisory — the 06:00 cron tick and a dashboard "Run due" click
        # landing concurrently both saw the same entries as due, and the
        # lock only serialized the WRITES, not the decision. Reload and
        # re-filter under the lock; only entries still due get booked,
        # and the reloaded list is what save_scheduled() persists.
        scheduled = tx_engine.load_scheduled()
        recheck, _ = _filter_due(scheduled, today)
        still_due = {e.get("sched_id", "") for e in recheck}
        fired_concurrently = [
            e.get("sched_id", "") for e in due
            if e.get("sched_id", "") not in still_due
        ]
        if fired_concurrently:
            skipped_ids.extend(fired_concurrently)
            warnings.append(
                "skipped (fired concurrently): " + ", ".join(fired_concurrently))
        sel_ids = {e.get("sched_id", "") for e in due}
        due = [e for e in recheck if e.get("sched_id", "") in sel_ids]
        if not due:
            return _empty_result()

        # v1.5.1: detect subscription-linked entries up-front so
        # subscription_log is backed up before any write touches it.
        # B-L6: backups now run UNDER the lock so the snapshot is
        # guaranteed to reflect the pre-write state.
        has_sub_links = any((e.get("subscription_id") or "").strip() for e in due)
        backup_file("transactions", BACKUP_TARGETS["transactions"])
        backup_file("scheduled", BACKUP_TARGETS["scheduled"])
        if has_sub_links:
            backup_file("subscription_log", BACKUP_TARGETS["subscription_log"])

        existing_ids = tx_engine.load_existing_import_ids()
        for entry in due:
            primary = _build_primary_line(entry, accounts, categories, today, existing_ids)
            existing_ids.add(primary["import_id"])
            all_tx_lines.append(primary)

            acc_info = accounts.get(entry.get("account", ""), {})
            if acc_info.get("pass_through_payee") and primary["type"] == "expense":
                pt_line = tx_engine.generate_pass_through_line(primary, acc_info, existing_ids)
                if pt_line:
                    existing_ids.add(pt_line["import_id"])
                    pt_line.pop("is_auto_generated", None)
                    all_tx_lines.append(pt_line)

            summaries.append(f"{entry.get('name', '?')} ({entry.get('payee', '?')})")

            # O-M1 (CODE_REVIEW_2026-06-12): anchor the advancement on the
            # entry's DUE date, not on today — see advance_next_run().
            try:
                old_due = date.fromisoformat((entry.get("next_run") or "").strip())
            except ValueError:
                old_due = today
            entry["last_run"] = today.isoformat()
            try:
                entry["next_run"] = advance_next_run(
                    entry.get("frequency", ""), old_due, today).isoformat()
            except (ValueError, RuntimeError) as e:
                warnings.append(f"Could not calculate next_run for {entry.get('sched_id', '?')}: {e}")
                entry["next_run"] = (today + timedelta(days=30)).isoformat()

        tx_engine.append_transactions(all_tx_lines)
        tx_engine.save_scheduled(scheduled)

        # v1.5.1: mirror SCHED-linked primary lines into subscription_log. Mirrors
        # the post-append pattern in serve.handle_tx_confirm so the Subscriptions
        # page picks up SCHED-fired charges without manual re-linking. Pass-through
        # reimbursement lines never carry subscription_id (generate_pass_through_line
        # does not copy the field), so iterating all_tx_lines is safe.
        if has_sub_links:
            import subscriptions  # local import: cron may run without dashboard libs preloaded
            for line in all_tx_lines:
                sid = (line.get("subscription_id") or "").strip()
                if not sid:
                    continue
                try:
                    log_id = subscriptions.append_subscription_log({
                        "date": line.get("date", ""),
                        "subscription_id": sid,
                        "amount": line.get("amount", ""),
                        "currency": line.get("currency", ""),
                        "account": line.get("account", ""),
                        "tx_import_id": line.get("import_id", ""),
                        "note": "",
                    })
                    sub_log_written.append(log_id)
                except Exception as exc:
                    # Same trade-off as serve.handle_tx_confirm: log-link failures
                    # do NOT roll back the TX. User can re-link via Edit-TX modal.
                    warnings.append(
                        f"subscription_log link failed for "
                        f"{line.get('import_id', '')}: {exc}"
                    )

    n_booked = len(due)
    summary_str = ", ".join(summaries[:5])
    if len(summaries) > 5:
        summary_str += f" +{len(summaries) - 5} more"
    commit_msg = f"SCHED {source}: {n_booked} Buchungen ({summary_str})"

    # Cron path forces sync git commit+push so push-fails surface as non-zero
    # exit codes; the dashboard path stays async (default) for snappy UX.
    if source == "cron":
        os.environ["GIT_COMMIT_SYNC"] = "1"
    commit_files = ["data/transactions.csv", "data/scheduled.csv"]
    if sub_log_written:
        commit_files.append("data/subscription_log.csv")
    commit_ok = tx_engine.git_commit(commit_msg, files=commit_files)

    return {
        "today": today.isoformat(),
        "booked": n_booked,
        "tx_ids": [l["import_id"] for l in all_tx_lines],
        "skipped_ids": skipped_ids,
        "commit_ok": bool(commit_ok),
        "commit_msg": commit_msg,
        "warnings": warnings,
        # v1.5.1: surface how many subscription_log links the run produced.
        # Empty list when no SCHED entry was subscription-linked.
        "linked_sub_logs": sub_log_written,
    }


def main() -> int:
    """Thin CLI wrapper. Honours --dry for preview-only.

    Returns 0 on success (including 'nothing due'), 1 if TXs were written but
    git_commit failed, 2 on unhandled exception (caught by the __main__ wrapper).
    """
    dry_run = "--dry" in sys.argv
    now = datetime.now()
    today = date.today()
    ts = now.strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] cron_sched: checking for due scheduled transactions...")

    if dry_run:
        preview = build_preview(today)
        for w in preview["warnings"]:
            print(f"  [warn] {w}")
        if preview["due_count"] == 0:
            print(f"  No scheduled transactions due today ({today.isoformat()}).")
            return 0
        print(f"  Found {preview['due_count']} due entry/entries.")
        print("  [DRY RUN] Would execute:")
        for e in preview["entries"]:
            p = e["primary"]
            print(f"    {e['sched_id']}: {e['name']} — {p['amount']} {p['currency']} to {p['payee']}")
        return 0

    # O-H3 (CODE_REVIEW_2026-06-12): a fenced standby must not book
    # scheduled TX — that's the double-booking half of the dual-primary
    # hazard. The role file covers the normal case; the origin refresh
    # additionally catches a just-rebooted ex-primary whose first
    # cron_commit tick hasn't propagated the demotion yet (this script
    # books money, so the extra fetch is worth it).
    import host_role
    if host_role.is_standby():
        print("  host role is standby — fenced, not booking (O-H3)")
        return 0
    if host_role.my_host_type():
        host_role.fetch_origin()
        if host_role.demote_if_peer_primary(log_prefix="cron_sched"):
            print("  self-pacified to standby — not booking (O-H3)")
            return 0

    summary = run_due(today, source="cron")
    for w in summary["warnings"]:
        print(f"  [warn] {w}")
    if summary["booked"] == 0:
        print(f"  No scheduled transactions due today ({today.isoformat()}).")
        return 0
    print(f"  Executed {summary['booked']} scheduled transaction(s):")
    for tx_id in summary["tx_ids"]:
        print(f"    Booked: {tx_id}")
    if summary["commit_ok"]:
        print(f"  Committed: {summary['commit_msg']}")
        return 0
    print(f"  [error] git_commit returned False — TXs appended but not pushed.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] cron_sched ERROR: {e}", file=sys.stderr)
        sys.exit(2)
