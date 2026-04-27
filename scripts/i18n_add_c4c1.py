"""B3.4.c.4.c.1 — Add i18n keys for StaffCosts filter_label + FxHistory report."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EN_PATH = ROOT / "config" / "i18n" / "en.json"
DE_PATH = ROOT / "config" / "i18n" / "de.json"

NEW_KEYS = [
    # StaffCosts wrapper
    ("reports.filter_label.staffcosts", "Staff Costs", "Personalkosten"),

    # FxHistory
    ("reports.fxh.empty.no_data", "No historical FX data available.", "Keine historischen FX-Daten verfügbar."),
    ("reports.fxh.empty.no_period", "No data for selected period.", "Keine Daten für den gewählten Zeitraum."),
    ("reports.fxh.toolbar.period", "Period", "Zeitraum"),
    ("reports.fxh.currencies.all", "All Currencies", "Alle Währungen"),
    ("reports.fxh.cur_name.eur", "Euro", "Euro"),
    ("reports.fxh.cur_name.usd", "US Dollar", "US-Dollar"),
    ("reports.fxh.cur_name.pln", "Polish Zloty", "Polnischer Złoty"),
    ("reports.fxh.cur_name.try", "Turkish Lira", "Türkische Lira"),
    ("reports.fxh.range.3m", "Last 3 Months", "Letzte 3 Monate"),
    ("reports.fxh.range.6m", "Last 6 Months", "Letzte 6 Monate"),
    ("reports.fxh.range.12m", "Last 12 Months", "Letzte 12 Monate"),
    ("reports.fxh.range.all", "All Time", "Gesamter Zeitraum"),
    ("reports.fxh.kpi.label", "{name} ({code}/TZS)", "{name} ({code}/TZS)"),
    ("reports.fxh.kpi.vs", "vs {date}", "vs. {date}"),
    ("reports.fxh.chart.rate_trend", "Rate Trend — TZS per 1 Unit", "Kurs-Trend — TZS pro 1 Einheit"),
    ("reports.fxh.chart.mom", "Month-over-Month Change (%)", "Veränderung Monat/Monat (%)"),
    ("reports.fxh.section.monthly", "Month-End Rates (TZS per 1 unit)", "Monatsend-Kurse (TZS pro 1 Einheit)"),
    ("reports.fxh.section.daily", "Daily Rates (TZS per 1 unit)", "Tageskurse (TZS pro 1 Einheit)"),
    ("reports.fxh.dataset.rate", "1 {code} in TZS", "1 {code} in TZS"),
    ("reports.fxh.dataset.mom", "MoM Change %", "MoM-Veränderung %"),
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
