# FinanceOS — FAQ & Feature-Referenz

> Lebende Dokumentation jedes Features, jeder Konvention und jeder Eigenheit. Bei jedem Release auf Korrektheit geprüft.

---

## Überblick & Architektur

### Was ist FinanceOS?
Ein selbstgehostetes, CSV-basiertes persönliches Finanzsystem. Läuft als Single-File-Dashboard auf deinem eigenen Rechner, in deinem eigenen LAN oder VPN. Alle Daten liegen als CSV/JSON unter `data/`, Transaktionen werden über das Dashboard oder das Claude-Code-Terminal (TX-Freitext) eingegeben.

### Wo liegen die Daten?
- `data/` — alle CSV/JSON-Dateien (Transactions, Accounts, Categories, Tags, Scheduled, Debts, FX, Payees, Budgets, Goals, ATM Fees, Custom Reports)
- `data/backups/` — automatische Backups vor jedem Schreibvorgang
- `data/bank_imports/` — Bankauszüge (CSV/XLS) für die Reconciliation hier ablegen
- `docs/` — Referenz-Dokumente (Schema, TX-Guide, dieses FAQ, Deployment)
- `dashboard/` — Single-File-SPA (HTML + JS-Module + CSS)
- `scripts/` — Python-Tools (Serve, TX Engine, Backup, Cron-Jobs)
- `config/` — Branding, Features, Defaults, Smart-Defaults, Auth, i18n

### Welche Quelle ist verbindlich?
`docs/schema.md` ist die einzige Quelle der Wahrheit für die CSV-Struktur. Scripts lesen Konten/Kategorien ausschließlich aus `data/accounts.csv` und `data/categories.csv`.

---

## Transaktionen buchen

### Wie buche ich eine Transaktion?
Dashboard öffnen, **+ Add Transaction** klicken (oder den `+`-Floating-Button auf Mobil drücken). Datum, Betrag, Konto, Payee, Kategorie, optional Tags + Note ausfüllen, **Save**. Die CSV-Mechanik — Backup, atomarer Write, Git-Commit wenn ein Remote konfiguriert ist — läuft im Hintergrund.

Der Freitext-Terminal-Pfad `TX ...`, den ältere Versionen dieses Templates beworben haben, wurde in v1.2.0 entfernt. Manuelle Eingabe über das Formular ist jetzt der einzige unterstützte Pfad.

### Smart Defaults — was wird automatisch ausgefüllt?
- **Currency** wird vom gewählten Konto übernommen (Zeile in `data/accounts.csv`).
- **Category**-Vorschläge kommen aus der Payee-Historie (`data/payees.json`) — den gleichen Payee zweimal mit derselben Kategorie buchen, beim dritten Mal wird vorausgefüllt.
- **Auto-Tags** greifen, wenn du Regeln in `config/defaults.json` (`auto_tag.by_account` und `auto_tag.by_payee`) konfigurierst. Das Template kommt ohne Auto-Tag-Regeln — leg dir die an, die in deinen Daten häufig vorkommen.

### Wie mache ich einen Transfer?
Type auf **Transfer** stellen, Quell- und Zielkonto wählen, Betrag eintragen. Eine Zeile, keine Doppelbuchung.

### Wie splitte ich einen Beleg auf mehrere Kategorien?
Im Formular **Add split line** klicken, so oft wie nötig. Jede Zeile bekommt eigene Kategorie + Betrag; das Live-Sum-Badge wird grün, wenn die Splits den getippten Gesamtbetrag erreichen. Save schreibt eine Zeile pro Split, alle teilen sich `receipt_group` und (falls vorhanden) `receipt_url`.

### Wie füge ich Tags hinzu?
Im Formular aus dem Multi-Select-Tag-Chip auswählen, oder einen neuen Tag-Namen tippen und bestätigen. Neue Tags werden automatisch in `data/tags.csv` ergänzt.

---

## Pass-Through & Custody

### Was macht ein Pass-Through-Konto?
Ein Konto, das in `data/accounts.csv` als `type=pass_through` markiert ist (mit gefülltem `pass_through_payee`-Feld), erzeugt automatisch **zwei Zeilen** pro Buchung:

1. Die eigentliche Ausgabe (mit echter Kategorie, z.B. `Bills:Electricity`)
2. Eine Income-Gegenbuchung (`Income:<payee> Reimbursement`)

Der Pass-Through-Saldo bleibt also immer 0. Nützlich für Konten, die fremdes Geld verwalten, das du in deren Auftrag ausgibst — z.B. eine vom Arbeitgeber finanzierte Prepaid-Karte. **Der Setup-Wizard liefert keine Pass-Through-Konten aus;** füge sie nach der Installation über Settings → Accounts hinzu.

### Was ist ein Custody-Konto?
Ein Konto mit `owner != self`. Normale Buchungen, **keine** automatische Gegenbuchung. Der Saldo wird im Dashboard separat unter "Custody" angezeigt, **nicht** im Net Worth. Nützlich für Geld, das du für jemand anderen verwaltest (Erspartes der Partnerin, Taschengeld eines Kindes).

### Privat vs. Geschäftlich — wie unterscheidet das Dashboard?
Zwei Wege:

1. **Konto-getrieben** — wenn ein Konto als `type=pass_through` mit passendem `pass_through_payee` markiert ist, ist jede Buchung darauf implizit geschäftlich, und das Auto-Tag-System (`config/defaults.json` `auto_tag.by_account`) kann einen `BUSINESS_<entity>`-Tag draufsetzen.
2. **Tag-getrieben** — manuell einen `BUSINESS_<entity>`-Tag an eine Buchung hängen. Wird genutzt, wenn ein Privatkonto eine Geschäftsausgabe bezahlt hat (Reimbursement folgt später).

Der "Business vs. Personal"-Report und die per-Business Reimbursement-Reports basieren auf **`config/businesses.json`**. Jede Entity deklariert ihre Tags (`tag: 'BUSINESS_Acme'`), Konten (die Pass-Through-Aliase) und Income-Kategorien (`{salary: 'Income:Acme Salary', reimbursement: 'Income:Acme Reimbursement'}`). Das Template liefert `entities: []` aus, damit die Business-Reports gracefully auf "no entities configured" degradieren — Fork-User tragen eigene ein.

