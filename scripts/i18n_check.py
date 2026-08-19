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


def discover_locales(locale_dir: Path = LOCALE_DIR) -> list[str]:
    """Return every non-EN locale name found in the locale directory.

    F-M9 (CODE_REVIEW_2026-06-12): the checker used to hard-code en+de,
    so es.json and fr.json could drift without CI noticing. Locales are
    discovered from disk instead — a fifth language is covered the moment
    its JSON lands.
    """
    return sorted(p.stem for p in locale_dir.glob("*.json") if p.stem != "en")


def collect(dashboard_dir: Path = DASHBOARD_DIR,
            locale_dir: Path = LOCALE_DIR) -> dict:
    static_uses: dict[str, list[str]] = {}   # key -> ["file:line", ...]
    dynamic_uses: dict[str, list[str]] = {}  # prefix -> ["file:line", ...]
    indirect_literals: set[str] = set()      # any i18n-shaped literal anywhere in JS

    for pattern in ("**/*.js", "**/*.html"):
        for fp in sorted(dashboard_dir.glob(pattern)):
            if any(part in EXCLUDED_DIRS for part in fp.relative_to(dashboard_dir).parts):
                continue
            try:
                rel = fp.relative_to(ROOT).as_posix()
            except ValueError:
                # Scanning a tree outside the repo (tests) — label it
                # relative to the dashboard dir instead of crashing.
                rel = fp.relative_to(dashboard_dir).as_posix()
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

    en = load_locale(locale_dir / "en.json")
    locale_names = discover_locales(locale_dir)
    others = {name: load_locale(locale_dir / f"{name}.json") for name in locale_names}

    en_keys = set(en.keys())
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
    unreferenced = sorted(
        k for k in en_keys
        if k not in code_keys
        and k not in indirect_literals
        and not matches_dynamic(k)
    )

    # L-PD3 (Sprint 23) — flag placeholder-count mismatches against EN for
    # the same key. Catches e.g. EN "{n} accounts" vs DE "Konten" where the
    # translation dropped the {n} substitution, which would render as a
    # literal "Konten" with the count silently lost. Since F-M9 this runs
    # for every locale, not just DE.
    import re as _re_local
    # Match both single-brace {name} and double-brace {{name}} forms;
    # t() in dashboard/i18n.js supports both.
    placeholder_re = _re_local.compile(r"\{\{?(\w+)\}?\}")

    locales: dict[str, dict] = {}
    for name, mapping in others.items():
        keys = set(mapping.keys())
        mismatches: list[dict] = []
        for key in sorted(en_keys & keys):
            en_val = en.get(key, "")
            loc_val = mapping.get(key, "")
            if not isinstance(en_val, str) or not isinstance(loc_val, str):
                continue
            en_ph = set(placeholder_re.findall(en_val))
            loc_ph = set(placeholder_re.findall(loc_val))
            if en_ph != loc_ph:
                mismatches.append({
                    "key": key,
                    "missing_in_locale": sorted(en_ph - loc_ph),
                    "extra_in_locale": sorted(loc_ph - en_ph),
                })
        locales[name] = {
            "count": len(keys),
            "missing": sorted(en_keys - keys),
            "orphans": sorted(keys - en_keys),
            "placeholder_mismatches": mismatches,
        }

    return {
        "static_uses": static_uses,
        "dynamic_uses": dynamic_uses,
        "en_count": len(en_keys),
        "code_static_count": len(code_keys),
        "dynamic_prefix_count": len(prefixes),
        "missing_in_en": missing_in_en,
        "unreferenced": unreferenced,
        "locales": locales,
    }


def hard_error_count(result: dict) -> int:
    """Errors that must fail the gate (CI runs this script blocking).

    Hard: a key used in code but absent from en.json, a key EN has and a
    translation does not, and a placeholder set that differs from EN's.
    Soft (reported, non-blocking): orphans in either direction.
    """
    count = len(result["missing_in_en"])
    for stats in result["locales"].values():
        count += len(stats["missing"]) + len(stats["placeholder_mismatches"])
    return count


def format_refs(refs: list[str], limit: int = 3) -> str:
    if len(refs) <= limit:
        return ", ".join(refs)
    return ", ".join(refs[:limit]) + f" (+{len(refs) - limit} more)"


def print_report(result: dict) -> None:
    print("FinanceOS i18n check")
    print("=" * 60)
    print(f"  {'en.json keys:':<25}{result['en_count']}")
    for name, stats in result["locales"].items():
        print(f"  {name + '.json keys:':<25}{stats['count']}")
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

    orphan_warnings = False
    for name, stats in result["locales"].items():
        if stats["missing"]:
            hard_errors += len(stats["missing"])
            print(f"[ERROR] missing-in-{name.upper()}  ({len(stats['missing'])})")
            print(f"  Keys in en.json but absent from {name}.json (locale parity broken):")
            for key in stats["missing"]:
                print(f"    {key}")
            print()

    for name, stats in result["locales"].items():
        if stats["orphans"]:
            orphan_warnings = True
            print(f"[WARN]  {name}-orphan-vs-en  ({len(stats['orphans'])})")
            print(f"  Keys in {name}.json that have no counterpart in en.json:")
            for key in stats["orphans"]:
                print(f"    {key}")
            print()

    if result["unreferenced"]:
        print(f"[WARN]  orphan  ({len(result['unreferenced'])})")
        print("  Keys in en.json never referenced in code (static or dynamic):")
        for key in result["unreferenced"]:
            print(f"    {key}")
        print()

    # L-PD3 (Sprint 23) — placeholder-count mismatch is a HARD error.
    # A translation that dropped {n} or {{currency}} silently renders the
    # literal text instead of the substitution, which the user only
    # spots if they happen to switch locales and look at that screen.
    for name, stats in result["locales"].items():
        mismatches = stats["placeholder_mismatches"]
        if not mismatches:
            continue
        hard_errors += len(mismatches)
        print(f"[ERROR] placeholder-mismatch-{name.upper()}  ({len(mismatches)})")
        print(f"  Same key, different placeholder set in EN vs {name.upper()}:")
        for m in mismatches:
            bits = []
            if m["missing_in_locale"]:
                bits.append(f"missing-in-{name}=" + ",".join(m["missing_in_locale"]))
            if m["extra_in_locale"]:
                bits.append(f"extra-in-{name}=" + ",".join(m["extra_in_locale"]))
            print(f"    {m['key']}  ({'; '.join(bits)})")
        print()

    if hard_errors == 0 and not orphan_warnings and not result["unreferenced"]:
        print("All i18n keys accounted for. Locale parity intact.")
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
            "missing_in_en": result["missing_in_en"],
            "unreferenced": result["unreferenced"],
            "locales": result["locales"],
        }
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print_report(result)

    return 1 if hard_error_count(result) else 0


if __name__ == "__main__":
    sys.exit(main())
