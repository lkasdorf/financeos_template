#!/usr/bin/env python3
"""Drift lint for the bilingual FAQ pair (docs/faq.md vs docs/faq.en.md).

Compares the H2 + H3 hierarchy of both files and exits non-zero on any
mismatch. Body text and slugs intentionally diverge between locales — the
guarantee we want is structural: for every section in the German FAQ there
is exactly one corresponding section at the same nesting level and position
in the English FAQ. That keeps the dashboard FAQ-toggle reliable (Section N
in DE ↔ Section N in EN) and surfaces drift the moment a heading is added,
removed, or moved on only one side.

Usage:
    python scripts/check_faq_pair.py          # text report, exit 1 on drift
    python scripts/check_faq_pair.py --json   # machine-readable for CI
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DE_PATH = REPO_ROOT / "docs" / "faq.md"
EN_PATH = REPO_ROOT / "docs" / "faq.en.md"

# Match H2 / H3 only; H4+ are body subsections we do not enforce.
HEADING_RE = re.compile(r"^(#{2,3})\s+(.+?)\s*$")


def collect_headings(path: Path) -> list[tuple[int, str]]:
    """Return [(level, text), ...] for every H2/H3 in document order."""
    out: list[tuple[int, str]] = []
    in_code = False
    for line in path.read_text(encoding="utf-8").splitlines():
        # Skip headings that live inside fenced code blocks.
        if line.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        m = HEADING_RE.match(line)
        if not m:
            continue
        level = len(m.group(1))
        out.append((level, m.group(2).strip()))
    return out


def diff_structure(
    de: list[tuple[int, str]],
    en: list[tuple[int, str]],
) -> list[str]:
    """Return human-readable drift messages. Empty list = no drift."""
    errors: list[str] = []
    if len(de) != len(en):
        errors.append(
            f"heading count mismatch: DE has {len(de)}, EN has {len(en)}"
        )
    pair_count = min(len(de), len(en))
    for i in range(pair_count):
        de_level, de_text = de[i]
        en_level, en_text = en[i]
        if de_level != en_level:
            errors.append(
                f"#{i + 1}: level mismatch — DE H{de_level} '{de_text}' "
                f"vs EN H{en_level} '{en_text}'"
            )
    # Surface the unpaired tail as well, so contributors see what is extra.
    for i in range(pair_count, len(de)):
        level, text = de[i]
        errors.append(f"#{i + 1}: extra DE heading H{level} '{text}'")
    for i in range(pair_count, len(en)):
        level, text = en[i]
        errors.append(f"#{i + 1}: extra EN heading H{level} '{text}'")
    return errors


def main(argv: list[str]) -> int:
    json_mode = "--json" in argv
    if not DE_PATH.exists():
        print(f"missing: {DE_PATH}", file=sys.stderr)
        return 2
    if not EN_PATH.exists():
        print(f"missing: {EN_PATH}", file=sys.stderr)
        return 2
    de_headings = collect_headings(DE_PATH)
    en_headings = collect_headings(EN_PATH)
    errors = diff_structure(de_headings, en_headings)
    summary = {
        "de_path": str(DE_PATH.relative_to(REPO_ROOT)),
        "en_path": str(EN_PATH.relative_to(REPO_ROOT)),
        "de_headings": len(de_headings),
        "en_headings": len(en_headings),
        "errors": errors,
        "ok": not errors,
    }
    if json_mode:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return 0 if summary["ok"] else 1
    print(f"DE: {DE_PATH.relative_to(REPO_ROOT)} — {len(de_headings)} headings")
    print(f"EN: {EN_PATH.relative_to(REPO_ROOT)} — {len(en_headings)} headings")
    if not errors:
        print("OK — H2/H3 hierarchy matches.")
        return 0
    print(f"\nDRIFT — {len(errors)} issue(s):")
    for e in errors:
        print(f"  - {e}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