### Reimbursement-Regel
Pass-Through-Reimbursement-Income (z.B. `Income:Employer Inc. Reimbursement`) zählt **überall als reguläres Einkommen** — Dashboard, Cashflow-Chart, Reports. Nicht herausfiltern. Sonst wäre die Einnahmen/Ausgaben-Bilanz verzerrt (Ausgaben auf Pass-Through-Konten sind ja enthalten). Der Income-Report zeigt zusätzlich den Split "Real Income" vs. "Reimbursements" als Info-Kacheln, wenn Business-Entities konfiguriert sind.

---

## Scheduled Transactions

### Was ist das?
Vorlagen für wiederkehrende Buchungen in `data/scheduled.csv`. Die Engine führt sie **nicht** automatisch aus — nur auf Abruf.

### Befehle
- `SCHED` → fällige Einträge als Batch-Vorschau, Buchung mit `y` (Claude-Code-Terminal)
- `SCHED LIST` → alle aktiven Scheduled-Einträge
- `SCHED ALL` → inklusive `active=false`

### Dashboard-Button (rc.12+)
Wenn mindestens ein Eintrag `next_run <= today` hat, erscheint im Header der "Upcoming Payments"-Sektion ein **"Run N due now"**-Button. Klick → Modal mit voller TX-Vorschau (jeder fällige Eintrag als per Default angekreuzte Zeile inkl. Pass-Through-Gegenbuchungen). Zeilen abwählen, die übersprungen werden sollen → "Book selected" startet den atomaren Backup + Append + Git-Commit-Flow. Idempotent (zweimal hintereinander klicken findet beim zweiten Mal nichts mehr fällig). Liegt hinter `POST /api/scheduled/preview-due` und `POST /api/scheduled/run-due` — siehe "Lokal vs. Always-on" weiter unten, warum der Button bei Setups ohne Pi-Cron wichtig ist.

### Frequency-Format
- `monthly:15` → am 15. jedes Monats
- `monthly:last` → letzter Tag des Monats
- `weekly:<weekday>` → mon/tue/wed/thu/fri/sat/sun
- `yearly:MM-DD` → einmal jährlich am MM-DD
- `quarterly:MM-DD` → alle drei Monate am DD; MM legt das Quartals-Set fest (`03-15` → Mar/Jun/Sep/Dec, `01-01` → Jan/Apr/Jul/Oct)

### Nach einem Fire
`last_run` wird aktualisiert, `next_run` auf das nächste Vorkommen gerollt. Git-Commit deckt `transactions.csv` + `scheduled.csv` zusammen ab.

### Pflege
- **Neu:** Zeile in der CSV anhängen, `sched_id` läuft fortlaufend
- **Deaktivieren:** `active=false`
- **Löschen:** nur wenn die Vorlage komplett verschwinden soll
- **Ändern:** direkt in der CSV editieren

---

## ATM-Abhebungen

### Wie buche ich eine Abhebung?
`TX atm 200 checking`. Die Engine liest `data/atm_fees.csv`, findet die passende Zeile per `(bank, amount)` und erzeugt die Buchungen:
1. Transfer (Betrag) Bank → Cash, Tag `ATM`
2. `fee_net` als Expense, Kategorie `Fees:Bank Fees`, kein Tag
3. `levy` als Expense (falls > 0), kein Tag
4. VAT = `fee_net × vat_rate`, kein Tag (nur wenn die Bank VAT auf Gebühren erhebt)

### Wo konfiguriere ich Gebühren?
`Settings → ATM Fees` im Dashboard. Felder: Bank, Amount, Currency, Fee (net), Levy, VAT rate, Note. Der Total wird live in der Tabelle angezeigt.

### Unbekannter Betrag?
Die Engine fragt zurück: "Amount X is not in `atm_fees.csv` — provide the fees manually or create a preset?"

---

## Konten

### Konto-Typen
- `bank` / `cash` / `savings` / `mobile_money` / `credit_card` (Self, zählen ins Net Worth)
- `pass_through` (Saldo = 0, Auto-Gegenbuchung)
- Custody (`owner != self`, separate Anzeige)

### Konten pflegen
`Settings → Accounts`: alias, name, currency, type, owner, status (active/archived), pass-through payee, initial balance.

### Salden ansehen
- `BALANCE` im Terminal → aktuelle Salden aus `accounts.csv` + `transactions.csv`
- Dashboard → `Accounts`-Seite mit Detail-View pro Konto

### Direkt aus einem Konto buchen
Jede Konto-Detailseite hat einen großen primären **"+ Add TX"**-Button unter der Saldo + Meta-Zeile. Klick →

1. Die Add-TX-Seite öffnet sich mit dem **Konto vorausgefüllt** und einem **`← Back`-Button** oben.
2. Wie gewohnt buchen.
3. Nach erfolgreichem Commit → **automatischer Sprung zurück zur gleichen Konto-Detailseite**, mit aktualisiertem Saldo und der neuen Transaktion in der Liste.

Der kleinere "+ Add TX"-Button rechts oben (neben Export XLSX) bleibt als Quick-Access-Shortcut bestehen, falls du weit nach unten gescrollt hast.

**Verhalten des Back-Buttons:** erscheint nur, wenn du tatsächlich von einer Konto-Detailseite kommst. Wenn du dazwischen über die Sidebar, den FAB oder die `n`-Taste auf die Add-TX-Seite wechselst, wird der Rückkehr-Kontext verworfen.

---

## Kategorien & Tags

### Kategorien-Struktur
Hierarchisch via `:` — `Food`, `Food:Groceries`, `Food:Dining out`. Definiert in `data/categories.csv` mit den Feldern `path`, `type` (income/expense/transfer), `active`, `note`, `pnl`, `essential`.

### `essential`-Flag
Markiert eine Kategorie als Lebenshaltungskosten (z.B. Food, Bills, Transport). Wird vom Cashflow-Forecast (F3-Report) und den "pure cost-of-living"-Berechnungen verwendet.

### `pnl`-Flag
Legt fest, ob eine Kategorie in den P&L-Reports (Income Statement) erscheint. `false` = Transfer / interner Geldfluss, `true` = echtes Einkommen/Ausgabe.

### Tags pflegen
`Settings → Tags` — Tag + optionale Beschreibung. Eigene definieren; das Empty-Start-Template kommt ohne Preset-Tags.

