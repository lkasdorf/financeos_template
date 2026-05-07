# FinanceOS

> **Selbst gehostete persönliche Finanz-App — deine Daten, dein Server, kein SaaS.**
>
> 🇩🇪 Deutsch (diese Datei)  ·  🇬🇧 [English](README.md)

[![Lizenz: MIT](https://img.shields.io/badge/lizenz-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/)
[![Docker-ready](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

FinanceOS ist ein Single-Page-Dashboard für deine privaten Finanzen, das überall
läuft, wo Python oder Docker läuft — Laptop, Raspberry Pi, Synology NAS,
Unraid-Box, kleiner VPS. Deine Buchungen liegen als CSVs in einem `data/`-Ordner,
den du kontrollierst. Kein Cloud-Account, kein API-Key, keine Telemetrie.

<!-- TODO: Hero-Screenshot des Dashboards (1600 × 900, Dark Mode) -->

## Warum

- **CSV-Speicherung in Klartext.** Lies deine Daten mit Excel, `pandas` oder `cat`. Keine Datenbank, die du migrieren musst, wenn das Projekt mal weg ist.
- **Multi-Currency von Anfang an.** TZS, EUR, USD — alles ISO-4217. Live-Kurse mit Offline-Fallback.
- **Self-Hosting first.** LAN-freundlich. Mit Tailscale oder Twingate von überall erreichbar.
- **Setup in unter fünf Minuten.** Leerstart oder eine bestehende MMEX-`.mmb`-Datei importieren.

## Features

- **Dashboard** — Net-Worth-Hero-Card mit Sparkline, monatlicher Cashflow, Konten-Liste mit klappbaren Gruppen, letzte Transaktionen.
- **37 eingebaute Reports + dynamische Reimbursement-Reports + User-definierte Custom Reports** — siehe [Reports-Liste](#reports) unten.
- **Multi-Currency.** TZS / EUR / USD / jede ISO-4217-Währung. Live-Kurse von `open.er-api.com`, Offline-Fallback in `data/fx_rates.csv`.
- **Setup-Assistent** — Leerstart oder MMEX-`.mmb`-SQLite-Import in unter einer Minute. Fragt jetzt auch, wie deine Kategorien zu den 8 kategorie-getriebenen Reports gemappt werden sollen.
- **i18n.** Englisch und Deutsch kommen mit. Eigene `config/i18n/<lang>.json` einlegen und im Picker hinzufügen.
- **Bank-Reconciliation.** Pluggable Adapter; CRDB Tanzania ist der Referenz-Adapter, das Pattern funktioniert mit jeder Bank, die XLS/CSV exportiert.
- **PWA.** Mobile-first Cash-Expense-Logging mit Offline-IndexedDB-Queue, syncs zurück bei Reconnect.
- **Optionale Auth.** HTTP Basic mit bcrypt; per Default aus für LAN/Tailscale-Setups.
- **Backup-ZIP.** One-Click-Vollexport aus den Settings.
- **Fahrzeuge + Tankprotokoll.** Tachostände, Verbrauch, Tankstelle, mit Recon gegen Transaktionen.
- **Schulden-Tracking.** Verliehenes oder geliehenes Geld mit Teilzahlungen und Top-Up-Historie.
- **Quick Expenses.** One-Tap-Chips für wiederkehrende Cash-Käufe.
- **Custom Reports.** Filter-Builder, als benannter Report speicherbar.

## Reports

Sektionierte Liste der 37 eingebauten Reports — jeder Report respektiert den aktiven Currency-Switcher und die FX-Historie.

**Income (3)**
Income Analysis · Income vs. Expense Summary · Income Sources Breakdown

**Expenses (13)**
Bills Overview · AI Costs · Automobile Costs · Dining Out · Category Breakdown · Subscription Tracker · Recurring Expense Tracker · Vice Spending · Bank Fees · Discretionary vs. Fixed · Largest Transactions · Staff Costs · Household Costs

**Overview (18)**
Account Balances Over Time · Top Payees · Savings Rate Trend · Weekday vs. Weekend · Cash vs. Digital · FX Exposure · Monthly Comparison · Net Worth Trend · Seasonal Heatmap · Cash Runway · Cashflow Forecast · Expense Trend Sparklines · Year-over-Year Comparison · Savings Goals History · Exchange Rates History · Cost of Living · Cash Discrepancy Log · Budget vs. Actual · Debt Overview

**Business (3)**
Pass-Through Audit · Business vs. Personal · Reimbursement Detail

**Dynamisch** — ein Reimbursement-Report pro Pass-Through-Entity, plus deine **Custom Reports** (Filter-Builder, gespeichert in `data/custom_reports.json`).

> **Wichtig — acht Reports filtern nach Kategorie** (Dining Out, AI Costs, Vice Spending, Bank Fees, Cash Discrepancy, Bills Overview, Automobile Costs, Discretionary vs. Fixed). Die Defaults entsprechen dem Standard-Kategorien-Set. Wer eine Kategorie umbenannt hat — z.B. "Restaurants" statt "Food:Dining out" — mappt sie im **Setup-Wizard Step 6** oder jederzeit in **Settings → Reports**.

## Schnellstart

### Docker (empfohlen)

```bash
git clone https://github.com/lkasdorf/financeos_template.git financeos
cd financeos
cp .env.example .env
docker compose up -d
```

`http://localhost:8080/dashboard/setup.html` öffnen und durch den 7-Schritte-Assistenten klicken.
Deine Ordner `data/`, `config/` und `memory/` werden bind-mounted, sodass `docker compose up -d --build` nach einem Update den User-State nicht anfasst.

### Lokal mit Python (ohne Docker)

```bash
git clone https://github.com/lkasdorf/financeos_template.git financeos
cd financeos
python -m venv .venv
# Linux/Mac:  source .venv/bin/activate
# Windows:    .venv\Scripts\activate
pip install -r requirements.txt
python scripts/setup.py --interactive    # CLI-Wizard (Alternative zum Web-Wizard)
python scripts/serve.py                  # → http://localhost:8080/dashboard/
```

Voraussetzung: Python 3.10+. Keine externen Services oder API-Keys zum Loslegen.

## Test-Drive (5 Minuten)

Vor dem Festlegen auf einen Host kurz ausprobieren? Eine Wegwerf-Lokal-Installation
in einem Sandbox-Ordner, einmal durch den Wizard, dann löschen. Funktioniert auf
Windows, macOS und Linux ohne Docker.

### Windows (PowerShell)

```powershell
# 1. Sandbox außerhalb von OneDrive (vermeidet File-Lock-Probleme)
$test = "$env:USERPROFILE\financeos-test"
Remove-Item $test -Recurse -Force -ErrorAction Ignore
git clone --branch v1.3.0-rc.1 https://github.com/lkasdorf/financeos_template.git $test
Set-Location $test

# 2. venv + Dependencies
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 3. Server starten — öffnet den Setup-Wizard im Default-Browser
python scripts\serve.py
```

Falls der Browser nicht automatisch aufgeht: `http://localhost:8080/dashboard/setup.html`.

### macOS / Linux (bash / zsh)

```bash
test=~/financeos-test
rm -rf "$test"
git clone --branch v1.3.0-rc.1 https://github.com/lkasdorf/financeos_template.git "$test"
cd "$test"

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python scripts/serve.py
```

### Docker-Desktop-Variante (testet zusätzlich den Container-Pfad)

```bash
test=~/financeos-test-docker
rm -rf "$test"
git clone --branch v1.3.0-rc.1 https://github.com/lkasdorf/financeos_template.git "$test"
cd "$test"
cp .env.example .env
docker compose up -d --build
docker compose logs --tail 30 financeos    # bestätigt dass der Container wirklich startet
```

### Was zu verifizieren ist

1. **Setup-Wizard Schritte 1–5** — Marke, Währung, Auth=none, "Empty start" oder MMEX-`.mmb` hochladen, Features toggeln.
2. **Schritt 6 (Reports)** — erst auf "Use defaults" lassen, *Next*. Zurück, dann auf "Customize now" umschalten — die Multi-Select-Felder werden mit den Kategorien gefüllt, die angelegt werden. *AI Costs / Vice / Cash Discrepancy*-Sektionen erscheinen auch, wenn dein Kategorie-Set die kanonischen Namen nicht enthält — die Felder bleiben dann leer bis du sie mappst.
3. **Schritt 7 (Review)** — Markenname und Währung müssen korrekt erscheinen; die Imported-Account-Tabelle zeigt deine echten Currency-Codes (TZS, EUR, USD, …).
4. **Confirm** → landet im Dashboard. Header / Sidebar / Footer zeigen **deinen Markennamen**, nicht "FinanceOS".
5. **Settings → Reports** — dein Step-6-Mapping bleibt erhalten, du kannst editieren und mit grünem "✓ Saved" speichern.
6. **Settings → Language** — Wechsel auf *Deutsch* übersetzt die Settings-Tab-Labels und die meisten Dashboard-Strings (manche Report-Titel werden Stück für Stück nachgereicht — siehe [`docs/ROADMAP.md`](docs/ROADMAP.md)).

### Cleanup

```powershell
# Windows — WICHTIG: erst aus dem Test-Ordner raus, sonst hält Windows
# einen File-Lock auf das venv und Remove-Item scheitert mit
# "Cannot remove the item ... because it is in use".
deactivate
Set-Location $env:USERPROFILE
Start-Sleep -Seconds 1
Remove-Item "$env:USERPROFILE\financeos-test" -Recurse -Force
```

```bash
# macOS / Linux
deactivate
cd ~
rm -rf ~/financeos-test
# oder für die Docker-Variante:
cd ~ && docker compose -f ~/financeos-test-docker/docker-compose.yml down -v
rm -rf ~/financeos-test-docker
```

## Wo soll's laufen?

| Plattform | Empfohlener Weg | Detail |
|---|---|---|
| **Synology NAS** | Container Manager → Project → Build mit der mitgelieferten `docker-compose.yml` | [Synology-Anleitung →](docs/deployment.md#synology-container-manager) |
| **Unraid** | Community Apps → Custom Template, Bind-Mount `/mnt/user/appdata/financeos` | [Unraid-Anleitung →](docs/deployment.md#unraid) |
| **Generisches Linux + Docker** | `docker compose up -d` hinter beliebigem Reverse Proxy (Caddy / nginx / Traefik) | [Docker-Anleitung →](docs/deployment.md#generic-docker) |
| **Raspberry Pi (24 / 7)** | `serve.py` als systemd-Service, optionaler 5-Min-Git-Sync-Cron | [Pi-Anleitung →](docs/deployment.md#raspberry-pi--systemd) |
| **Mac / Windows Desktop** | `python scripts/serve.py` — Browser öffnet automatisch | funktioniert direkt |

## Von außen erreichbar machen

FinanceOS gehört **nicht** ins offene Internet — ohne Auth exponiert ist es ein
Risiko, und selbst mit HTTP Basic ist ein Zero-Trust-Mesh-VPN die bessere
Geschichte.

| Ansatz | Warum's gut ist | Aufwand |
|---|---|---|
| **[Tailscale](https://tailscale.com/)** *(empfohlen)* | Magic DNS gibt dir `financeos.<dein-tailnet>.ts.net`, End-to-End-WireGuard-Verschlüsselung, gratis für privat, Host sieht echte Client-Identitäten — Audit-Log wird sinnvoll. | ~5 min |
| **[Twingate](https://www.twingate.com/)** | Pro-Resource-Access-Policies, SSO-tauglich, Free-Tier deckt einen User. Passt, wenn du Twingate eh schon im Job nutzt. | ~10 min |
| **[Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/)** | Kein Port-Forward, Cloudflare Access als OAuth/IdP-Gate davor. Koppelt dein Heimnetz aber an Cloudflare — bewusst entscheiden. | ~15 min |
| **WireGuard / OpenVPN** | Volle Kontrolle, wenn du eh ein eigenes VPN hostest. Mehr Bewegliches. | variiert |
| **Plain Port-Forward + Caddy/nginx + Basic Auth** | Geht, aber bitte rate-limiten und ggf. fail2ban. Niemals ohne Auth-Gate exponieren. | ~20 min |

Schritt-für-Schritt-Rezepte für jeden Weg in [`docs/deployment.md`](docs/deployment.md#remote-access).

## Updates bekommen

- **Repo auf GitHub watchen** → oben rechts `Watch` → *Custom* → *Releases* anhaken. E-Mail bei jedem neuen Tag.
- Releases folgen **Semantic Versioning**:
  - **Patch** (`v1.2.x` → `v1.2.y`) — nur Bugfixes, Pull + Restart reicht.
  - **Minor** (`v1.x.0` → `v1.y.0`) — neue Features, abwärtskompatibel. Release Notes lesen; meist kann man direkt pullen.
  - **Major** (`v1.x` → `v2.0.0`) — Breaking Changes, Migrations-Skript liegt dem Release bei.
- Update-Workflow je Plattform → [`docs/deployment.md#updating-financeos`](docs/deployment.md#updating-financeos).

## Konfiguration

| Datei | Zweck |
|---|---|
| `config/branding.json` | Anzeigename + Akzentfarbe |
| `config/features.json` | Feature-Flags (Debt, Metals, PWA, Recon, Scheduled TX, Custom Reports, …) |
| `config/reports.json` | Mapping der 8 kategorie-getriebenen Reports auf deine Kategorien — editierbar in Settings → Reports |
| `config/auth.json` | Basic Auth einschalten: `python scripts/auth.py --set-password` |
| `config/i18n/<lang>.json` | Übersetzungsdatei — `en.json` kopieren, übersetzen, Code in `AVAILABLE_LOCALES` in `dashboard/i18n.js` ergänzen |
| `data/categories.csv` | Kategorienliste (Single Source of Truth für Filter) |
| `data/accounts.csv` | Kontenliste (jede Zeile ist ein echtes Konto) |

## Dokumentation

| Doc | Inhalt |
|---|---|
| [`docs/schema.md`](docs/schema.md) | CSV-Schemata — Single Source of Truth |
| [`docs/tx-guide.md`](docs/tx-guide.md) | TX-Syntax, Beispiele, Konventionen |
| [`docs/deployment.md`](docs/deployment.md) | Synology, Unraid, Docker, Pi, Reverse Proxy, Tailscale, Updates, Backup |
| [`docs/faq.md`](docs/faq.md) | FAQ (Englisch) — die UI selbst ist zweisprachig EN + DE |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Public Roadmap — was als nächstes kommt |
| [`CHANGELOG.md`](CHANGELOG.md) | Per-Release-Change-Liste |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Wie man beiträgt |

## Projekt-Layout

```
financeos/
├── data/        Deine CSVs (transactions, accounts, categories, fx_rates, …)
├── dashboard/   Single-Page-Web-UI (Vanilla JS, PapaParse + Chart.js via CDN)
├── scripts/     Python: Server, Setup-Assistent, Reconciliation, Importers, Backup
├── config/      Branding, Defaults, Features, i18n, Recon-Routing, Reports
├── docs/        Schema, Guides, FAQ, Deployment-Notes
└── memory/      Projekt-Kontext für Claude Code (optional)
```

## Lizenz

[MIT](LICENSE) — mach was du willst, beschwer dich nur nicht bei mir, wenn dein Kontoauszug sich vom Dashboard unterscheidet.
