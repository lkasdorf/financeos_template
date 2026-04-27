"""B3.4.c.4.c.2 — Add i18n keys for CostOfLiving report."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EN_PATH = ROOT / "config" / "i18n" / "en.json"
DE_PATH = ROOT / "config" / "i18n" / "de.json"

# COL group definitions: (key, EN label, DE label, EN desc, DE desc)
COL_GROUPS = [
    ("groceries", "Groceries", "Lebensmittel",
     "Food:Groceries — everyday food shopping",
     "Food:Groceries — alltäglicher Lebensmitteleinkauf"),
    ("housing", "Housing", "Wohnen",
     "All Bills:* — rent, electricity, water, internet, gas, service charges",
     "Alle Bills:* — Miete, Strom, Wasser, Internet, Gas, Nebenkosten"),
    ("home", "Home & Office", "Haus & Büro",
     "All Home:* — furnishing, household consumables, maintenance/repairs, and home-office expenses (IT equipment, office supplies)",
     "Alle Home:* — Einrichtung, Haushalts-Verbrauchsgüter, Instandhaltung/Reparaturen und Home-Office-Ausgaben (IT-Geräte, Bürobedarf)"),
    ("health", "Healthcare", "Gesundheit",
     "All Healthcare:* — doctor visits, medication, tests, insurance",
     "Alle Healthcare:* — Arztbesuche, Medikamente, Tests, Versicherung"),
    ("transport", "Transport & Auto", "Transport & Auto",
     "Transport:* (boda, taxi, daladala, flights within regular travel) + all Automobile:* except one-off car purchases (petrol, maintenance, insurance, tolls, parking)",
     "Transport:* (Boda, Taxi, Daladala, Flüge im üblichen Reiseumfang) + alle Automobile:* außer einmaligen Autokäufen (Benzin, Wartung, Versicherung, Maut, Parken)"),
    ("subscriptions", "Subscriptions", "Abonnements",
     "All Subscriptions:* — AI, streaming, hosting, tools",
     "Alle Subscriptions:* — KI, Streaming, Hosting, Tools"),
    ("leisure", "Leisure", "Freizeit",
     "All Leisure:* — alcohol, smoking, sports, entertainment",
     "Alle Leisure:* — Alkohol, Rauchen, Sport, Unterhaltung"),
    ("personal", "Personal", "Persönliches",
     "All Personal:* — haircuts, clothing, care products",
     "Alle Personal:* — Friseur, Kleidung, Pflegeprodukte"),
    ("kids", "Kids", "Kinder",
     "All Kids:* — school fees, clothes, toys, supplies",
     "Alle Kids:* — Schulgebühren, Kleidung, Spielzeug, Schulsachen"),
    ("pet", "Pet", "Haustier",
     "All Pet:* — food, vet, supplies",
     "Alle Pet:* — Futter, Tierarzt, Zubehör"),
    ("other", "Other", "Sonstiges",
     "Everything else not matched by the above groups",
     "Alles andere, das keine der obigen Gruppen trifft"),
]


NEW_KEYS = [
    # Toolbar (Mode/Monthly/Yearly/Year/Currency mostly exist — add Mode + Monthly + Yearly if missing)
    ("reports.col.toolbar.mode", "Mode", "Modus"),
    ("reports.col.toolbar.monthly", "Monthly", "Monatlich"),
    ("reports.col.toolbar.yearly", "Yearly", "Jährlich"),

    # Section titles
    ("reports.col.monthly.title", "Cost of Living {year} ({currency})", "Lebenshaltung {year} ({currency})"),
    ("reports.col.yearly.title", "Cost of Living by Year ({currency})", "Lebenshaltung nach Jahr ({currency})"),

    # KPI tiles (monthly)
    ("reports.col.tile.living", "Living Expenses", "Lebenshaltungskosten"),
    ("reports.col.tile.living_sub", "{count} TX", "{count} TX"),
    ("reports.col.tile.avg", "Avg / Month", "ø / Monat"),
    ("reports.col.tile.avg_sub", "{n} active months", "{n} aktive Monate"),
    ("reports.col.tile.avg_no_visitors", "Avg excl. Visitors", "ø ohne Besucher"),
    ("reports.col.tile.avg_no_visitors_sub", "{amt} visitor spending removed", "{amt} Besucher-Ausgaben abgezogen"),
    ("reports.col.tile.excluded", "Excluded", "Ausgeschlossen"),
    ("reports.col.tile.excluded_sub", "Dining, Staff, Permits, Fines, Purchase, Loans, Cash Diff", "Dining, Staff, Permits, Fines, Purchase, Loans, Cash Diff"),

    # Chart titles
    ("reports.col.chart.stack", "Monthly Breakdown by Category", "Monatliche Aufschlüsselung nach Kategorie"),
    ("reports.col.chart.pie", "Category Distribution", "Kategorien-Verteilung"),
    ("reports.col.chart.trend", "Monthly Total Trend", "Monatlicher Gesamt-Trend"),
    ("reports.col.chart.year_stack", "Yearly Breakdown", "Jährliche Aufschlüsselung"),
    ("reports.col.chart.year_trend", "Total Cost of Living Trend", "Gesamt-Lebenshaltungs-Trend"),
    ("reports.col.dataset.label", "Cost of Living", "Lebenshaltung"),

    # Tables
    ("reports.col.section.monthly_detail", "Monthly Detail ({currency})", "Monatliche Details ({currency})"),
    ("reports.col.col.total", "Total", "Gesamt"),
    ("reports.col.col.avg_month", "Avg/Month", "ø/Monat"),
    ("reports.col.row.total", "Total", "Gesamt"),
    ("reports.col.visitor.marker_title", "Visitor month", "Besucher-Monat"),
    ("reports.col.visitor.line_prefix", "Visitor months:", "Besucher-Monate:"),
    ("reports.col.visitor.line_cell", "{month} ({amt} visitor-tagged)", "{month} ({amt} Besucher-getaggt)"),
    ("reports.col.visitor.line_suffix", "— \"Avg excl. Visitors\" subtracts only Visit-tagged TX, not the entire month.", "— \"ø ohne Besucher\" zieht nur Visit-getaggte TX ab, nicht den ganzen Monat."),

    # Legend / details
    ("reports.col.legend.title", "What counts in each column?", "Was zählt in jede Spalte?"),
    ("reports.col.legend.footer", "Hover a column header in the tables above for the same info inline.", "Mit der Maus über einen Spalten-Header fahren für dieselbe Info inline."),
    ("reports.col.excluded.monthly_line", "Excluded (non-essential, from Settings → Categories): {list}", "Ausgeschlossen (nicht-essenziell, aus Einstellungen → Kategorien): {list}"),
    ("reports.col.excluded.none", "none", "keine"),
    ("reports.col.excluded.yearly_line", "Excluded: Dining out · Staff · Permits · Fines · Travel · Car Purchase · Loans · Cash Discrepancy", "Ausgeschlossen: Auswärts essen · Personal · Genehmigungen · Bußgelder · Reisen · Autokauf · Darlehen · Kassen-Differenz"),
]

# Append per-group label + desc keys
for (gkey, en_label, de_label, en_desc, de_desc) in COL_GROUPS:
    NEW_KEYS.append((f"reports.col.group.{gkey}.label", en_label, de_label))
    NEW_KEYS.append((f"reports.col.group.{gkey}.desc", en_desc, de_desc))


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