### Kategorien editieren
Essential + pnl können im Edit-Modal gesetzt werden. Änderungen erzeugen einen Auto-Commit, das Dashboard re-rendert die aktive Seite, damit Reports die neuen Werte sofort zeigen.

---

## Reports

### Standard-Reports (kategorisiert)
**Income:**
- Income Analysis — Real Income vs. Reimbursements (Stacked Chart)
- Income vs. Expense Summary — Monat / Jahr, Net Balance, Savings Rate
- Income Sources Breakdown — detaillierter Split

**Expenses:**
- Bills Overview — Rent / Electricity / Water / Internet
- Category Deep Dive
- Seasonal Heatmap
- Bank Fees
- Subscriptions

**Forecast:**
- **F3 Cashflow Forecast** — 4-Layer-Modell: Essential-Cost-Median pro Monat + Pass-Through-Net + variables Einkommen + Scheduled

### Custom Reports
User-definierte Reports per Filter-Builder — speicherbar, duplizierbar, mit eigenem Render-Pfad. Konfiguration in `data/custom_reports.json`. Hinter dem `custom_reports`-Feature-Flag.

### Report-Konsistenz
Alle Expense-Reports verwenden dieselbe Total-Logik wie das Dashboard (inkl. Reimbursements als Einkommen).

### Warum ist mein Dining-Out / Bills / Vice / AI-Costs / etc. -Report leer?
Acht Reports filtern Transaktionen nach Kategorie und suchen nach den kanonischen Kategorie-Strings (`Food:Dining out`, `Bills:Rent`, `Subscriptions:AI`, `Leisure:Alcohol|Smoking|Vaping`, `Fees:*`, `Other Expenses:Cash Discrepancy`, `Automobile:*`, plus die FIXED_PREFIXES-Liste hinter Discretionary vs. Fixed). Wenn du eine Kategorie umbenannt hast — z.B. "Restaurants" statt "Food:Dining out" — sieht der Report keine passenden Zeilen.

**Fix:** **Settings → Reports** öffnen und deine Kategorie-Namen den Report-Buckets zuordnen (Multi-Select pro Report bzw. pro Bucket bei Bills/Automobile). Der Setup-Wizard Step 6 stellt beim ersten Start die gleichen Fragen. Save persistiert nach `config/reports.json`; Reports re-rendern sofort mit dem neuen Mapping.

### Wie benenne ich Kategorien um, ohne Reports kaputtzumachen?
Zwei Optionen:

1. **In `data/categories.csv` umbenennen, dann Settings → Reports updaten.** Die kategorie-getriebenen Reports lesen die In-Memory-`REPORTS_CONFIG`, also funktioniert es, sobald der neue Name im betroffenen Report-Bucket steht. Bestehende Transaktionen behalten ihre alte Kategorie, bis du sie bulk-updatest — Settings → Categories hat einen Rename-Helper.
2. **Custom Report bauen.** Settings → Custom Reports → Add report → Filter `category equals "Restaurants"`. Save. Der ursprüngliche "Dining Out"-Report zeigt für dich Null (oder bleibt als Doku stehen), und dein Custom Report tut das Richtige.

### Welche Reports sind NICHT von Renames betroffen?
Net Worth Trend, Top Payees, Income vs. Expense Summary, Account Balances Over Time, Cashflow Forecast, Year-over-Year Comparison, Seasonal Heatmap, Monthly Comparison, Largest Transactions, FX Exposure, Cash vs. Digital, Weekday vs. Weekend, Savings Rate Trend und die meisten "Overview"-Reports — sie aggregieren nach Betrag/Konto/Datum/Payee, nie nach Kategorie-String.

### Schema von `config/reports.json`
- **Flat reports** (Dining Out, AI Costs, Vice Spending, Bank Fees): `{ categories: [...], match?: 'exact' | 'prefix' }`. `match` defaultet auf `'exact'`. Mehrere Kategorien matchen per OR.
- **Bucket reports** (Bills, Automobile): `{ buckets: { <bucketId>: { categories: [...] }, ... } }`. Bucket-IDs sind stabil (rent / electricity / petrol / maintenance / …) — der Report verwendet sie für Spaltennamen, Farben und i18n-Labels. Kategorien pro Bucket: OR-Match.
- **Cash Discrepancy:** `{ expense_categories: [...], income_categories: [...] }`. Zwei separate Sets, damit der Report ein "found money"-Income von einem "lost money"-Expense unterscheiden kann.
- **Discretionary vs. Fixed:** `{ fixed_prefixes: [...] }`. Reine Präfix-Liste. Alles, was mit einem dieser Präfixe anfängt, ist "fixed", der Rest "discretionary".

---

## Updates

### Wie werde ich über Updates benachrichtigt?
Auf der GitHub-Repo-Seite oben rechts `Watch` → *Custom* → *Releases* anhaken. Du bekommst eine E-Mail bei jedem neuen Tag. RSS-Feed: `https://github.com/<owner>/financeos/releases.atom`.

### Was bedeutet jeder Version-Bump?
- **Patch** (`v1.2.x → v1.2.y`) — nur Bugfixes, einfach `git pull && restart`.
- **Minor** (`v1.x.0 → v1.y.0`) — backwards-kompatible neue Features. Release Notes lesen; meistens kannst du direkt pullen.
- **Major** (`v1.x → v2.0.0`) — Breaking Changes. Das Release liefert ein Migrations-Script, die Notes beschreiben die Schritte.

### Wie update ich, ohne Daten zu verlieren?
Bind-Mounts (Docker) bzw. `data/` und `config/` außerhalb des Install-Pfads (lokales Python) trennen deinen State von App-Code. Update-Schritte:

- **Docker / Compose:** `git pull && docker compose down && docker compose up -d --build`
- **Synology Container Manager:** *Build* auf das Projekt klicken — DSM zieht frischen Code, baut neu, restartet. Volumes bleiben unangetastet.
- **Unraid:** *Force Update* auf den Container in der WebUI.
- **Lokales Python:** `git pull && pip install -r requirements.txt && restart`

### Sollte ich vor einem Update sichern?
Bei Patch + Minor: nicht zwingend nötig, aber billig. **Settings → Backup → Export full data ZIP** ist ein One-Click-Voll-Snapshot. Bei Major-Updates: ja, immer.

