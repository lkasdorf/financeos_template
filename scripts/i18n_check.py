"""Validate i18n coverage between dashboard code and locale JSONs.

Scans dashboard/**/*.js + dashboard/**/*.html for i18n references and
cross-checks them against config/i18n/en.json and de.json.

Three error classes:
    missing-in-EN  Key used in code but absent from en.json                (hard)
    missing-in-DE  Key present in en.json but absent from de.json         (hard)
    orphan         Key present in JSON(s) but never referenced in code    (warn)

Dynamic `t()` patterns like t(`reports.${id}.title`) contribute a
prefix-pattern rather than a concrete key. Any JSON key starting with
that prefix counts as used, which avoids false-positive orphans for
intentionally opt-in shadow-keys (reports metadata, months, weekdays).

Exit code is 1 when hard errors exist, 0 otherwise. Orphans are reported
but never fail the check.

Usage:
    python scripts/i18n_check.py
    python scripts/i18n_check.py --json  # machine-readable output
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DASHBOARD_DIR = ROOT / "dashboard"
LOCALE_DIR = ROOT / "config" / "i18n"
EN_PATH = LOCALE_DIR / "en.json"
DE_PATH = LOCALE_DIR / "de.json"

EXCLUDED_DIRS = {"lib"}  # third-party bundled code (chart/papaparse/xlsx)

# Key prefixes emitted by the BACKEND rather than referenced in JS/HTML.
# scripts/utilities.py ships property-drift alerts with an `i18n_key`
# field (plus i18n_params) that pages-alerts.js resolves at render time
# via t(`${a.i18n_key}.title`) — a data-driven key the JS scanner cannot
# see. Treated like scanned dynamic prefixes for orphan detection.
SERVER_EMITTED_PREFIXES = (
    "alerts.luku",
    "alerts.water",
    "alerts.utilities",
)

KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.]*$")
T_CALL_RE = re.compile(r"(?<![A-Za-z0-9_$])t\s*\(")
LITERAL_RE = re.compile(r"""(['"`])([A-Za-z][A-Za-z0-9_.]*)\1""")
TEMPLATE_PREFIX_RE = re.compile(r"`([A-Za-z][A-Za-z0-9_.]*?)\$\{")
HTML_ATTR_RE = re.compile(
    r"""\bdata-i18n(?:-title|-placeholder|-aria-label|-html)?\s*=\s*["']([A-Za-z][A-Za-z0-9_.]*)["']"""
)


def _find_t_arg_spans(text: str) -> list[tuple[int, int]]:
    """Return (start, end) spans of the FIRST argument of each t(...) call.

    The first argument ends at the first top-level comma inside the parens
    (or at the closing paren if there is only one argument). Literals in
    the 2nd/3rd arg (options object, English fallback) are deliberately
    excluded — they are not i18n keys.

    Handles nested parens/brackets/braces, single/double/backtick strings,
    template literal ${...} interpolation, escape sequences, and line/
    block comments.
    """
    spans: list[tuple[int, int]] = []
    i = 0
    length = len(text)
    while i < length:
        m = T_CALL_RE.search(text, i)
        if not m:
            break
        start = m.end()  # position right after the "("
        j = start
        bracket_depth = 0  # () [] {} inside the arg
        in_str: str | None = None
        tmpl_expr_depth = 0
        end_pos: int | None = None
        while j < length:
            c = text[j]
            if in_str is None and tmpl_expr_depth == 0:
                if c == "/" and j + 1 < length and text[j + 1] == "/":
                    nl = text.find("\n", j)
                    j = length if nl < 0 else nl
                    continue
                if c == "/" and j + 1 < length and text[j + 1] == "*":
                    endc = text.find("*/", j + 2)
                    j = length if endc < 0 else endc + 2
                    continue
                if c in "'\"`":
                    in_str = c
                elif c in "([{":
                    bracket_depth += 1
                elif c in ")]}":
                    if bracket_depth == 0 and c == ")":
                        end_pos = j
                        break
                    bracket_depth -= 1
                elif c == "," and bracket_depth == 0:
                    end_pos = j
                    break
            elif in_str is not None:
                if c == "\\":
                    j += 2
                    continue
                if in_str == "`" and c == "$" and j + 1 < length and text[j + 1] == "{":
                    tmpl_expr_depth = 1
                    in_str = None
                    j += 2
                    continue
                if c == in_str:
                    in_str = None
            else:  # inside ${...}
                if c in "'\"`":
                    end_q = j + 1
                    while end_q < length:
                        if text[end_q] == "\\":
                            end_q += 2
                            continue
                        if text[end_q] == c:
                            break
                        end_q += 1
                    j = end_q
                elif c == "{":
                    tmpl_expr_depth += 1
                elif c == "}":
                    tmpl_expr_depth -= 1
                    if tmpl_expr_depth == 0:
                        in_str = "`"
            j += 1
        if end_pos is not None:
            spans.append((start, end_pos))
            i = end_pos + 1
        else:
            i = start  # unterminated, skip
    return spans


def scan_js(path: Path) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    """Return (static_keys, dynamic_prefixes) as (value, line_no) pairs.

    Scans each t(...) call region for quoted string literals and template
    literals with ${...} interpolation. This captures ternary and
    conditional patterns, not only first-argument literals.
    """
    text = path.read_text(encoding="utf-8")
    static: list[tuple[str, int]] = []
    dynamic: list[tuple[str, int]] = []
    for start, end in _find_t_arg_spans(text):
        region = text[start:end]
        base_line = text.count("\n", 0, start) + 1
        for lm in LITERAL_RE.finditer(region):
            key = lm.group(2)
            if KEY_RE.match(key):
                line_no = base_line + region.count("\n", 0, lm.start())
                static.append((key, line_no))
        for tm in TEMPLATE_PREFIX_RE.finditer(region):
            prefix = tm.group(1).rstrip(".")
            if prefix:
                line_no = base_line + region.count("\n", 0, tm.start())
                dynamic.append((prefix, line_no))
    return static, dynamic


def scan_html(path: Path) -> list[tuple[str, int]]:
    text = path.read_text(encoding="utf-8")
    out: list[tuple[str, int]] = []
    for m in HTML_ATTR_RE.finditer(text):
        line_no = text.count("\n", 0, m.start()) + 1
        out.append((m.group(1), line_no))
    return out


def load_locale(path: Path) -> dict[str, str]:
    if not path.exists():
        raise SystemExit(f"Locale file not found: {path}")
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise SystemExit(f"Locale file is not a flat object: {path}")
    return {str(k): v for k, v in data.items()}


def collect() -> dict:
    static_uses: dict[str, list[str]] = {}   # key -> ["file:line", ...]
    dynamic_uses: dict[str, list[str]] = {}  # prefix -> ["file:line", ...]
    indirect_literals: set[str] = set()      # any i18n-shaped literal anywhere in JS

    for pattern in ("**/*.js", "**/*.html"):
        for fp in sorted(DASHBOARD_DIR.glob(pattern)):
            if any(part in EXCLUDED_DIRS for part in fp.relative_to(DASHBOARD_DIR).parts):
                continue
            rel = fp.relative_to(ROOT).as_posix()
            if fp.suffix == ".js":
                statics, dynamics = scan_js(fp)
                for key, line in statics:
                    static_uses.setdefault(key, []).append(f"{rel}:{line}")
                for prefix, line in dynamics:
                    dynamic_uses.setdefault(prefix, []).append(f"{rel}:{line}")
                text = fp.read_text(encoding="utf-8")
                for lm in LITERAL_RE.finditer(text):
                    key = lm.group(2)
                    if "." in key and KEY_RE.match(key):
                        indirect_literals.add(key)
            else:
                for key, line in scan_html(fp):
                    static_uses.setdefault(key, []).append(f"{rel}:{line}")

    en = load_locale(EN_PATH)
    de = load_locale(DE_PATH)

    en_keys = set(en.keys())
    de_keys = set(de.keys())
    code_keys = set(static_uses.keys())
    for p in SERVER_EMITTED_PREFIXES:
        dynamic_uses.setdefault(p, []).append("scripts/utilities.py (server-emitted)")
    prefixes = sorted(dynamic_uses.keys(), key=len, reverse=True)

    def matches_dynamic(k: str) -> bool:
        for p in prefixes:
            if k == p or k.startswith(p + "."):
                return True
        return False

    missing_in_en = sorted(code_keys - en_keys)
    missing_in_de = sorted(en_keys - de_keys)
    de_orphans_vs_en = sorted(de_keys - en_keys)
    unreferenced = sorted(
        k for k in en_keys
        if k not in code_keys
        and k not in indirect_literals
        and not matches_dynamic(k)
    )

    # L-PD3 (Sprint 23) — flag placeholder-count mismatches between EN and
    # DE for the same key. Catches e.g. EN "{n} accounts" vs DE "Konten"
    # where the DE side dropped the {n} substitution, which would render
    # as a literal "Konten" with the count silently lost.
    import re as _re_local
    # Match both single-brace {name} and double-brace {{name}} forms;
    # t() in dashboard/i18n.js supports both.
    placeholder_re = _re_local.compile(r"\{\{?(\w+)\}?\}")
    placeholder_mismatches: list[dict] = []
    for key in sorted(en_keys & de_keys):
        en_val = en.get(key, "")
        de_val = de.get(key, "")
        if not isinstance(en_val, str) or not isinstance(de_val, str):
            continue
        en_ph = set(placeholder_re.findall(en_val))
        de_ph = set(placeholder_re.findall(de_val))
        if en_ph != de_ph:
            placeholder_mismatches.append({
                "key": key,
                "missing_in_de": sorted(en_ph - de_ph),
                "extra_in_de": sorted(de_ph - en_ph),
            })

    return {
        "static_uses": static_uses,
        "dynamic_uses": dynamic_uses,
        "en_count": len(en_keys),
        "de_count": len(de_keys),
        "code_static_count": len(code_keys),
        "dynamic_prefix_count": len(prefixes),
        "missing_in_en": missing_in_en,
        "missing_in_de": missing_in_de,
        "de_orphans_vs_en": de_orphans_vs_en,
        "unreferenced": unreferenced,
        "placeholder_mismatches": placeholder_mismatches,
    }


def format_refs(refs: list[str], limit: int = 3) -> str:
    if len(refs) <= limit:
        return ", ".join(refs)
    return ", ".join(refs[:limit]) + f" (+{len(refs) - limit} more)"


def print_report(result: dict) -> None:
    print("FinanceOS i18n check")
    print("=" * 60)
    print(f"  en.json keys:            {result['en_count']}")
    print(f"  de.json keys:            {result['de_count']}")
    print(f"  Static t()/data-i18n:    {result['code_static_count']}")
    print(f"  Dynamic prefixes:        {result['dynamic_prefix_count']}")
    print()

    hard_errors = 0

    if result["missing_in_en"]:
        hard_errors += len(result["missing_in_en"])
        print(f"[ERROR] missing-in-EN  ({len(result['missing_in_en'])})")
        print("  Keys referenced in code but absent from en.json:")
        for key in result["missing_in_en"]:
            refs = result["static_uses"].get(key, [])
            print(f"    {key}")
            if refs:
                print(f"      {format_refs(refs)}")
        print()

    if result["missing_in_de"]:
        hard_errors += len(result["missing_in_de"])
        print(f"[ERROR] missing-in-DE  ({len(result['missing_in_de'])})")
        print("  Keys in en.json but absent from de.json (locale parity broken):")
        for key in result["missing_in_de"]:
            print(f"    {key}")
        print()

    if result["de_orphans_vs_en"]:
        print(f"[WARN]  de-orphan-vs-en  ({len(result['de_orphans_vs_en'])})")
        print("  Keys in de.json that have no counterpart in en.json:")
        for key in result["de_orphans_vs_en"]:
            print(f"    {key}")
        print()

    if result["unreferenced"]:
        print(f"[WARN]  orphan  ({len(result['unreferenced'])})")
        print("  Keys in en.json never referenced in code (static or dynamic):")
        for key in result["unreferenced"]:
            print(f"    {key}")
        print()

    # L-PD3 (Sprint 23) — placeholder-count mismatch is a HARD error.
    # A DE string that dropped {n} or {{currency}} silently renders the
    # literal text instead of the substitution, which the user only
    # spots if they happen to switch locales and look at that screen.
    mismatches = result.get("placeholder_mismatches", [])
    if mismatches:
        hard_errors += len(mismatches)
        print(f"[ERROR] placeholder-mismatch  ({len(mismatches)})")
        print("  Same key, different placeholder set in EN vs DE:")
        for m in mismatches:
            bits = []
            if m["missing_in_de"]:
                bits.append("missing-in-de=" + ",".join(m["missing_in_de"]))
            if m["extra_in_de"]:
                bits.append("extra-in-de=" + ",".join(m["extra_in_de"]))
            print(f"    {m['key']}  ({'; '.join(bits)})")
        print()

    if hard_errors == 0 and not result["de_orphans_vs_en"] and not result["unreferenced"]:
        print("All i18n keys accounted for. EN/DE parity intact.")
    elif hard_errors == 0:
        print("No hard errors. Warnings above do not fail the check.")
    else:
        print(f"FAIL: {hard_errors} hard error(s). Fix missing keys before continuing.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true",
                        help="Emit machine-readable JSON instead of text report.")
    args = parser.parse_args()

    result = collect()

    if args.json:
        payload = {
            "en_count": result["en_count"],
            "de_count": result["de_count"],
            "missing_in_en": result["missing_in_en"],
            "missing_in_de": result["missing_in_de"],
            "de_orphans_vs_en": result["de_orphans_vs_en"],
            "unreferenced": result["unreferenced"],
            "placeholder_mismatches": result["placeholder_mismatches"],
        }
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print_report(result)

    return 1 if (result["missing_in_en"] or result["missing_in_de"] or result["placeholder_mismatches"]) else 0


if __name__ == "__main__":
    sys.exit(main())
