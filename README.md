# FinanceOS

> **Self-hosted personal finance — your data, your server, no SaaS.**
>
> 🇬🇧 English (this file)  ·  🇩🇪 [Deutsch](README.de.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/)
[![Docker ready](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

FinanceOS is a single-page web dashboard for personal finance that runs anywhere
Python or Docker runs — your laptop, a Raspberry Pi, a Synology NAS, an Unraid
box, a small VPS. Your transactions live in plain CSVs in a `data/` folder you
control. There is no cloud account, no API key, no telemetry.

<!-- TODO: hero screenshot of dashboard (1600 × 900, dark mode) -->

## Why

- **Plain CSV storage.** Read your data with Excel, `pandas`, or `cat`. No database to migrate when the project moves on.
- **Multi-currency from day one.** TZS, EUR, USD, anything ISO-4217. Live FX with offline fallback.
- **Self-hosting first.** LAN-friendly. Pair with Tailscale or Twingate to reach it from anywhere.
- **Setup in under five minutes.** Empty start or import an existing MMEX `.mmb` file.

## Features

- **Dashboard** — Net Worth hero card with sparkline, monthly cashflow, account list with collapsible groups, recent transactions.
- **37 built-in reports + dynamic Reimbursement reports + user-defined Custom Reports** — see the [reports list](#reports) below.
- **Multi-currency.** TZS / EUR / USD / any ISO-4217. Live FX from `open.er-api.com`, offline fallback in `data/fx_rates.csv`.
- **Setup wizard** — empty start, or import an MMEX `.mmb` SQLite file in under a minute. Now also asks how to map your categories to the 8 category-driven reports.
- **i18n.** English shipped, Deutsch shipped. Drop in your own `config/i18n/<lang>.json` and add it to the picker.
- **Bank reconciliation.** Pluggable adapter system; CRDB Tanzania ships as the reference adapter, the pattern works for any bank with an XLS/CSV export.
- **PWA.** Mobile-first expense logging with offline IndexedDB queue, syncs back on reconnect.
- **Optional auth.** HTTP Basic with bcrypt; off by default for LAN/Tailscale setups.
- **Backup ZIP.** One-click full-data download from Settings.
- **Vehicles + Fuel log.** Track odometer, consumption, station, with reconciliation against transactions.
- **Debt tracking.** Money lent or owed, with partial payments and top-up history.
- **Quick expenses.** One-tap chips for repeat cash purchases.
- **Custom reports.** Filter builder, save as named report.

## Reports

Sectioned list of the 37 built-in reports — every report respects the active currency switcher and FX history.

**Income (3)**
Income Analysis · Income vs. Expense Summary · Income Sources Breakdown

**Expenses (13)**
Bills Overview · AI Costs · Automobile Costs · Dining Out · Category Breakdown · Subscription Tracker · Recurring Expense Tracker · Vice Spending · Bank Fees · Discretionary vs. Fixed · Largest Transactions · Staff Costs · Household Costs

**Overview (18)**
Account Balances Over Time · Top Payees · Savings Rate Trend · Weekday vs. Weekend · Cash vs. Digital · FX Exposure · Monthly Comparison · Net Worth Trend · Seasonal Heatmap · Cash Runway · Cashflow Forecast · Expense Trend Sparklines · Year-over-Year Comparison · Savings Goals History · Exchange Rates History · Cost of Living · Cash Discrepancy Log · Budget vs. Actual · Debt Overview

**Business (3)**
Pass-Through Audit · Business vs. Personal · Reimbursement Detail

**Dynamic** — one Reimbursement report per pass-through entity, plus your **Custom Reports** (filter builder, saved in `data/custom_reports.json`).

> **Heads-up — eight reports filter by category** (Dining Out, AI Costs, Vice Spending, Bank Fees, Cash Discrepancy, Bills Overview, Automobile Costs, Discretionary vs. Fixed). The defaults match the canonical category set. If you renamed a category — e.g. "Restaurants" instead of "Food:Dining out" — map them in the **Setup wizard step 6** or anytime in **Settings → Reports**.

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/lkasdorf/financeos_template.git financeos
cd financeos
cp .env.example .env
docker compose up -d
```

Open `http://localhost:8080/dashboard/setup.html` and walk through the seven-step wizard.
Your `data/`, `config/`, and `memory/` folders are bind-mounted so a `docker compose up -d --build` after an update never touches user state.

### Local Python (no Docker)

```bash
git clone https://github.com/lkasdorf/financeos_template.git financeos
cd financeos
python -m venv .venv
# Linux/Mac:  source .venv/bin/activate
# Windows:    .venv\Scripts\activate
pip install -r requirements.txt
python scripts/setup.py --interactive    # CLI wizard (alternative to web wizard)
python scripts/serve.py                  # → http://localhost:8080/dashboard/
```

Requires Python 3.10+. No external services or API keys to start.

## Where to host it

| Platform | Recommended path | Detail |
|---|---|---|
| **Synology NAS** | Container Manager → Project → Build with the bundled `docker-compose.yml` | [Synology guide →](docs/deployment.md#synology-container-manager) |
| **Unraid** | Community Apps → Add custom template, bind-mount `/mnt/user/appdata/financeos` | [Unraid guide →](docs/deployment.md#unraid) |
| **Generic Linux + Docker** | `docker compose up -d` behind any reverse proxy (Caddy / nginx / Traefik) | [Docker guide →](docs/deployment.md#generic-docker) |
| **Raspberry Pi (24 / 7)** | `serve.py` as a systemd service, optional 5-minute git-sync cron | [Pi guide →](docs/deployment.md#raspberry-pi--systemd) |
| **Mac / Windows desktop** | `python scripts/serve.py` — open the auto-launched browser | works as-is |

## Reach it from outside your network

FinanceOS does **not** want to live on the public Internet — exposing it
unauthenticated is asking for trouble, and even with HTTP Basic enabled, a
zero-trust mesh VPN is a better story.

| Approach | Why it's nice | Setup time |
|---|---|---|
| **[Tailscale](https://tailscale.com/)** *(recommended)* | Magic DNS gives you `financeos.<your-tailnet>.ts.net`, end-to-end WireGuard encryption, free for personal use, and the host sees real client identities so the audit log is meaningful. | ~5 min |
| **[Twingate](https://www.twingate.com/)** | Per-resource access policies, SSO-friendly, free tier covers a single user. Good fit if you already use Twingate at work. | ~10 min |
| **[Cloudflare Tunnel](https://www.cloudflare.com/products/tunnel/)** | No port forwarding, Cloudflare Access in front for OAuth/IdP. Couples your home network to Cloudflare though — pick if you accept that. | ~15 min |
| **WireGuard / OpenVPN** | Full control if you already self-host a VPN. More moving parts. | varies |
| **Plain port-forward + Caddy/nginx + Basic Auth** | Works, but please rate-limit and consider fail2ban. Don't expose without the auth gate. | ~20 min |

Step-by-step recipes for each are in [`docs/deployment.md`](docs/deployment.md#remote-access).

## Stay updated

- **Watch this repo on GitHub** → top-right `Watch` button → *Custom* → tick *Releases*. You'll get an email for every new tag.
- Releases follow **Semantic Versioning**:
  - **Patch** (`v1.2.x` → `v1.2.y`) — bugfixes only, pull and restart.
  - **Minor** (`v1.x.0` → `v1.y.0`) — new features, backwards-compatible. Read the release notes; usually you can pull straight away.
  - **Major** (`v1.x` → `v2.0.0`) — breaking changes, migration script ships with the release.
- Update workflow per platform → [`docs/deployment.md#updating-financeos`](docs/deployment.md#updating-financeos).

## Configuration

| File | Purpose |
|---|---|
| `config/branding.json` | Display name + accent color |
| `config/features.json` | Feature flags (debt, metals, PWA, recon, scheduled tx, custom reports, …) |
| `config/reports.json` | Maps the 8 category-driven reports to your category names — edit in Settings → Reports |
| `config/auth.json` | Enable Basic auth: `python scripts/auth.py --set-password` |
| `config/i18n/<lang>.json` | Translation file — copy `en.json`, translate, append the code to `AVAILABLE_LOCALES` in `dashboard/i18n.js` |
| `data/categories.csv` | Categories list (single source of truth for filters) |
| `data/accounts.csv` | Accounts list (each row is a real-world account) |

## Documentation

| Doc | Covers |
|---|---|
| [`docs/schema.md`](docs/schema.md) | CSV schemas — single source of truth |
| [`docs/tx-guide.md`](docs/tx-guide.md) | Transaction syntax, examples, and conventions |
| [`docs/deployment.md`](docs/deployment.md) | Synology, Unraid, Docker, Pi, reverse proxy, Tailscale, updates, backup |
| [`docs/faq.md`](docs/faq.md) | FAQ (English) — UI itself is bilingual EN + DE |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Public roadmap — what's coming next |
| [`CHANGELOG.md`](CHANGELOG.md) | Per-release change list |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute |

## Project layout

```
financeos/
├── data/        Your CSVs (transactions, accounts, categories, fx_rates, …)
├── dashboard/   Single-page web UI (vanilla JS, PapaParse + Chart.js via CDN)
├── scripts/    Python: server, setup wizard, reconciliation, importers, backup
├── config/     Branding, defaults, features, i18n, reconciliation routing, reports
├── docs/        Schema, guides, FAQ, deployment notes
└── memory/     Project context for Claude Code (optional)
```

## License

[MIT](LICENSE) — do whatever you want, just don't blame me when your bank statement disagrees with your dashboard.