### Was wenn ein Release etwas kaputt macht?
`git checkout <previous-tag>` und neu starten. Bind-mounted Daten bleiben intakt.

---

## PDF-Export

### Wie?
In der Report-Detail-View **"Export PDF"** klicken → Optionen-Modal (Orientation, Page Size, Include Charts) → `window.print()` öffnet den System-Print-Dialog. Kein Extra-Tool.

### Was kann konfiguriert werden?
- **Orientation:** Portrait / Landscape
- **Page Size:** A4 / Letter / A3
- **Include Charts:** Yes / No
- Die letzte Auswahl wird für die Session gemerkt.

### Professionelle Typografie
Financial-Report-Dichte: 8 pt Body, 12 pt Title, 7.5 pt (Portrait) / 8 pt (Landscape) Tabellen, 0.25 pt dünne + 0.5 pt schwere Linien.

### Auto-Fit
Breite Tabellen (z.B. 14-spaltige Income Sources) werden automatisch per `transform: scale()` auf Seitenbreite skaliert — Minimum 55%.

### Dark-Mode-Caveat
Chart-Texte werden in dunklen Farben gerendert, wenn Dark Mode aktiv ist. Workaround: vor dem Export auf das Light-Theme wechseln.

---

## Dashboard

### Navigation
SPA per Hash-Routing (`#dashboard`, `#reports`, `#accounts`, …). Sidebar links, "More"-Menü auf Mobil. Konto-Detail per `#account:<alias>`.

### Layout & Breiten auf großen Monitoren
Das Dashboard und jede andere Seite sind **linksbündig** zur Sidebar. Content-Breite passt sich an den Viewport an:

| Viewport | max-width |
|---|---|
| `< 1800px` (1080p / 1440p) | 1400px |
| `≥ 1800px` (QHD / 2K) | 1600px |
| `≥ 2200px` (WQHD / 4K / Ultrawide) | 1800px |

### Net Worth
Die Summe aller Self-Konten in der aktiven Display-Currency. Pass-Through-Salden sind per Definition 0; Custody-Konten werden separat angezeigt.

### Currency Switcher
Im Header. Live-Kurse vom in `config/defaults.json` konfigurierten FX-Provider, Fallback auf `data/fx_rates.csv`. Historie in `data/fx_rates_history.csv`.

### Sidebar-Module
Add TX · Dashboard · Reports · Accounts · Transactions · Custom Reports · Alerts · Debts · Reconciliation · Settings · **FAQ**

(Module hinter abgeschalteten Feature-Flags werden ausgeblendet.)

### Mobile-Navigation (Smartphone / Tablet)
Unterhalb von 768 px Breite übernimmt das Mobile-Layout mit **Top-Bar + Hamburger-Drawer**:
- **Top-Bar oben fest:** Hamburger links, Brand mittig, optional ein Alerts-Punkt rechts
- **Drawer schiebt von links rein** (280 px breit, max 80 vw) mit voller Nav-Liste
- **FAB für Add TX** — runder 56 px Accent-Button unten rechts (fixed, immer mit dem Daumen erreichbar)
- **Drawer schließt:** Tap auf den Backdrop, ESC, Tap auf einen Nav-Eintrag
- **Body-Scroll wird gesperrt**, solange der Drawer offen ist

---

## Reconciliation (Adapter-System)

### Zweck
Monatlicher Abgleich von Bankauszügen gegen `transactions.csv`. Bankauszug-Dateien liegen unter `data/bank_imports/`.

### Ablauf
`RECON` → Statement parsen → Totals/Balance-Check → Zeilen-Matching nach (date, amount) → Differenzen erklären → Report als `reconciliation_YYYY_MM.md` schreiben → `recon_index.json` aktualisieren.

### Adapter-Plugin-System

Die Bankauszug-Logik ist über `scripts/reconciliation/` pluggable. Jede Bank ist ein Adapter (Subklasse von `BankAdapter`); das Account → Adapter-Mapping läuft über `config/reconciliation.json`.

Das Template liefert einen Default-Adapter aus:

| Adapter | Datei | Format | Zweck |
|---|---|---|---|
| `csv_generic` | `scripts/reconciliation/csv_generic.py` | `.csv` | konfigurierbare Spalten (date, details, amount oder debit+credit), Datumsformat, Dezimaltrenner |

**Eine neue Bank hinzufügen:**
1. Neues Modul `scripts/reconciliation/<bank>.py` mit Subklasse von `BankAdapter` (siehe `base.py`)
2. `parse(filepath)` + `match_payee(details)` implementieren, Klassen-Attribute setzen (`name`, `display_name`, `file_extensions`, `data_subdir`, `default_account`, `default_currency`)
3. In `ADAPTERS` in `scripts/reconciliation/__init__.py` registrieren
4. Account-Mapping in `config/reconciliation.json` ergänzen

### Erwartbare Differenzen
- Datums-Verschiebung (das Dashboard bucht manchmal einen Tag vor dem Posting-Date der Bank)
- Splits (Bank = 1 Zeile, FinanceOS = mehrere)
- Rundung aus Import-Quellen

### Dashboard-View
`#reconciliation` zeigt jeden monatlichen Report nach Jahr gruppiert mit Details. Drei Recon-Endpoints hinter dem `crdb_recon`-Feature-Flag (ja, der Flag heißt nach dem ursprünglichen Referenz-Adapter — aus Kompatibilitätsgründen behalten): `POST /api/recon/adapters` (Liste der installierten Adapter mit Metadaten), `POST /api/recon/files?account=` (Statement-Discovery pro Adapter), `POST /api/recon/suggestions` (mit optionalem `account` im Body).

---

## Debts & Third Party

### Debts (Kredite)
`data/debt_payments.csv` + Dashboard-Seite `#debts`. Features:
- Teilzahlungen, Top-Up
- Fremdwährungs-Support
- Auto-TX-Generierung bei Zahlung
- Zahlungs-Historie pro Schuld

Hinter dem `debt_tracking`-Feature-Flag.

### Third Party (fremdes Geld)
`data/third_party.csv` — offene Vorschüsse für Dritte. Der `THIRD PARTY`-Befehl listet offene Einträge.

---

## Payees

