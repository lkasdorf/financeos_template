# FinanceOS

Self-hosted personal finance system. CSV-based, single-page dashboard, runs anywhere Python or Docker runs.

> **Status:** Public template. Drop in your own data and brand, run locally or on a small server.

## Features

- **Single-page dashboard** — net worth, cashflow, accounts, monthly summary, recent transactions.
- **49 reports** — income, expenses, behavioral, business, financial-health analyses with FX conversion.
- **CSV-first storage** — your data stays in plain `data/*.csv` files. No database, no lock-in.
- **Multi-currency** — TZS / EUR / USD / any ISO-4217 with live FX rates and historical fallback.
- **Setup wizard** — empty start, or import an MMEX `.mmb` SQLite file in under a minute.
- **i18n-ready** — English shipped, Locale-Switcher in Settings, drop in your own `config/i18n/<lang>.json`.
- **Bank reconciliation** — pluggable adapter system, CRDB Tanzania ships as reference.
- **Optional auth** — HTTP Basic with bcrypt, off by default (LAN/Tailscale-friendly).
- **Backup ZIP** — one-click full-data download from Settings.

## Quick start (Docker)

```bash
git clone https://github.com/<your-org>/financeos.git
cd financeos
cp .env.example .env
docker compose up -d
```

Open `http://localhost:8080/dashboard/setup.html` — the setup wizard guides you through branding, currency, auth, and an optional MMEX import.

## Quick start (local Python)

```bash
git clone https://github.com/<your-org>/financeos.git
cd financeos
python -m venv .venv && source .venv/bin/activate    # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
python scripts/setup.py --interactive                # CLI wizard (alternative to web wizard)
python scripts/serve.py                              # → http://localhost:8080/dashboard/
```

Requires Python 3.10+. No external services, no API keys to start.

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/schema.md`](docs/schema.md) | CSV schema (single source of truth) |
| [`docs/tx-guide.md`](docs/tx-guide.md) | Transaction examples & conventions |
| [`docs/faq.md`](docs/faq.md) | FAQ — features, deployment, customization |
| [`docs/deployment.md`](docs/deployment.md) | Always-on deployment (Docker, systemd, Raspberry Pi) |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Public roadmap (SemVer) |
| [`CLAUDE.md`](CLAUDE.md) | Project context & conventions |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute |

## Project layout

| Path | Contents |
|---|---|
| `data/` | Your CSVs (`transactions.csv`, `accounts.csv`, `categories.csv`, …) |
| `dashboard/` | Single-page web UI (vanilla JS, PapaParse + Chart.js via CDN) |
| `scripts/` | Python: server, setup wizard, reconciliation, importers, backup |
| `config/` | Branding, defaults, features, i18n, reconciliation routing |
| `docs/` | Schema, guides, FAQ, deployment notes |
| `memory/` | Project context for Claude Code (optional) |

## Customization

- **Branding** — edit `config/branding.json` (display name, accent color).
- **Features** — toggle modules in `config/features.json` (custom reports, scheduled tx, quick expenses, …).
- **Auth** — `python scripts/auth.py --set-password` to enable HTTP Basic.
- **Translations** — copy `config/i18n/en.json` to `config/i18n/<lang>.json` and translate.

## License

MIT — see [`LICENSE`](LICENSE).
