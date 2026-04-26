"""One-time migration: docs/payee-categories.md -> data/payees.json"""

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MD_PATH = REPO_ROOT / "docs" / "payee-categories.md"
JSON_PATH = REPO_ROOT / "data" / "payees.json"


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def parse_md():
    text = MD_PATH.read_text(encoding="utf-8")
    payees = []
    current_group = ""

    for line in text.split("\n"):
        line = line.strip()

        # Section header
        if line.startswith("## ") and not line.startswith("## Schema") and not line.startswith("## Wie") and not line.startswith("## Noch") and not line.startswith("## Änderungs"):
            current_group = line[3:].strip()
            continue

        # Table row
        if not line.startswith("|") or line.startswith("|---") or "Payee" in line and "Aliases" in line:
            continue

        cols = [c.strip() for c in line.split("|")]
        if len(cols) < 7:
            continue

        payee = cols[1]
        aliases_raw = cols[2]
        category = cols[3]
        account = cols[4]
        auto_tag = cols[5]
        notes = cols[6] if len(cols) > 6 else ""

        if not payee or not category or category == "Default-Kategorie":
            continue

        # Clean dashes
        account = "" if account in ("—", "-", "") else account
        auto_tag = "" if auto_tag in ("—", "-", "") else auto_tag
        notes = "" if notes in ("—", "-", "") else notes

        # Parse aliases
        aliases = []
        if aliases_raw and aliases_raw not in ("—", "-", ""):
            aliases = [a.strip() for a in aliases_raw.split(",") if a.strip()]

        payees.append({
            "id": slugify(payee),
            "payee": payee,
            "aliases": aliases,
            "default_category": category,
            "default_account": account,
            "auto_tag": auto_tag,
            "notes": notes,
            "group": current_group,
        })

    return payees


if __name__ == "__main__":
    payees = parse_md()
    JSON_PATH.write_text(
        json.dumps(payees, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Migrated {len(payees)} payees to {JSON_PATH}")
    for p in payees:
        print(f"  {p['id']:40} {p['payee']:30} -> {p['default_category']}")