### Auto-Learn
Das Dashboard lernt Payees automatisch aus neuen Buchungen — Eintrag in `data/payees.json`. Liste periodisch über Settings → Payees reviewen.

### Gruppen
Payees können gruppiert werden (z.B. "Utilities" = Electric Co + Water Co + Internet). CRUD über das Dashboard.

### Settings-Tab
`Settings → Payees` — Liste aller Payees mit Edit/Delete/Merge.

---

## Quick Expenses

### Chips unter "Add TX"
Preset-Chips für häufige Cash-Ausgaben (z.B. "Coffee", "Lunch"). Ein Klick öffnet das Add-TX-Formular vorausgefüllt.

### Konfiguration
`Settings → Quick Expenses`. Felder: Name (Chip-Label), Account, Payee, Category, Tags, Type, Note, Active. Hinter dem `quick_expenses`-Feature-Flag.

---

## Budgets & Savings Goals

### Budgets
Pro Kategorie + Monat — `Settings → Budgets`. Das Dashboard-Widget zeigt den Month-to-Month-Tracker mit Prozent-Bars.

### Savings Goals
Ziele mit Betrag + Deadline — `Settings → Goals`. Das Dashboard zeigt den Fortschritt.

---

## Settings-Tabs (Übersicht)

| Tab | Zweck |
|---|---|
| Categories | CRUD für `categories.csv` inkl. pnl + essential |
| Tags | CRUD für `tags.csv` |
| Scheduled | CRUD für `scheduled.csv` |
| Quick Expenses | CRUD für `quick_expenses.csv` |
| ATM Fees | CRUD für `atm_fees.csv` |
| Payees | CRUD für `payees.json` + Gruppen |
| Accounts | CRUD für `accounts.csv` |
| Currency | Default-Display-Currency |
| FX Rates | manuelle Rate-Overrides + Historie |
| Goals | Savings-Goals |
| Budgets | Kategorie-Budgets pro Monat |
| Backup | manueller Backup-Trigger + voller ZIP-Download |

(Tabs hinter abgeschalteten Feature-Flags werden ausgeblendet.)

---

## Always-on Deployment

### Zweck
FinanceOS auf einem 24/7-Host laufen lassen (Single-Board-Computer, NAS, VPS) mit bidirektionalem Git-Sync zwischen lokalem PC und Always-on-Host. Vollständiger Setup-Guide: **`docs/deployment.md`**.

### Cron-Jobs (opt-in)
Das Repo liefert mehrere Cron-Scripts aus, die du via crontab auf deinem Always-on-Host einbindest:

- `cron_commit.py` — alle 5 Minuten ein bidirektionaler Git-Sync: fetch → rebase → committe pending data/ → push. Der Service wird **nicht** automatisch nach Code-Pulls neu gestartet; das wurde entfernt, weil es aktive Dashboard-Sessions während PC-seitiger Codings unterbrach. Manuell neu starten nach einem Code-Push: `sudo systemctl restart <unit>` (oder `ssh <host> 'sudo systemctl restart <unit>'` von der Dev-Maschine).
- `cron_fx.py` — täglicher FX-Rate-Snapshot
- `cron_sched.py` — täglicher Scheduled-Due-Check
- `cron_integrity.py` — täglicher Schema/Balance-Check

Siehe `docs/deployment.md` für die vollständige crontab + systemd-Unit + sudoers-Snippet.

---

## Lokal vs. Always-on

### Was funktioniert ohne Always-on-Host?
Alles im Dashboard läuft komplett client-side, sobald `serve.py` hochgefahren ist. Transaktionen anlegen, Kategorien editieren, Reports anschauen, Reconciliations laufen lassen, PDFs exportieren — all das funktioniert, wenn du `python scripts/serve.py` bei Bedarf startest und beendest, wenn du fertig bist. Es ist kein Background-Worker nötig.

### Was braucht einen Always-on-Host oder ein tägliches Ritual?
Drei Dinge hängen an zeitbasierten Events, die nicht passieren, wenn nichts zum richtigen Zeitpunkt läuft:

| Feature | Always-on-Verhalten | Lokal-Auswirkung | Workaround |
|---|---|---|---|
| **Scheduled Transactions** | `cron_sched.py` feuert täglich zur konfigurierten Zeit und bucht fällige Einträge automatisch | Wenn der Laptop aus ist, wenn ein Eintrag fällig wird, bleibt er "overdue" bis zum nächsten Klick auf den Dashboard-Button **Run N due now** | Beim Arbeitsstart einmal täglich den Dashboard-Button klicken. Idempotent + atomar. |
| **FX-Rate-Historie** | `cron_fx.py` snapshottet Kurse täglich nach `data/fx_rates_history.csv` | Tage, an denen der Laptop aus ist, bekommen keinen Snapshot → Zeitreihen-Reports zeigen Lücken für diese Daten | Entweder Lücken akzeptieren (der aktuelle Kurs wird auf jeder Page-Load weiter live gefetcht), oder `python scripts/cron_fx.py` per Windows Task Scheduler / cron / launchd schedulen |
| **Integrity-Checks** | `cron_integrity.py` läuft nachts, surft Schema/Balance-Drift in die Alerts-Seite | Keine Alerts, solange du es nicht manuell laufen lässt | `python scripts/cron_integrity.py` nach größeren Edits laufen lassen oder lokal schedulen |

### Was ist mit dem Live-FX-Kurs (Currency Switcher)?
Der funktioniert lokal ohne Cron. Das Dashboard fetcht den aktuellen Kurs vom konfigurierten FX-Provider (`config/defaults.json` → `currency.fx_api_url`) bei jedem Page-Load. Solange du Internet hast, ist die Umrechnung frisch. Die History-CSV ist das Einzige, wofür der Cron verantwortlich ist, und sie ist nur für Zeitreihen-Charts relevant, die mehrere Tage spannen.

