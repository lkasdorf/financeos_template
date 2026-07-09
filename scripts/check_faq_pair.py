#!/usr/bin/env python3
"""Drift lint for the multilingual FAQ set (docs/faq.md vs en/es/fr).

Compares the H2 + H3 hierarchy of every locale file against the German
reference and exits non-zero on any mismatch. Body text and slugs
intentionally diverge between locales — the guarantee we want is
structural: for every section in the German FAQ there is exactly one
corresponding section at the same nesting level and position in each
translation. That keeps the dashboard FAQ-toggle reliable (Section N in
DE ↔ Section N in any locale) and surfaces drift the moment a heading is
added, removed, or moved on only one side. Originally DE↔EN only; the
es/fr files silently fell 14 sections behind (2026-05-15 → 2026-07-09),
which is exactly the drift class this now catches.

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
# Translations validated against the German reference, in report order.
LOCALE_PATHS = {
    "en": REPO_ROOT / "docs" / "faq.en.md",
    "es": REPO_ROOT / "docs" / "faq.es.md",
    "fr": REPO_ROOT / "docs" / "faq.fr.md",
}

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
    other: list[tuple[int, str]],
    tag: str,
) -> list[str]:
    """Return human-readable drift messages. Empty list = no drift."""
    errors: list[str] = []
    if len(de) != len(other):
        errors.append(
            f"heading count mismatch: DE has {len(de)}, {tag} has {len(other)}"
        )
    pair_count = min(len(de), len(other))
    for i in range(pair_count):
        de_level, de_text = de[i]
        o_level, o_text = other[i]
        if de_level != o_level:
            errors.append(
                f"#{i + 1}: level mismatch — DE H{de_level} '{de_text}' "
                f"vs {tag} H{o_level} '{o_text}'"
            )
    # Surface the unpaired tail as well, so contributors see what is extra.
    for i in range(pair_count, len(de)):
        level, text = de[i]
        errors.append(f"#{i + 1}: extra DE heading H{level} '{text}'")
    for i in range(pair_count, len(other)):
        level, text = other[i]
        errors.append(f"#{i + 1}: extra {tag} heading H{level} '{text}'")
    return errors


def main(argv: list[str]) -> int:
    json_mode = "--json" in argv
    if not DE_PATH.exists():
        print(f"missing: {DE_PATH}", file=sys.stderr)
        return 2
    de_headings = collect_headings(DE_PATH)
    locales = {}
    all_errors: list[str] = []
    for tag, path in LOCALE_PATHS.items():
        if not path.exists():
            print(f"missing: {path}", file=sys.stderr)
            return 2
        headings = collect_headings(path)
        errors = [f"[{tag}] {e}" for e in diff_structure(de_headings, headings, tag.upper())]
        locales[tag] = {
            "path": str(path.relative_to(REPO_ROOT)),
            "headings": len(headings),
            "errors": errors,
        }
        all_errors.extend(errors)
    summary = {
        "de_path": str(DE_PATH.relative_to(REPO_ROOT)),
        "de_headings": len(de_headings),
        "locales": locales,
        "errors": all_errors,
        "ok": not all_errors,
    }
    if json_mode:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return 0 if summary["ok"] else 1
    print(f"DE: {DE_PATH.relative_to(REPO_ROOT)} — {len(de_headings)} headings")
    for tag, info in locales.items():
        print(f"{tag.upper()}: {info['path']} — {info['headings']} headings")
    if not all_errors:
        print("OK — H2/H3 hierarchy matches across all locales.")
        return 0
    print(f"\nDRIFT — {len(all_errors)} issue(s):")
    for e in all_errors:
        print(f"  - {e}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
