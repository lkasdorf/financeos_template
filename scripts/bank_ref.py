"""Bank references, and how a statement descriptor merges into raw_note.

``raw_note`` holds the bank's own wording for a transaction. The same
transaction can reach us worded differently more than once: a card
purchase is first posted as a "POS Purchase Financial Advice" (the
authorisation) and later as the settled "POS Purchase" line — same
reference, same amount, two spellings. Comparing the text alone makes
the second one look like new information, and the field ends up holding
one purchase twice.

The reference is what identifies the trace. Two descriptors sharing one
reference are the same event, so the newer wording replaces the older;
different references are genuinely different traces and accumulate.
Lines the bank stamps no reference on ("Debit Arrangement Tax") fall
back to plain text comparison.

Lives in its own module because both sides need it: recon_import builds
the proposals, tx_engine writes them, and recon_import already imports
tx_engine — so the shared piece cannot live in either.
"""

from __future__ import annotations

import re

# CRDB puts a twelve-digit transaction reference in every line of an ATM
# cascade. The account number (AC-TZS1000200203301) is a longer digit run
# and therefore cannot match: \b requires a non-digit on both sides.
_REF_RE = re.compile(r"\b(\d{12})\b")

# Every interbank transfer line carries a shared 16-hex reference.
_REF_HASH_RE = re.compile(r"REF:([0-9a-f]{16})", re.IGNORECASE)

# How multiple traces are joined inside one raw_note field.
SEPARATOR = " | "


def extract_reference(details: str) -> str | None:
    """Return the twelve-digit transaction reference, or None."""
    hit = _REF_RE.search(details or "")
    return hit.group(1) if hit else None


def extract_ref_hash(details: str) -> str | None:
    """Return the 16-hex interbank reference, or None."""
    hit = _REF_HASH_RE.search(details or "")
    return hit.group(1) if hit else None


def transaction_reference(details: str) -> str | None:
    """Return whichever reference the bank stamped on this line."""
    return extract_ref_hash(details) or extract_reference(details)


def _normalise(text: str) -> str:
    """Collapse runs of whitespace — column widths vary between exports
    and must not count as a difference."""
    return " ".join((text or "").split())


def merge_raw_note(current: str, incoming: str) -> str | None:
    """Return the new raw_note value, or None when nothing should change.

    Callers write only when this returns a string, which keeps repeated
    imports of the same statement idempotent.
    """
    incoming = (incoming or "").strip()
    if not incoming:
        return None
    current = (current or "").strip()
    if not current:
        return incoming

    segments = [s.strip() for s in current.split(SEPARATOR) if s.strip()]
    ref = transaction_reference(incoming)

    if ref:
        for i, segment in enumerate(segments):
            if transaction_reference(segment) != ref:
                continue
            if _normalise(segment) == _normalise(incoming):
                return None
            # Same event, newer wording — replace this segment and leave
            # any other trace on the row alone.
            segments[i] = incoming
            return SEPARATOR.join(segments)
        return SEPARATOR.join(segments + [incoming])

    # No reference to key on: the old substring rule is the best available
    # answer, and it is right for the short fixed descriptors that lack one.
    if _normalise(incoming) in _normalise(current):
        return None
    return SEPARATOR.join(segments + [incoming])