### Empfohlenes Setup für reine Laptop-User
1. Starte `python scripts/serve.py`, wenn du dich zum Arbeiten hinsetzt (oder leg dir einen Desktop-Shortcut an).
2. Klick auf **Run N due now** im Dashboard einmal täglich, falls du Scheduled-Einträge hast — das ersetzt den Pi-Cron.
3. Mach dir keine Sorgen um die FX-Historie, solange dich die FX-Exposure / Zeitreihen-Reports nicht aktiv stören. Falls doch, richte den Windows Task Scheduler ein:
   ```
   schtasks /create /tn "FinanceOS FX snapshot" /tr "python C:\path\to\financeos\scripts\cron_fx.py" /sc DAILY /st 08:00
   ```
   oder unter Linux/macOS in die crontab:
   ```
   0 8 * * * cd /path/to/financeos && /path/to/.venv/bin/python scripts/cron_fx.py >> logs/cron_fx.log 2>&1
   ```

### Warum lässt `serve.py` die Crons nicht intern laufen?
Steht auf der v1.4.0-Roadmap (`apscheduler`-Thread innerhalb des Prozesses). Bis dahin bleiben die Cron-Scripts extern, damit der Server simpel bleibt und ein Crash in der Cron-Logik nicht das Dashboard mitreißen kann. Erlaubt außerdem Mix-and-Match (z.B. Cron auf dem Pi, Dashboard auf dem Laptop, beide zeigen über ein gemeinsames Volume auf dasselbe `data/`).

---

## Harte Regeln

### Backup-Pflicht
Vor jedem Schreibvorgang auf `data/*.csv` läuft `scripts/backup.py`. Keine Ausnahmen.

Drei Backup-Layer im Live-System:
1. **Rolling Backups** (`data/backups/*.csv`) — automatisch vor jedem Schreibvorgang, max. 30 Generationen pro Datei, ältere werden automatisch gelöscht. Settings → Backup-Tab → "Backup Transactions/Scheduled/Debts/All" triggert sie auch manuell.
2. **Voller ZIP-Download** (Settings → Backup → "Download full backup (.zip)") — packt das gesamte `data/`-Verzeichnis (ohne `data/backups/` und `__pycache__/`) als DEFLATE-ZIP mit UTC-Timestamp im Dateinamen. Endpoint: `POST /api/backup/export`.
3. **Git** (siehe nächster Punkt) — jeder Schreibvorgang wird committed und gepusht.

### Git nach jedem Schreibvorgang
`git add` + Commit mit aussagekräftiger Message + Push (wenn ein Remote konfiguriert ist).

### Offline-Queue
Jede TX-Eingabe landet **zuerst** in `data/prompt_log.csv` (`booked=False`), danach wird sie geparst/gebucht. Bei Erfolg `booked=True`.

### Schema-Treue
`docs/schema.md` ist verbindlich. Scripts lesen Konten/Kategorien nur aus `accounts.csv` und `categories.csv`.

### Versionsschema
Semantic Versioning. Bump nur bei user-relevanten Änderungen; Daten-only-Commits bumpen die Version nicht.

### Antwortstil (Claude-Integration)
Kurz, strukturiert, ohne Floskeln. Bei Buchungen: Vorschau → Bestätigung → Commit-Message.

---

## Feature-Flags (config/features.json)

### Zweck
Top-Level-Features lassen sich ohne Code-Änderungen über `config/features.json` ein/ausschalten. So gebaut, dass eine frische Installation klein und fokussiert bleibt; opt-in für Features, sobald du sie brauchst.

### Verfügbare Flags

Sieben boolesche Flags. Das Empty-Start-Template liefert die optionalen mit `false` und die Core-Flags mit `true` aus.

| Flag | Was wird gegated |
|---|---|
| `metals` | Precious-Metals-Seite (`#metals`), Sidebar-Nav-Eintrag, Metals-CSVs in `data/`, Spot-Cron, Metals-Loader beim Boot. **Im Template per Default aus.** |
| `pwa` | Static-Serving unter `/pwa/*` (Index, Service Worker, Manifest, App-JS). **Im Template per Default aus.** |
| `crdb_recon` | Reconciliation-Seite (`#reconciliation`), Sidebar-Nav, `/api/recon/*`-Endpoints, Files unter `/data/bank_imports/*` |
| `debt_tracking` | Debts-Seite (`#debts`), Sidebar-Nav, `/api/debts/*`-Endpoints |
| `quick_expenses` | Quick-Expense-Chips unter Add TX, Settings-Tab "Quick Expenses", `/api/quickexp/*`-Endpoints |
| `custom_reports` | Custom-Reports-Seite (`#custom-reports`), Sidebar-Nav, `/api/custom-reports/*`-Endpoints |
| `scheduled_tx` | Settings-Tab "Scheduled" für SCHED-Vorlagen, `/api/scheduled/*`-Endpoints. Der `SCHED`-CLI-Befehl ist unabhängig (funktioniert weiter) |

API-Calls gegen ein OFF-Feature liefern `404 {"error": "feature '<flag>' disabled"}`. UI-Elemente werden per `data-feature`-Attribut (Sidebar/Pages) oder Code-Filter (Settings-Tabs, Chips) ausgeblendet.

### Toggle
`config/features.json` editieren, Wert auf `true`/`false` setzen, Server neu starten (Python cached pro Prozess). Beispiel:

```json
{
  "metals": false,
  "pwa": false,
  "crdb_recon": true,
  "debt_tracking": true,
  "quick_expenses": true,
  "custom_reports": true,
  "scheduled_tx": true
}
```

### Graceful Default
Fehlt die Datei oder ein Flag-Key, ist der Default `true` — das Dashboard bleibt auch ohne die Config funktionsfähig.

---

## Defaults (config/defaults.json)

### Zweck
System-Layer-Konfiguration für Werte, die ohne Code-Änderung verstellbar sein sollen: Server-Port, Backup-Retention, Currency-Defaults, FX/Metals-API-URLs, Auto-Tag-Regeln, Pass-Through-Reimbursement-Mappings.

### Struktur

```json
{
  "server":   { "default_port": 8080, "default_bind": "127.0.0.1", "dashboard_path": "/dashboard/" },
  "backup":   { "max_per_file": 30 },
  "currency": {
    "primary": "USD",
    "fallback_tzs_per_usd": 1,
    "fx_api_url": "https://open.er-api.com/v6/latest/USD",
    "metals_spot_api_url": "https://data-asg.goldprice.org/dbXRates/EUR"
  },
  "auto_tag": {
    "by_account": {},
    "by_payee":   {}
  },
  "pass_through": {
    "reimbursement_categories": {}
  }
}
```

### Wo jeder Key konsumiert wird

