"""Classify a bank statement into auto / ask / skip buckets.

This module never writes a transaction. It reads a statement through the
existing adapter, reconciles it against transactions.csv, and sorts what
is left into three buckets so the caller can book the safe ones through
POST /api/tx/manual -> /api/tx/confirm and ask about the rest.

The ATM handling is the non-obvious part: CRDB renders one withdrawal as
exactly four lines (withdrawal, charges, government levy, VAT) that all
share a twelve-digit transaction reference, while the backend generates
those same four lines from a single transfer booking whenever (bank,
amount) hits a preset in data/atm_fees.csv. Booking them one by one would
double every fee.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import date as _date
from pathlib import Path

import recon_rules
import subscriptions

# Reference extraction moved to bank_ref (tx_engine needs it too, and
# cannot import this module — recon_import imports tx_engine). Re-exported
# here so existing callers and tests keep working unchanged.
from bank_ref import (  # noqa: E402,F401
    extract_ref_hash,
    extract_reference,
    merge_raw_note,
    transaction_reference,
)

# Tolerance when comparing the preset-derived cascade against the bank's
# own fee lines, in TZS.
CASCADE_TOLERANCE = 1.00


def group_atm(suggestions: list, rules: list[dict]) -> tuple[dict[str, dict], list]:
    """Split suggestions into ATM cascade groups and everything else.

    Returns ``(groups, rest)`` where ``groups`` maps a reference to
    ``{"withdrawal": <suggestion|None>, "fees": [<suggestion>, ...]}``.

    A row that looks like part of a cascade but carries no reference is
    pushed into ``rest``; it will end up in the ask bucket rather than
    being guessed into the wrong group.
    """
    groups: dict[str, dict] = {}
    rest: list = []
    for s in suggestions:
        rule = recon_rules.match_rule(s.bank_details, rules)
        action = (rule or {}).get("action")
        if action not in ("atm", "cascade_fee"):
            rest.append(s)
            continue
        ref = extract_reference(s.bank_details)
        if ref is None:
            rest.append(s)
            continue
        slot = groups.setdefault(ref, {"withdrawal": None, "fees": []})
        if action == "atm":
            slot["withdrawal"] = s
        else:
            slot["fees"].append(s)
    return groups, rest


def _is_active(preset: dict) -> bool:
    value = preset.get("active", True)
    return str(value).strip().lower() in ("true", "1", "yes")


def verify_cascade(amount: float, fee_rows: list, presets: list[dict],
                   bank: str = "crdb") -> tuple[str, float]:
    """Compare the preset-derived cascade against the bank's fee lines.

    Returns one of:
      ``("A", 0.0)``    preset exists and matches — book the transfer only
                        and skip the fee lines, the backend regenerates them
      ``("B", 0.0)``    no preset for this amount — the backend will not
                        expand anything, so all four lines get booked
                        individually from the statement's own figures
      ``("C", delta)``  preset exists but disagrees — booking a plain
                        transfer would expand with the WRONG amounts
    """
    preset = None
    for p in presets:
        if not _is_active(p) or str(p.get("bank", "")) != bank:
            continue
        try:
            if abs(float(p["amount"]) - float(amount)) < 0.005:
                preset = p
                break
        except (KeyError, TypeError, ValueError):
            continue
    if preset is None:
        return ("B", 0.0)

    fee_net = float(preset["fee_net"])
    levy = float(preset["levy"])
    vat = round(fee_net * float(preset["vat_rate"]), 2)
    expected = round(fee_net + levy + vat, 2)
    actual = round(sum(float(r.amount) for r in fee_rows), 2)
    delta = round(actual - expected, 2)
    if abs(delta) <= CASCADE_TOLERANCE:
        return ("A", 0.0)
    return ("C", delta)


# ── Near-miss detection ──────────────────────────────────────────────

NEAR_MISS_DAYS = 7


def _parse_iso(value: str) -> _date | None:
    try:
        y, m, d = (int(part) for part in str(value).split("-"))
        return _date(y, m, d)
    except (ValueError, TypeError):
        return None


def find_near_miss(date: str, amount: float, account: str,
                   existing_tx: list[dict], days: int = NEAR_MISS_DAYS) -> str | None:
    """Return the import_id of a same-amount transaction within +/- days.

    The adapter's own matcher only tolerates a two-day posting drift, so a
    larger shift slips through as "unmatched" and would be booked a second
    time. Anything this finds is forced into the ask bucket rather than
    silently dropped: it is a suspicion, not a match.
    """
    target = _parse_iso(date)
    if target is None:
        return None
    for row in existing_tx:
        row_date = _parse_iso(row.get("date", ""))
        if row_date is None or abs((row_date - target).days) > days:
            continue
        touches = (row.get("account") == account
                   or row.get("transfer_to_account") == account)
        if not touches:
            continue
        try:
            row_amount = float(row.get("amount") or 0)
        except ValueError:
            continue
        if abs(row_amount - float(amount)) < 0.005:
            return row.get("import_id") or None
    return None


def find_sum_match(rows: list, account: str, existing_tx: list[dict],
                   days: int = NEAR_MISS_DAYS) -> str | None:
    """Return the import_id of one ledger row equal to the group's total.

    The adapter aggregates the other direction only — one bank row against
    N ledger rows of a receipt split (backlog item R4). The reverse shape
    is just as real: the bank splits a transfer fee into 1,000 + 180 VAT
    while the ledger carries a single 1,180 row. Both bank rows then look
    unmatched, and booking them would duplicate the fee.
    """
    total = round(sum(float(r.amount) for r in rows), 2)
    dates = [d for d in (_parse_iso(r.date) for r in rows) if d is not None]
    if not dates or total <= 0:
        return None
    # Several months can carry the same fee total, so pick the candidate
    # closest in time rather than the first one encountered.
    best_id, best_distance = None, None
    for row in existing_tx:
        row_date = _parse_iso(row.get("date", ""))
        if row_date is None:
            continue
        distance = min(abs((row_date - d).days) for d in dates)
        if distance > days:
            continue
        if (row.get("account") != account
                and row.get("transfer_to_account") != account):
            continue
        try:
            row_amount = float(row.get("amount") or 0)
        except ValueError:
            continue
        if abs(row_amount - total) < 0.005:
            if best_distance is None or distance < best_distance:
                best_id, best_distance = row.get("import_id") or None, distance
    return best_id


# ── Interbank transfer groups ────────────────────────────────────────

# Every interbank transfer line carries a shared 16-hex reference, and the
# bank splits one transfer into principal + fee + VAT where VAT is exactly
# 18% of the fee. Measured over May-August 2026: 32 rows in 16 groups,
# eight of them full triples, and the VAT ratio held in all eight.
_REF_HASH_RE = re.compile(r"REF:([0-9a-f]{16})\s*(.*)", re.IGNORECASE)

# Tolerance for the VAT-to-fee ratio check, in TZS.
VAT_TOLERANCE = 0.02
VAT_RATE = 0.18


def narrative(details: str) -> str:
    """Return the human-readable part of a statement line.

    For interbank transfers that is everything after the REF hash — the
    purpose text typed at transfer time, which is a far better category
    signal than the counterparty name. For anything else it is the whole
    descriptor.
    """
    hit = _REF_HASH_RE.search(details or "")
    return (hit.group(2).strip() if hit else (details or "").strip())


def group_ref(suggestions: list) -> tuple[dict[str, list], list]:
    """Group rows sharing an interbank reference; return (groups, rest)."""
    groups: dict[str, list] = {}
    rest: list = []
    for s in suggestions:
        ref = extract_ref_hash(s.bank_details)
        if ref is None:
            rest.append(s)
        else:
            groups.setdefault(ref, []).append(s)
    return groups, rest


def split_ref_group(rows: list) -> tuple[list, list] | None:
    """Split an interbank group into (fee_rows, principal_rows).

    Returns None when the group does not look like the bank's own
    principal/fee/VAT shape, so the caller can ask instead of guessing.
    A partially booked group legitimately arrives as just the fee pair.
    """
    ordered = sorted(rows, key=lambda r: float(r.amount))
    if len(ordered) == 3:
        vat, fee, principal = ordered
        if abs(float(vat.amount) - float(fee.amount) * VAT_RATE) <= VAT_TOLERANCE:
            return ([vat, fee], [principal])
        return None
    if len(ordered) == 2:
        vat, fee = ordered
        if abs(float(vat.amount) - float(fee.amount) * VAT_RATE) <= VAT_TOLERANCE:
            return ([vat, fee], [])
        return None
    if len(ordered) == 1:
        return ([], ordered)
    return None


# ── Reversed transactions ────────────────────────────────────────────

def find_reversals(bank_rows: list) -> list:
    """Return the rows that cancel each other out.

    A failed transaction is not removed from the statement — the bank
    posts it and then posts the mirror image back. On 2026-08-16 three
    withdrawal attempts produced twelve debit lines and four credit
    lines, the middle attempt having been reversed in full, fees
    included.

    These must be cancelled BEFORE matching rather than after. Matching
    consumes ledger rows in statement order, so leaving the mirrored pair
    in would let the reversed attempt claim a real booking and push a
    genuine withdrawal into the unmatched pile instead.

    Pairing is per reference and per amount: a credit only cancels a
    debit of the same size under the same reference.
    """
    by_ref: dict[str, list] = {}
    for row in bank_rows:
        ref = transaction_reference(row.details)
        if ref:
            by_ref.setdefault(ref, []).append(row)

    cancelled: list = []
    for rows in by_ref.values():
        debits = [r for r in rows if r.type == "expense"]
        credits = [r for r in rows if r.type == "income"]
        if not credits:
            continue
        claimed: list[int] = []
        for credit in credits:
            for i, debit in enumerate(debits):
                if i in claimed:
                    continue
                if abs(float(debit.amount) - float(credit.amount)) < 0.005:
                    claimed.append(i)
                    cancelled.extend([debit, credit])
                    break
    return cancelled


# ── Payee-category confidence ────────────────────────────────────────

# A high-confidence payee match only says "the name was recognised". It
# says nothing about the category being right: the register's
# default_category is a single field, while real usage can be spread
# across many categories. Measured against real statements, a payee
# default like `Employer Ltd -> Income:Salary` would have auto-booked
# a dozen rows on a category that matches 5% of that payee's history,
# and another on a category that never occurs at all.
# So the default is only trusted when actual usage backs it.
AUTO_MIN_USES = 5
AUTO_MIN_SHARE = 0.60


def category_usage(existing_tx: list[dict]) -> dict[str, dict[str, int]]:
    """Build payee -> {category: count} from the transaction history."""
    usage: dict[str, dict[str, int]] = {}
    for row in existing_tx:
        payee = row.get("payee", "")
        if not payee:
            continue
        usage.setdefault(payee, {})
        category = row.get("category", "")
        usage[payee][category] = usage[payee].get(category, 0) + 1
    return usage


def category_share(payee: str, category: str,
                   usage: dict[str, dict[str, int]]) -> tuple[int, float]:
    """Return (total uses of payee, share of them carrying category)."""
    counts = usage.get(payee)
    if not counts:
        return (0, 0.0)
    total = sum(counts.values())
    if total == 0:
        return (0, 0.0)
    return (total, counts.get(category, 0) / total)


# ── Classification ───────────────────────────────────────────────────

def _entry(s, reason: str, **extra) -> dict:
    """Uniform envelope for every bucket entry."""
    out = {
        "date": s.date,
        "amount": round(float(s.amount), 2),
        "details": s.bank_details,
        "reason": reason,
    }
    out.update(extra)
    return out


def _line(s, account: str, template: dict) -> dict:
    """Build a booking line from a rule template plus the bank row.

    The note always carries what the statement said, because that is the
    only trace back to the bank once the row is in transactions.csv. For
    an interbank transfer that is the narrative behind the REF hash (the
    purpose text typed at transfer time, e.g. "Salary 07 2026" or
    "ER-10192"); otherwise it is the full descriptor. Mirrors how these
    rows were already being booked by hand.
    """
    line = {
        "date": s.date,
        "account": account,
        "type": template.get("type", "expense"),
        "amount": f"{float(s.amount):.2f}",
        "payee": template.get("payee", ""),
        "category": template.get("category", ""),
        "transfer_to_account": template.get("transfer_to_account", ""),
        "tags": template.get("tags", ""),
        "note": template.get("note") or narrative(s.bank_details),
        "raw_note": s.bank_details,
    }
    if template.get("subscription_id"):
        line["subscription_id"] = template["subscription_id"]
    return line


def _subscription_hint(payee: str, account: str) -> dict:
    """Ask-bucket annotation naming subscriptions this row could settle.

    match_for_charge stays silent when the amount moved too far or the
    period already has a charge, and those are exactly the rows a human
    should look at. Surfacing the candidates keeps a recurring charge
    from being booked unlinked just because it was not obvious.
    """
    try:
        candidates = subscriptions.subscription_candidates(payee, account)
    except Exception:
        return {}
    return {"subscription_candidates": candidates} if candidates else {}


def classify(suggestions: list, existing_tx: list[dict], rules: list[dict],
             presets: list[dict], dismissed: set, account: str = "crdb",
             conservative: bool = True) -> dict:
    """Sort unmatched statement rows into auto / ask / skip.

    ``suggestions`` are the rows the adapter could NOT match against
    transactions.csv, so everything here is a candidate for booking.

    With ``conservative`` (the default) only deterministic or
    rule-backed rows book without asking: the ATM cascade, the
    interbank fee pair, and explicit rules. A category merely inferred
    from the payee register always asks, and the way to promote it to
    auto is to add a rule the user has approved.
    """
    auto: list[dict] = []
    ask: list[dict] = []
    skip: list[dict] = []

    usage = category_usage(existing_tx)

    def dismissed_hit(s) -> bool:
        return recon_rules.dismiss_key(
            account, s.date, s.amount, s.bank_details) in dismissed

    groups, rest = group_atm(suggestions, rules)

    # ── ATM groups ───────────────────────────────────────────────────
    # Deliberately NOT near-miss checked: withdrawal amounts are round
    # numbers that recur constantly (2026-05-25 alone had two), so the
    # +/-7-day same-amount heuristic would fire on almost every group.
    # The four-line cascade signature is distinctive enough on its own.
    for ref, group in groups.items():
        members = ([group["withdrawal"]] if group["withdrawal"] else []) + group["fees"]
        if any(dismissed_hit(m) for m in members):
            skip.extend(_entry(m, "dismissed", reference=ref) for m in members)
            continue
        if group["withdrawal"] is None or len(group["fees"]) != 3:
            ask.extend(_entry(m, "atm_group_incomplete", reference=ref) for m in members)
            continue

        agg = find_sum_match(group["fees"], account, existing_tx)
        if agg:
            ask.extend(_entry(m, "sum_already_booked", reference=ref,
                              sum_match_id=agg) for m in members)
            continue

        withdrawal = group["withdrawal"]
        case, delta = verify_cascade(withdrawal.amount, group["fees"], presets)
        if case == "C":
            ask.extend(_entry(m, "atm_preset_mismatch", reference=ref, delta=delta)
                       for m in members)
            continue

        rule = recon_rules.match_rule(withdrawal.bank_details, rules) or {}
        template = rule.get("then", {})
        auto.append(_entry(withdrawal, f"atm_case_{case.lower()}", reference=ref,
                           line=_line(withdrawal, account, template)))
        if case == "A":
            # The backend regenerates these three from the preset.
            skip.extend(_entry(f, "atm_cascade_generated", reference=ref)
                        for f in group["fees"])
        else:
            # No preset fires, so the statement's own figures are booked.
            for fee in group["fees"]:
                auto.append(_entry(fee, "atm_case_b_fee", reference=ref,
                                   line=_line(fee, account, {
                                       "type": "expense", "payee": "CRDB",
                                       "category": "Fees:Bank Fees"})))

    def classify_single(s) -> None:
        """Route one standalone row into a bucket."""
        if dismissed_hit(s):
            skip.append(_entry(s, "dismissed"))
            return

        near = find_near_miss(s.date, s.amount, account, existing_tx)
        if near:
            ask.append(_entry(s, "near_miss", near_miss_id=near))
            return

        rule = recon_rules.match_rule(s.bank_details, rules)
        if rule and rule.get("action") == "book":
            auto.append(_entry(s, "rule", rule_id=rule.get("id"),
                               line=_line(s, account, rule.get("then", {}))))
            return
        if rule and rule.get("action") == "skip":
            skip.append(_entry(s, "rule_skip", rule_id=rule.get("id")))
            return

        if s.match_confidence == "high" and s.category:
            uses, share = category_share(s.payee, s.category, usage)
            confident = uses >= AUTO_MIN_USES and share >= AUTO_MIN_SHARE
            if confident and not conservative:
                auto.append(_entry(s, "payee_high", uses=uses, share=round(share, 2),
                                   line=_line(s, account, {
                                       "type": s.type, "payee": s.payee,
                                       "category": s.category})))
                return
            reason = "payee_high_conservative" if confident else "payee_category_unsure"
            ask.append(_entry(s, reason, payee_guess=s.payee,
                              category_guess=s.category, uses=uses,
                              share=round(share, 2),
                              **_subscription_hint(s.payee, account)))
            return

        reason = "no_category" if s.payee else "no_rule_no_payee"
        ask.append(_entry(s, reason, payee_guess=s.payee,
                          confidence=s.match_confidence,
                          **_subscription_hint(s.payee, account)))

    # ── Interbank transfer groups ────────────────────────────────────
    # The bank splits one transfer into principal + fee + VAT under a
    # shared reference. Fee and VAT are unambiguous bank charges and their
    # amounts come straight off the statement, so they book without asking
    # even in conservative mode. The principal carries the actual meaning
    # and goes through normal classification.
    ref_groups, singles = group_ref(rest)
    for ref, rows in ref_groups.items():
        if any(dismissed_hit(r) for r in rows):
            skip.extend(_entry(r, "dismissed", reference=ref) for r in rows)
            continue
        split = split_ref_group(rows)
        if split is None:
            ask.extend(_entry(r, "ref_group_unexpected", reference=ref) for r in rows)
            continue
        fee_rows, principal_rows = split
        if fee_rows:
            agg = find_sum_match(fee_rows, account, existing_tx)
            if agg:
                ask.extend(_entry(r, "sum_already_booked", reference=ref,
                                  sum_match_id=agg) for r in rows)
                continue
        for fee in fee_rows:
            auto.append(_entry(fee, "ref_fee", reference=ref,
                               line=_line(fee, account, {
                                   "type": "expense", "payee": "CRDB",
                                   "category": "Fees:Bank Fees"})))
        for principal in principal_rows:
            classify_single(principal)

    # ── everything else ──────────────────────────────────────────────
    for s in singles:
        classify_single(s)

    # A recurring charge must carry its subscription link from the very
    # first write: booked without it, subscription_log stays empty and
    # next_renewal never rolls off the real charge. Resolved for the whole
    # batch at once so the same subscription is not handed to two charges
    # — the period guard reads subscription_log, which this batch has not
    # written yet. Never fatal: an unreadable master means unlinked
    # bookings, not a failed import.
    try:
        subscriptions.resolve_links_for_lines(
            [e["line"] for e in auto if e.get("line")])
    except Exception:
        pass

    return {"auto": auto, "ask": ask, "skip": skip}


def build_backfill(match_pairs: list[dict],
                   existing_tx: list[dict]) -> tuple[list[dict], int]:
    """Propose raw_note backfills for matched ledger rows.

    Rows entered by hand carry the user's own note ("Zigaretten") and
    nothing that ties them back to the statement. raw_note is the column
    meant for the bank's own descriptor, so it is written and note is
    left untouched.

    Only rows that would actually change are proposed. Re-running an
    import over a statement that grew by three lines used to emit a
    proposal per matched row — fifty of them no-ops — which buried the
    handful that mattered. Returns ``(proposals, skipped_noop)``; the
    count is reported rather than dropped silently.
    """
    proposals: list[dict] = []
    skipped = 0
    for pair in match_pairs:
        for position in pair.get("ledger_positions", []):
            if position >= len(existing_tx):
                continue
            row = existing_tx[position]
            merged = merge_raw_note(row.get("raw_note", ""), pair["bank_details"])
            if merged is None:
                skipped += 1
                continue
            proposals.append({
                "import_id": row.get("import_id", ""),
                "date": row.get("date", ""),
                "amount": row.get("amount", ""),
                "payee": row.get("payee", ""),
                "note": row.get("note", ""),
                "raw_note": pair["bank_details"],
                "current_raw_note": row.get("raw_note", ""),
            })
    return proposals, skipped


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Prints the three buckets as JSON on stdout."""
    import tx_engine
    from reconciliation import get_adapter_for_account

    parser = argparse.ArgumentParser(description="Classify a bank statement.")
    parser.add_argument("--account", default="crdb")
    parser.add_argument("--file", required=True,
                        help="basename inside the adapter's data_subdir")
    parser.add_argument("--backfill", action="store_true",
                        help="emit raw_note backfill proposals for matched "
                             "rows instead of classifying the misses")
    parser.add_argument("--confident", action="store_true",
                        help="also auto-book categories inferred from the "
                             "payee register (default: ask about those)")
    args = parser.parse_args(argv)

    adapter = get_adapter_for_account(args.account)
    safe_name = Path(args.file).name
    stmt = tx_engine.DATA_DIR / adapter.data_subdir / safe_name
    if not stmt.exists():
        print(json.dumps({"error": f"File not found: {safe_name}"}))
        return 1

    with (tx_engine.DATA_DIR / "transactions.csv").open(
            "r", newline="", encoding="utf-8") as f:
        existing_tx = list(csv.DictReader(f))

    # Rows the adapter DID match are filtered out by reconcile() and never
    # reach the buckets. Report the count so a run over an already-booked
    # month is visibly a no-op rather than looking like a parse failure.
    bank_rows = adapter.parse(str(stmt))
    cancelled = find_reversals(bank_rows)
    cancelled_ids = {id(r) for r in cancelled}
    live_rows = [r for r in bank_rows if id(r) not in cancelled_ids]
    suggestions = adapter.reconcile(str(stmt), existing_tx,
                                    account=args.account, rows=live_rows)
    result = classify(
        suggestions, existing_tx,
        recon_rules.load_rules(adapter.name),
        tx_engine.load_atm_fees(),
        recon_rules.load_dismissed(),
        account=args.account,
        conservative=not args.confident,
    )
    result["file"] = safe_name
    result["account"] = args.account
    result["adapter"] = adapter.name
    result["skip"].extend({
        "date": r.date,
        "amount": round(float(r.amount), 2),
        "details": r.details,
        "reason": "reversed",
        "reference": transaction_reference(r.details) or "",
    } for r in cancelled)
    result["total_bank_rows"] = len(bank_rows)
    result["reversed"] = len(cancelled)
    result["already_booked"] = len(live_rows) - len(suggestions)
    result["conservative"] = not args.confident
    # Always computed, not gated behind --backfill. A statement that grew
    # since the last run brings both new bookings AND descriptors for rows
    # booked by hand in between; leaving the second half to a separate flag
    # meant it was simply forgotten. The flag now only means "just this".
    backfill, backfill_noop = build_backfill(
        getattr(adapter, "match_pairs", []), existing_tx)
    result["backfill"] = backfill
    result["backfill_skipped_noop"] = backfill_noop
    result["parse_errors"] = getattr(adapter, "parse_errors", [])
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
