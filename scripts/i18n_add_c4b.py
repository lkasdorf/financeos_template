"""B3.4.c.4.b — Add i18n keys for SavingsRate, Runway, DebtOverview, SavingsGoalsHistory reports."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EN_PATH = ROOT / "config" / "i18n" / "en.json"
DE_PATH = ROOT / "config" / "i18n" / "de.json"

# (key, EN, DE)
NEW_KEYS = [
    # ── Shared toolbar extensions ─────────────────────────────────────────
    ("reports.toolbar.all_years", "All Years", "Alle Jahre"),
    ("reports.toolbar.goal", "Goal", "Ziel"),

    # ── R: Savings Rate ───────────────────────────────────────────────────
    ("reports.savingsRate.section.title", "Savings Rate — {currency}", "Sparquote — {currency}"),
    ("reports.savingsRate.tile.avg", "Average Savings Rate", "Durchschnittliche Sparquote"),
    ("reports.savingsRate.tile.avg_count", "{n} months tracked", "{n} Monate erfasst"),
    ("reports.savingsRate.tile.best", "Best Month", "Bester Monat"),
    ("reports.savingsRate.tile.worst", "Worst Month", "Schlechtester Monat"),
    ("reports.savingsRate.chart.over_time", "Savings Rate Over Time", "Sparquote im Zeitverlauf"),
    ("reports.savingsRate.chart.monthly_incexp", "Monthly Income vs. Expenses", "Monatliche Einnahmen vs. Ausgaben"),
    ("reports.savingsRate.section.monthly_detail", "Monthly Detail", "Monatliche Details"),
    ("reports.savingsRate.col.savings", "Savings", "Ersparnis"),
    ("reports.savingsRate.col.rate", "Rate", "Quote"),
    ("reports.savingsRate.dataset.rate", "Savings Rate %", "Sparquote %"),
    ("reports.savingsRate.dataset.zero_line", "0% Line", "0%-Linie"),

    # ── R: Runway ─────────────────────────────────────────────────────────
    ("reports.runway.section.title", "Cash Runway Analysis — {currency}", "Liquiditätsreichweite — {currency}"),
    ("reports.runway.tile.net_worth", "Current Net Worth", "Aktuelles Nettovermögen"),
    ("reports.runway.tile.no_income", "Runway (no income)", "Reichweite (ohne Einkommen)"),
    ("reports.runway.tile.no_income_sub", "At avg {amt}/mo burn", "Bei ø {amt}/Monat Verbrauch"),
    ("reports.runway.tile.essentials", "Runway (essentials only, no income)", "Reichweite (nur Essenzielles, ohne Einkommen)"),
    ("reports.runway.tile.essentials_sub", "Cost-of-living only: {amt}/mo — {n} categories flagged non-essential (Settings → Categories)", "Nur Lebenshaltung: {amt}/Monat — {n} Kategorien als nicht-essenziell markiert (Einstellungen → Kategorien)"),
    ("reports.runway.tile.with_income", "Runway (with income)", "Reichweite (mit Einkommen)"),
    ("reports.runway.tile.recent", "Runway (last 3 mo pace)", "Reichweite (3-Monats-Tempo)"),
    ("reports.runway.tile.recent_sub", "Recent pace: {amt}/mo", "Aktuelles Tempo: {amt}/Monat"),
    ("reports.runway.net.positive", "Net positive — growing", "Netto positiv — wachsend"),
    ("reports.runway.net.burn", "Net burn {amt}/mo", "Netto-Verbrauch {amt}/Monat"),
    ("reports.runway.fmt.indefinite", "Indefinite", "Unbegrenzt"),
    ("reports.runway.fmt.na", "N/A", "k.A."),
    ("reports.runway.fmt.years_months", "{y}y {m}m", "{y}J {m}M"),
    ("reports.runway.fmt.months_only", "{m} months", "{m} Monate"),
    ("reports.runway.section.burn_rate", "Monthly Burn Rate (Last 12 Months)", "Monatlicher Verbrauch (Letzte 12 Monate)"),
    ("reports.runway.row.average", "Average", "Durchschnitt"),
    ("reports.runway.chart.burn_trend", "Burn Rate Trend", "Verbrauchs-Trend"),
    ("reports.runway.chart.projection", "12-Month Projection", "12-Monats-Prognose"),
    ("reports.runway.chart.now", "Now", "Jetzt"),
    ("reports.runway.chart.proj_balance", "Projected Balance", "Prognostizierter Saldo"),
    # Explainer block
    ("reports.runway.explainer.summary", "How these runway figures are calculated", "Wie diese Reichweiten-Zahlen berechnet werden"),
    ("reports.runway.explainer.net_worth", "<strong>Net worth</strong> = sum of your active own accounts (non-custody, non-pass-through), converted to {currency}.", "<strong>Nettovermögen</strong> = Summe deiner aktiven eigenen Konten (ohne Custody, ohne Pass-Through), umgerechnet in {currency}."),
    ("reports.runway.explainer.no_income", "<strong>Runway (no income)</strong> = net worth ÷ avg. monthly expenses over last 12 months. All operational expenses counted (custody and non-PnL excluded).", "<strong>Reichweite (ohne Einkommen)</strong> = Nettovermögen ÷ ø monatl. Ausgaben der letzten 12 Monate. Alle operativen Ausgaben zählen (Custody und non-PnL ausgeschlossen)."),
    ("reports.runway.explainer.essentials", "<strong>Runway (essentials only, no income)</strong> = net worth ÷ avg. monthly essential expenses. Uses the <code>essential</code> flag from Settings → Categories. Currently {n} {cat_word} flagged non-essential and excluded here: {list}{more}.", "<strong>Reichweite (nur Essenzielles, ohne Einkommen)</strong> = Nettovermögen ÷ ø monatl. essenzielle Ausgaben. Nutzt das <code>essential</code>-Flag aus Einstellungen → Kategorien. Aktuell sind {n} {cat_word} als nicht-essenziell markiert und hier ausgeschlossen: {list}{more}."),
    ("reports.runway.explainer.cat_singular", "category is", "Kategorie"),
    ("reports.runway.explainer.cat_plural", "categories are", "Kategorien"),
    ("reports.runway.explainer.more", ", …", ", …"),
    ("reports.runway.explainer.with_income", "<strong>Runway (with income)</strong> = net worth ÷ avg. monthly net burn (expenses − income). Infinite if net positive.", "<strong>Reichweite (mit Einkommen)</strong> = Nettovermögen ÷ ø monatl. Netto-Verbrauch (Ausgaben − Einnahmen). Unbegrenzt bei Netto-Plus."),
    ("reports.runway.explainer.recent", "<strong>Runway (last 3 mo pace)</strong> = net worth ÷ avg. last-3-months expenses. More sensitive to recent trend.", "<strong>Reichweite (3-Monats-Tempo)</strong> = Nettovermögen ÷ ø Ausgaben der letzten 3 Monate. Reagiert stärker auf aktuellen Trend."),
    ("reports.runway.explainer.footer", "<em>Edit which categories count as essential in Settings → Categories → Essential column.</em>", "<em>Welche Kategorien als essenziell gelten, lässt sich in Einstellungen → Kategorien → Essenziell-Spalte anpassen.</em>"),

    # ── R: Debt Overview ──────────────────────────────────────────────────
    ("reports.debtOverview.direction.owed_to_me", "owes you", "schuldet dir"),
    ("reports.debtOverview.direction.owed_by_me", "you owe", "du schuldest"),
    ("reports.debtOverview.direction.owed_to_me_past", "owed you", "schuldete dir"),
    ("reports.debtOverview.direction.owed_by_me_past", "you owed", "du schuldetest"),
    ("reports.debtOverview.card.owed_to_you", "Owed to You", "Dir geschuldet"),
    ("reports.debtOverview.card.you_owe", "You Owe", "Du schuldest"),
    ("reports.debtOverview.card.net_position", "Net Position", "Netto-Position"),
    ("reports.debtOverview.card.open_total", "Open / Total", "Offen / Gesamt"),
    ("reports.debtOverview.section.open", "Open Debts ({currency})", "Offene Schulden ({currency})"),
    ("reports.debtOverview.section.settled", "Settled Debts ({count})", "Beglichene Schulden ({count})"),
    ("reports.debtOverview.col.person", "Person", "Person"),
    ("reports.debtOverview.col.direction", "Direction", "Richtung"),
    ("reports.debtOverview.col.original", "Original", "Ursprünglich"),
    ("reports.debtOverview.col.remaining", "Remaining", "Verbleibend"),
    ("reports.debtOverview.col.paid", "Paid", "Bezahlt"),
    ("reports.debtOverview.col.progress", "Progress", "Fortschritt"),
    ("reports.debtOverview.col.created", "Created", "Erstellt"),
    ("reports.debtOverview.col.settled", "Settled", "Beglichen"),
    ("reports.debtOverview.col.note", "Note", "Notiz"),
    ("reports.debtOverview.col.amount", "Amount", "Betrag"),
    ("reports.debtOverview.chart.by_person", "Open Debts by Person", "Offene Schulden nach Person"),
    ("reports.debtOverview.chart.tooltip.owes_you", "Owes you", "Schuldet dir"),
    ("reports.debtOverview.chart.tooltip.you_owe", "You owe", "Du schuldest"),
    ("reports.debtOverview.empty.no_open", "No open debts.", "Keine offenen Schulden."),

    # ── R: Savings Goals History ──────────────────────────────────────────
    ("reports.savingsGoalsHistory.empty", "No active savings goals configured. Add goals in Settings → Goals.", "Keine aktiven Sparziele konfiguriert. Ziele in Einstellungen → Ziele anlegen."),
    ("reports.savingsGoalsHistory.section.title", "{name} — {currency}", "{name} — {currency}"),
    ("reports.savingsGoalsHistory.tile.current_target", "Current / Target", "Aktuell / Ziel"),
    ("reports.savingsGoalsHistory.tile.current_target_sub", "of {target} ({pct}%)", "von {target} ({pct}%)"),
    ("reports.savingsGoalsHistory.tile.ahead", "Ahead of Schedule", "Vor Plan"),
    ("reports.savingsGoalsHistory.tile.behind", "Behind Schedule", "Hinter Plan"),
    ("reports.savingsGoalsHistory.tile.pace_ahead", "{n} months ahead", "{n} Monate voraus"),
    ("reports.savingsGoalsHistory.tile.pace_behind", "{n} months behind", "{n} Monate zurück"),
    ("reports.savingsGoalsHistory.tile.needed_rate", "Needed Monthly Rate", "Benötigte Monatsrate"),
    ("reports.savingsGoalsHistory.tile.target_reached", "Target reached!", "Ziel erreicht!"),
    ("reports.savingsGoalsHistory.tile.months_remaining", "{n} months remaining", "{n} Monate verbleibend"),
    ("reports.savingsGoalsHistory.tile.deadline", "Deadline: {date}", "Frist: {date}"),
    ("reports.savingsGoalsHistory.chart.title", "Balance vs. Target Path", "Saldo vs. Zielpfad"),
    ("reports.savingsGoalsHistory.section.monthly_detail", "Monthly Detail", "Monatliche Details"),
    ("reports.savingsGoalsHistory.col.balance", "Balance", "Saldo"),
    ("reports.savingsGoalsHistory.col.delta_prior", "Δ vs. Prior", "Δ zum Vormonat"),
    ("reports.savingsGoalsHistory.col.target", "Target", "Ziel"),
    ("reports.savingsGoalsHistory.col.deviation", "Deviation", "Abweichung"),
    ("reports.savingsGoalsHistory.dataset.actual", "Actual Balance", "Tatsächlicher Saldo"),
    ("reports.savingsGoalsHistory.dataset.target_path", "Target Path", "Zielpfad"),
    ("reports.savingsGoalsHistory.dataset.target_100", "Target (100%)", "Ziel (100%)"),
]


def main() -> None:
    en = json.loads(EN_PATH.read_text(encoding="utf-8"))
    de = json.loads(DE_PATH.read_text(encoding="utf-8"))

    added = 0
    skipped_en = skipped_de = 0
    for key, en_val, de_val in NEW_KEYS:
        if key in en:
            skipped_en += 1
        else:
            en[key] = en_val
            added += 1
        if key in de:
            skipped_de += 1
        else:
            de[key] = de_val

    EN_PATH.write_text(
        json.dumps(en, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    DE_PATH.write_text(
        json.dumps(de, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Added {added} new key(s). Skipped (already present): EN={skipped_en}, DE={skipped_de}.")
    print(f"Total keys: EN={len(en)}, DE={len(de)}, parity={'OK' if set(en) == set(de) else 'BROKEN'}")


if __name__ == "__main__":
    main()