| Key | Konsumiert von |
|---|---|
| `server.default_port` / `default_bind` / `dashboard_path` | `scripts/serve.py` (CLI-Defaults + URL-Building) |
| `backup.max_per_file` | `scripts/backup.py` (Retention für `data/backups/`) |
| `currency.primary` | `dashboard/core.js` `state.primaryCurrency` |
| `currency.fx_api_url` | `dashboard/core.js` + `scripts/cron_fx.py` |
| `auto_tag.by_account` / `by_payee` | `scripts/tx_engine.py` `apply_auto_tags()` |
| `pass_through.reimbursement_categories` | `scripts/tx_engine.py` `generate_pass_through_line()` |

### Toggle / customisen
Datei editieren, Server neu starten (und Cron, falls relevant). Auf dem Backend cached `lru_cache` den Inhalt einmal pro Prozess. Im Dashboard läuft `loadDefaults()` beim Boot und überschreibt `window.DEFAULTS` — ein Page-Reload reicht.

### Graceful Default
Fehlt die Datei oder ein Sub-Key, übernehmen die hardcoded Fallbacks. Keine Crashes.

---

## Smart Defaults (config/smart_defaults.json)

### Zweck
UX-Layer für nutzer-zentrische Defaults: in welcher Display-Currency starten.

```json
{
  "ui": { "default_display_currency": "USD" }
}
```

### `ui.default_display_currency`
Die Display-Currency beim **ersten** Dashboard-Load (solange `localStorage['lp-default-currency']` noch leer ist). Sobald der User den Currency-Switcher betätigt, gewinnt `localStorage`.

### Graceful Default
Wie `defaults.json`: fehlt die Datei → hardcoded Fallbacks greifen, die App läuft weiter.

---

## i18n (config/i18n/)

### Zweck
Multi-Language-Support für die Dashboard-UI ohne Build-Step oder Framework. Pattern wie `features.json` / `defaults.json`: eine JSON-Datei pro Locale, der Loader holt sie beim Boot, englische HTML-Defaults bleiben als Fallback im Markup stehen.

### Struktur

```
config/i18n/
  en.json    ← Default, immer vorhanden
  de.json    ← (optional, Fork-User ergänzen)
  pl.json    ← (optional, dito)
```

Format: flache Dot-Path-Keys, Werte als Strings. Beispiel:

```json
{
  "nav.dashboard": "Dashboard",
  "settings.tab.language": "Sprache",
  "settings.language.heading": "Interface-Sprache"
}
```

Platzhalter via `{name}` werden unterstützt (`t('foo.bar', { count: 3 })` → `"Foo: 3"`, wenn der String `"Foo: {count}"` ist).

### Sprach-Auswahl
**Settings → Sprache** zeigt ein Dropdown mit jedem Code aus `window.AVAILABLE_LOCALES`. Die Auswahl wird in `localStorage['lp-locale']` persistiert und überschreibt die Browser-Default-Locale. Bei Wechsel reloadet das Dashboard, damit jeder dynamische Render die neue Sprache aufgreift.

Locale-Resolution-Reihenfolge:
1. `localStorage['lp-locale']`, wenn gesetzt UND in `AVAILABLE_LOCALES`
2. `navigator.language[:2]`, wenn der Code in `AVAILABLE_LOCALES`
3. `'en'`

### Eigene Sprache hinzufügen
1. `config/i18n/<code>.json` anlegen, jeden Key aus `en.json` übersetzen (fehlende Keys fallen still auf Englisch zurück)
2. In `dashboard/i18n.js` den Code zu `window.AVAILABLE_LOCALES` ergänzen
3. Optional: ein Label in jeder Locale ergänzen: `"settings.language.option.fr": "French"` / `"settings.language.option.fr": "Français"`
4. Reload — die neue Sprache ist im Dropdown

### Was im HTML markiert ist
`data-i18n="key"` swappt `textContent` während des `applyI18n()`-Pass. Der Fallback-Text bleibt im Markup, damit der Browser auch ohne JS oder vor dem Locale-Fetch lesbar ist:

```html
<span data-i18n="nav.dashboard">Dashboard</span>
```

`data-i18n-title="key"` setzt das `title`-Attribut (für Tooltips).

`data-i18n-placeholder="key"` setzt das `placeholder`-Attribut (für Inputs).

`data-i18n-aria-label="key"` setzt das `aria-label`-Attribut (für Icon-only-Buttons).

`data-i18n-html="key"` setzt `innerHTML` statt `textContent` — für Strings, die Inline-Markup enthalten (z.B. Page-Titles mit `<span class="accent">` für den Akzent-Split).

### In JS-Code
`t(key, params, fallback)` für dynamisch generierte Strings:

```js
const label = t('settings.tab.language', {}, 'Language');
container.innerHTML = `<h3>${t('settings.language.heading')}</h3>`;
```

Das dritte Argument (`fallback`) ist der englische Default, der angezeigt wird, falls der Key in der aktiven Locale fehlt.

### Graceful Default
Fehlt `en.json` ganz oder ist ein Key abwesend, zeigt das Dashboard die englischen Defaults aus HTML/JS — kein Crash, kein leerer Bereich.

### Validierung mit i18n_check.py

`scripts/i18n_check.py` ist das Sicherheitsnetz: scannt `dashboard/**/*.{js,html}` nach jedem `t()`-Call und `data-i18n*`-Attribut und vergleicht die Keys gegen `config/i18n/en.json`.

```bash
python scripts/i18n_check.py          # Text-Report, Exit-Code 1 bei Hard-Errors
python scripts/i18n_check.py --json   # maschinenlesbar für CI / pre-commit
```

Drei Error-Klassen:

| Klasse | Bedeutung | Exit-Code |
|---|---|---|
| `missing-in-EN` | Key wird im Code aufgerufen, fehlt aber in `en.json` | 1 (hart) |
| `missing-in-<locale>` | Key existiert in `en.json`, fehlt in einer anderen Locale (Parität gebrochen) | 1 (hart) |
| `orphan` | Key in `en.json` wird im Code nirgends referenziert | 0 (warn) |

---

## Setup-Wizard (CLI + Web)

### Zweck

