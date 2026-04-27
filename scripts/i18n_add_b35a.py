"""B3.5.a — Add i18n keys for custom-reports.js + faq.js + metals.js."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EN_PATH = ROOT / "config" / "i18n" / "en.json"
DE_PATH = ROOT / "config" / "i18n" / "de.json"

NEW_KEYS = [
    # custom-reports.js — pure aggregation labels
    ("custom.label.untagged", "(untagged)", "(ohne Tag)"),
    ("custom.label.none", "(none)", "(keins)"),

    # faq.js — search + loading + error
    ("faq.search.placeholder", "Search...", "Suchen..."),
    ("faq.loading", "Loading FAQ...", "FAQ wird geladen ..."),
    ("faq.error.load_failed", "FAQ could not be loaded: {err}. Is <code>docs/faq.md</code> reachable?", "FAQ konnte nicht geladen werden: {err}. <code>docs/faq.md</code> erreichbar?"),

    # metals.js — meta bar
    ("metals.meta", "{n} positions · Spot {source} ({date}) · Gold {gold}/oz · Silver {silver}/oz", "{n} Positionen · Spot {source} ({date}) · Gold {gold}/oz · Silber {silver}/oz"),

    # Summary tiles (row 1)
    ("metals.tile.market_value", "Market Value", "Marktwert"),
    ("metals.tile.market_value_sub", "Kettner prices · {n} positions", "Kettner-Preise · {n} Positionen"),
    ("metals.tile.invested", "Total Invested", "Gesamt investiert"),
    ("metals.tile.gain_loss", "Gain / Loss", "Gewinn / Verlust"),
    ("metals.tile.performance", "Performance", "Performance"),

    # Summary tiles (row 2 — split)
    ("metals.tile.gold", "Gold", "Gold"),
    ("metals.tile.silver", "Silver", "Silber"),
    ("metals.tile.metal_sub", "{pct}% · Invested {amt}", "{pct}% · Investiert {amt}"),
    ("metals.tile.gold_spot", "Gold Spot", "Gold-Spot"),
    ("metals.tile.silver_spot", "Silver Spot", "Silber-Spot"),
    ("metals.tile.per_gram", "{amt} / g", "{amt} / g"),

    # Summary tiles (row 3 — melt)
    ("metals.tile.melt_value", "Melt Value (Spot)", "Schmelzwert (Spot)"),
    ("metals.tile.melt_value_sub", "Pure metal value at spot price", "Reinmetall-Wert zum Spot-Preis"),
    ("metals.tile.avg_premium", "Avg Premium over Spot", "ø Aufschlag über Spot"),
    ("metals.tile.avg_premium_sub", "Market price vs. melt value", "Marktpreis vs. Schmelzwert"),

    # Chart titles
    ("metals.chart.distribution", "Metal Distribution", "Metall-Verteilung"),
    ("metals.chart.gain_loss", "Gain / Loss per Position", "Gewinn / Verlust je Position"),
    ("metals.chart.spot_history", "Gold &amp; Silver Spot Price History (EUR / troy oz)", "Gold- &amp; Silber-Spot-Historie (EUR / Troy-Unze)"),
    ("metals.chart.portfolio_history", "Portfolio Value Over Time (based on spot + avg premium)", "Portfolio-Wert im Zeitverlauf (auf Basis Spot + ø Aufschlag)"),

    # Positions table
    ("metals.section.positions", "Positions", "Positionen"),
    ("metals.col.product", "Product", "Produkt"),
    ("metals.col.metal", "Metal", "Metall"),
    ("metals.col.weight", "Weight", "Gewicht"),
    ("metals.col.qty", "Qty", "Anzahl"),
    ("metals.col.invested", "Invested", "Investiert"),
    ("metals.col.market_value", "Market Value", "Marktwert"),
    ("metals.col.gain_loss", "Gain/Loss", "Gewinn/Verlust"),
    ("metals.col.pct", "+/-%", "+/-%"),
    ("metals.col.premium", "Premium", "Aufschlag"),
    ("metals.col.bought", "Bought", "Gekauft"),
    ("metals.row.total", "Total", "Gesamt"),

    # Chart dataset labels
    ("metals.dataset.gain_loss", "Gain/Loss", "Gewinn/Verlust"),
    ("metals.dataset.gold_eur_oz", "Gold (EUR/oz)", "Gold (EUR/oz)"),
    ("metals.dataset.silver_eur_oz", "Silver (EUR/oz)", "Silber (EUR/oz)"),
    ("metals.axis.gold_eur_oz", "Gold EUR/oz", "Gold EUR/oz"),
    ("metals.axis.silver_eur_oz", "Silver EUR/oz", "Silber EUR/oz"),
    ("metals.dataset.portfolio", "Portfolio Value", "Portfolio-Wert"),
    ("metals.dataset.invested", "Total Invested", "Gesamt investiert"),
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
