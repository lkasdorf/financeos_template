"""B3.5.b — Add i18n keys for pages.js residual strings."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EN_PATH = ROOT / "config" / "i18n" / "en.json"
DE_PATH = ROOT / "config" / "i18n" / "de.json"

NEW_KEYS = [
    # ── Shared action labels & spinners ──────────────────────────────────
    ("common.actions.apply", "Apply", "Anwenden"),
    ("common.actions.create", "Create", "Anlegen"),
    ("common.spinner.saving", "Saving...", "Speichere …"),
    ("common.spinner.loading_ellipsis", "Loading…", "Lädt …"),

    # ── Debt modal ───────────────────────────────────────────────────────
    ("pages.debt.modal.title_add", "Add", "Hinzufügen"),
    ("pages.debt.modal.title_edit", "Edit", "Bearbeiten"),
    ("pages.debt.modal.title_noun", "Debt", "Schuld"),
    ("pages.debt.modal.person_placeholder", "PersonA", "PersonA"),
    ("pages.debt.direction.owed_by_me", "I owe them", "Ich schulde ihnen"),
    ("pages.debt.direction.owed_to_me", "They owe me", "Sie schulden mir"),
    ("pages.debt.note_placeholder", "Reason for the debt", "Grund für die Schuld"),
    ("pages.debt.autotx_hint", "A matching <strong>expense</strong> (you lend) or <strong>income</strong> (you borrow) TX will be created automatically unless you opt out.", "Eine passende <strong>Ausgabe</strong> (du verleihst) oder <strong>Einnahme</strong> (du borgst) TX wird automatisch erzeugt, außer du deaktivierst es."),
    ("pages.debt.btn.save_new", "Add", "Hinzufügen"),
    ("pages.debt.btn.save_edit", "Save", "Speichern"),
    ("pages.debt.err.person_amount_required", "Person and amount required", "Person und Betrag erforderlich"),
    ("pages.debt.btn.create_new", "Create new", "Neu anlegen"),
    ("pages.debt.spinner.toppingup", "Topping up...", "Stocke auf …"),
    ("pages.debt.confirm.delete", "Delete debt \"{id}\"?", "Schuld \"{id}\" löschen?"),
    ("pages.debt.autotx_hint_short", "A {type} transaction will be created automatically.", "Eine {type}-Buchung wird automatisch erzeugt."),
    ("pages.debt.type_word.expense", "expense", "Ausgaben"),
    ("pages.debt.type_word.income", "income", "Einnahmen"),
    ("pages.debt.err.amount_invalid", "Enter a valid amount", "Gültigen Betrag eingeben"),
    ("pages.debt.err.account_required", "Select an account", "Konto auswählen"),
    ("pages.debt.payments.empty", "No payments recorded yet.", "Noch keine Zahlungen erfasst."),

    # ── Reconciliation page ──────────────────────────────────────────────
    ("pages.recon.tab.reports", "Reports", "Berichte"),
    ("pages.recon.tab.import", "Import", "Import"),
    ("pages.recon.loading_reports", "Loading reconciliation data...", "Lade Abgleichs-Daten …"),
    ("pages.recon.empty.no_reports", "No reconciliation reports yet", "Noch keine Abgleichs-Berichte"),
    ("pages.recon.loading_bankfiles", "Loading bank files...", "Lade Bank-Dateien …"),
    ("pages.recon.empty.no_statements", "No bank statements found", "Keine Kontoauszüge gefunden"),
    ("pages.recon.btn.scan_unmatched", "Scan for Unmatched", "Nach nicht gematchten suchen"),
    ("pages.recon.spinner.scanning", "Scanning bank statement...", "Scanne Kontoauszug …"),
    ("pages.recon.label.already_booked", "Already Booked", "Bereits gebucht"),
    ("pages.recon.btn.book_selected", "Book Selected", "Auswahl buchen"),
    ("pages.recon.err.scan_failed", "Scan failed: {err}", "Scan fehlgeschlagen: {err}"),
    ("pages.recon.err.no_rows_selected", "No rows selected.", "Keine Zeilen ausgewählt."),
    ("pages.recon.err.fill_required", "Fill in payee and category for selected rows first.", "Zunächst Empfänger und Kategorie für ausgewählte Zeilen ausfüllen."),
    ("pages.recon.confirm.skipped_rows", "{skipped} row(s) have empty payee/category and will be skipped. Book {count} rows?", "{skipped} Zeile(n) ohne Empfänger/Kategorie werden übersprungen. {count} Zeilen buchen?"),
    ("pages.recon.spinner.booking", "Booking...", "Buche …"),
    ("pages.recon.err.generic_prefix", "Error: {err}", "Fehler: {err}"),
    ("pages.recon.ok.booked", "Booked {count} transactions. IDs: {ids}", "{count} Buchungen erfasst. IDs: {ids}"),
    ("pages.recon.err.booking_failed", "Booking failed: {err}", "Buchung fehlgeschlagen: {err}"),

    # ── Bulk operations (TX page) ────────────────────────────────────────
    ("pages.txbulk.alert.select_preset", "Select a preset first.", "Zuerst ein Preset auswählen."),
    ("pages.txbulk.confirm.delete_preset", "Delete preset \"{name}\"?", "Preset \"{name}\" löschen?"),
    ("pages.txbulk.confirm.delete_tx", "Delete {count} transactions? This cannot be undone.", "{count} Buchungen löschen? Kann nicht rückgängig gemacht werden."),
    ("pages.txbulk.err.delete_failed", "Bulk delete failed: {err}", "Massen-Löschung fehlgeschlagen: {err}"),
    ("pages.txbulk.alert.no_tags", "Select at least one tag to add or remove.", "Mindestens einen Tag zum Hinzufügen oder Entfernen auswählen."),
    ("pages.txbulk.spinner.applying", "Applying...", "Wende an …"),
    ("pages.txbulk.err.apply_failed", "Failed: {err}", "Fehlgeschlagen: {err}"),

    # ── Global Search ────────────────────────────────────────────────────
    ("pages.search.placeholder", "Type to search across transactions, accounts, payees and debts", "Tippen, um Buchungen, Konten, Empfänger und Schulden zu durchsuchen"),
    ("pages.search.empty.no_results", "No results for '{query}'", "Keine Treffer für '{query}'"),

    # ── Accessibility labels (row action buttons) ────────────────────────
    ("pages.actions.title.edit", "Edit", "Bearbeiten"),
    ("pages.actions.title.duplicate", "Duplicate", "Duplizieren"),
    ("pages.actions.title.delete", "Delete", "Löschen"),

    # ── Alerts page ──────────────────────────────────────────────────────
    ("pages.alerts.empty", "No alerts or warnings right now.", "Aktuell keine Benachrichtigungen oder Warnungen."),

    # ── Custom Reports (list + builder + runner) ─────────────────────────
    ("pages.custom.list.loading", "Loading…", "Lädt …"),
    ("pages.custom.list.err.load", "Failed to load custom reports: {err}", "Laden der Custom-Reports fehlgeschlagen: {err}"),
    ("pages.custom.list.empty", "No custom reports yet", "Noch keine Custom-Reports"),
    ("pages.custom.confirm.delete", "Delete custom report \"{name}\"?", "Custom-Report \"{name}\" löschen?"),
    ("pages.custom.err.duplicate_failed", "Duplicate failed: {err}", "Duplizieren fehlgeschlagen: {err}"),
    ("pages.custom.err.delete_failed", "Delete failed: {err}", "Löschen fehlgeschlagen: {err}"),
    ("pages.custom.builder.title_edit", "Editing report", "Report bearbeiten"),
    ("pages.custom.builder.title_new", "New report", "Neuer Report"),
    ("pages.custom.builder.loading", "Loading…", "Lädt …"),
    ("pages.custom.builder.err.refdata", "Failed to load reference data: {err}", "Referenzdaten konnten nicht geladen werden: {err}"),
    ("pages.custom.builder.heading_edit", "Edit Custom Report", "Custom-Report bearbeiten"),
    ("pages.custom.builder.heading_new", "New Custom Report", "Neuer Custom-Report"),
    ("pages.custom.builder.btn.save_edit", "Save changes", "Änderungen speichern"),
    ("pages.custom.builder.btn.save_new", "Create report", "Report anlegen"),
    ("pages.custom.builder.empty.no_items", "No {category} available.", "Keine {category} verfügbar."),
    ("pages.custom.builder.empty.no_accounts", "No accounts available.", "Keine Konten verfügbar."),
    ("pages.custom.builder.empty.no_matches", "No matches.", "Keine Treffer."),
    ("pages.custom.builder.confirm.discard", "Discard changes?", "Änderungen verwerfen?"),
    ("pages.custom.builder.err.name_required", "Name is required.", "Name ist erforderlich."),
    ("pages.custom.builder.err.custom_range", "Custom date range needs both From and To.", "Benutzerdefinierter Zeitraum benötigt Von- und Bis-Datum."),
    ("pages.custom.builder.err.save_failed", "Save failed: {err}", "Speichern fehlgeschlagen: {err}"),
    ("pages.custom.runner.loading", "Loading…", "Lädt …"),
    ("pages.custom.runner.err.load", "Failed to load reports: {err}", "Reports konnten nicht geladen werden: {err}"),
    ("pages.custom.runner.err.not_found", "Report not found.", "Report nicht gefunden."),
    ("pages.custom.runner.title.edit_tooltip", "Edit this report", "Diesen Report bearbeiten"),
    ("pages.custom.runner.empty.no_tx", "No transactions in this period.", "Keine Buchungen in diesem Zeitraum."),
    ("pages.custom.runner.dataset.income", "Income", "Einnahmen"),
    ("pages.custom.runner.dataset.expense", "Expense", "Ausgaben"),
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