Initialisiert eine frische FinanceOS-Instanz — schreibt `data/.setup_state.json`, `config/branding.json`, `config/auth.json`, plus die Daten-Files. Nach erfolgreichem Lauf flippt `.setup_state.json.initialized` auf `true`, ein zweiter Lauf bricht mit Exit-Code 2 ab (Re-Init-Guard).

### Architektur

- `scripts/setup_core.py` — pure Logik (keine Side-Effects außerhalb der gelieferten Pfade). Public-API: `run_setup`, `write_branding`, `write_auth`, `write_setup_state`, `write_empty_seed`, `write_mmex_seed`, `check_not_initialized`. Wird sowohl vom CLI als auch vom Web-Wizard mit demselben `config`-Dict aufgerufen.
- `scripts/setup.py` — CLI-Frontend, dünn. Sammelt Config über Flags **oder** interaktive Prompts.
- `dashboard/setup.html` + `setup.js` + `setup.css` — Browser-Frontend, dünn. Sechs-Step-Wizard in Vanilla-JS.

### Modi

| Modus | Befehl | Wann |
|---|---|---|
| Non-interaktiv (Flags) | `python scripts/setup.py --brand "X" --currency USD --auth-user admin --auth-pass "***" --empty` | scripted / Docker Compose / CI |
| Interaktiv | `python scripts/setup.py --interactive` | Erst-Setup mit menschlichem Auge |
| Mit Initial-Commit | `... --git-commit` | wenn das Zielverzeichnis ein Git-Repo ist |

### Datenquellen

- **`--empty`** — startet mit 4 generischen Konten (`cash`, `checking`, `savings`, `credit`, alle in der gewählten Default-Currency) und ~34 neutralen Kategorien.
- **`--mmex path/to/db.mmb`** — liest eine Money-Manager-EX-Datei via `scripts/importers/mmex.py` (read-only) und konvertiert das Staging-Payload deterministisch in die Daten-Files.

### Interaktive Schritte

Sechs Schritte, jeder mit Default + Validierung:

1. **Branding** — Display-Name + Akzent-Farbe
2. **Default-Currency** — 3-Letter-ISO (USD, EUR, GBP, …)
3. **Auth** — `basic` (Username + Password, bcrypt-Hash) oder `none` (mit explizitem WARNING-Confirm)
4. **Datasource** — `(a)` MMEX-Datei oder `(b)` leerer Start
5. **Optionale Features** — Toggles für die sieben togglebaren Features
6. **Summary + Confirm** — vollständiger Überblick, `n` bricht ohne Schreibvorgang ab (Exit 1)

### Web-Wizard

Browser-basierte Variante des CLI-Wizards. Im Fresh-Install-Zustand redirectet `dashboard/index.html` automatisch nach `dashboard/setup.html`.

API-Endpoints (alle POST):

| Endpoint | Zweck |
|---|---|
| `/api/setup/status` | Gate fürs Frontend — gibt `{initialized, has_data, default_currency, wizard_version}` zurück |
| `/api/setup/mmex-upload` | nimmt eine base64-kodierte `.mmb` (max. 20 MB) entgegen, parst, speichert Staging-Payload, gibt Summary + Account-Preview zurück |
| `/api/setup/finalize` | ruft `setup_core.run_setup(config, staging=…)` 1:1 wie das CLI |

**Doppelter Guard** in beiden Mutationen: 409-Refusal, wenn `data/.setup_state.json.initialized=true` ODER `data/transactions.csv` Datenzeilen hat — schützt Live-Instanzen vor versehentlichem Wipe.

### Dependency

`bcrypt>=4.0` in `requirements.txt` (lazy-imported in `setup_core` — Auth-Modus `none` braucht es nicht).

---

## Authentifizierung

### Zweck
Optionale HTTP-Basic-Auth-Middleware vor jeder Server-Route. Default für das Empty-Start-Template: **aus** (nur LAN/VPN). Opt-in für Public-Hosting oder geteilte Deployments.

### Aktivieren

```bash
python scripts/auth.py --set-password
# Username [admin]: alice
# Password (min 8 chars): ********
# Repeat: ********
# ✓ Basic auth enabled for user 'alice'.

# Server neu starten (lru_cache liest auth.json einmal)
python scripts/serve.py
```

Der Browser zeigt dann beim nächsten Request einen nativen Login-Dialog (HTTP `401 + WWW-Authenticate: Basic realm="FinanceOS"`).

### Andere Modi

```bash
python scripts/auth.py --status     # zeigt aktuellen Modus + User (ohne Hash-Leak)
python scripts/auth.py --disable    # zurück zu mode=none
```

### Schema (`config/auth.json`)

```json
// Auth aus
{ "mode": "none" }

// Basic-Auth aktiv
{
  "mode": "basic",
  "user": "alice",
  "password_bcrypt": "$2b$12$..."
}
```

### Exempt-Pfade (auch bei aktiver Auth erreichbar)

| Pfad | Bedingung |
|---|---|
| `/api/health` | immer (für Cron / Monitoring) |
| `/dashboard/setup.{html,js,css}` | nur solange `data/.setup_state.json` nicht initialisiert ist |
| `/api/setup/{status,mmex-upload,finalize}` | nur solange `data/.setup_state.json` nicht initialisiert ist |

### Was nicht unterstützt wird

- **Logout-Button im Dashboard:** Browser cachen Basic-Auth-Credentials pro Realm bis zum Tab-Close. Der Server kann das nicht invalidieren — ein "Logout" wäre fake.
- **Mehrere User:** `auth.json` hat genau einen User-Slot. Multi-User steht auf der v2-Roadmap.
- **Session-Cookies:** stateless Basic-Auth only.

### Dependency

`bcrypt>=4.0` (gleich wie der Setup-Wizard). Lazy-imported, nicht nötig bei `mode=none`.

---

## CHANGELOG & Versionierung

### Format
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Datei `CHANGELOG.md` im Repo-Root.

### Subsections
Added · Changed · Deprecated · Removed · Fixed · Security

### Versionierungs-Policy

[Semantic Versioning 2.0.0](https://semver.org/):
- **MAJOR** — Breaking Changes
- **MINOR** — neue Features, backward-kompatibel
- **PATCH** — Bugfixes

### Was gehört rein?
Nur **user-relevante** Änderungen (Features, UX, Bugfixes, Schema-Migrationen). Keine internen Refactors, Daten-Batches oder Maintenance-Commits.
