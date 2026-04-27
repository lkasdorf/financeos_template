"""B3.4.c.4.c.3 — Add i18n keys for CashDiscrepancy report (DE-native → EN primary)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EN_PATH = ROOT / "config" / "i18n" / "en.json"
DE_PATH = ROOT / "config" / "i18n" / "de.json"

NEW_KEYS = [
    # Summary tiles
    ("reports.cashdisc.tile.shortfall", "Shortfalls", "Fehlbeträge"),
    ("reports.cashdisc.tile.surplus", "Surpluses", "Überschüsse"),
    ("reports.cashdisc.tile.net", "Net Balance", "Netto-Saldo"),
    ("reports.cashdisc.tile.bookings_n", "{n} bookings", "{n} Buchungen"),
    ("reports.cashdisc.tile.bookings_total", "{n} bookings total", "{n} Buchungen total"),

    # Section headings
    ("reports.cashdisc.section.yearly", "Per Year", "Pro Jahr"),
    ("reports.cashdisc.section.detail", "Single Bookings", "Einzelbuchungen"),

    # Empty state
    ("reports.cashdisc.empty", "No bookings", "Keine Buchungen"),

    # Yearly table columns
    ("reports.cashdisc.col.year", "Year", "Jahr"),
    ("reports.cashdisc.col.count", "Count", "Anzahl"),
    ("reports.cashdisc.col.shortfall", "Shortfalls", "Fehlbeträge"),
    ("reports.cashdisc.col.surplus", "Surpluses", "Überschüsse"),
    ("reports.cashdisc.col.net", "Net", "Netto"),

    # Detail table columns
    ("reports.cashdisc.col.date", "Date", "Datum"),
    ("reports.cashdisc.col.account", "Account", "Konto"),
    ("reports.cashdisc.col.type", "Type", "Typ"),
    ("reports.cashdisc.col.category", "Category", "Kategorie"),
    ("reports.cashdisc.col.note", "Note", "Notiz"),
    ("reports.cashdisc.col.amount", "Amount", "Betrag"),
]


def main() -> None:
    en = json.loads(EN_PATH.read_text(encoding="utf-8"))
    de = json.loads(DE_PATH.read_text(encoding="utf-8"))

    added = 0
    for key, en_val, de_val in NEW_KEYS:
        if key not in en:
            en[key] = en_val
            added += 1
        if key not in de:
            de[key] = de_val

    EN_PATH.write_text(json.dumps(en, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    DE_PATH.write_text(json.dumps(de, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Added {added} new key(s).")
    print(f"Total keys: EN={len(en)}, DE={len(de)}, parity={'OK' if set(en) == set(de) else 'BROKEN'}")


if __name__ == "__main__":
    main()
