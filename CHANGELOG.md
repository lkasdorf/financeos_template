# Changelog

All notable changes to **FinanceOS** are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [1.0.0-rc.1] - 2026-04-26

First public release candidate. The `v1.0.0` final tag follows after the Tier-2 generalization pass (rename Leon-derived business-tag references to a config-driven multi-entity model in the reports module).

### Added

- **Single-page dashboard** with net worth, cashflow, accounts, monthly summary, and recent transactions. Live FX conversion across TZS / EUR / USD and any ISO-4217 currency.
- **49 reports** spanning income, expenses, behavioral patterns, business, financial-health, and miscellaneous analyses.
- **CSV-first storage.** All user data lives in plain `data/*.csv` files — no database, no lock-in, easy backup.
- **Setup wizard** (web at `/dashboard/setup.html` and CLI via `python scripts/setup.py --interactive`). Six-step flow: branding, currency, auth, data source, optional features, review. Empty-start path or import a Money Manager Ex `.mmb` SQLite file with deterministic transaction conversion.
- **i18n infrastructure.** English shipped, locale switcher in Settings, drop-in `config/i18n/<lang>.json` files. Locale-aware formatters for currency, dates, numbers, weekdays, months. `scripts/i18n_check.py` CI-friendly validator.
- **Bilingual FAQ** with DE/EN pill toggle and a `scripts/check_faq_pair.py` drift validator.
- **Bank reconciliation plugin system.** `BankAdapter` ABC plus `CrdbTzAdapter` (CRDB Tanzania, reference) and `CsvGenericAdapter` (configurable columns). Account-to-adapter routing in `config/reconciliation.json`.
- **Optional HTTP Basic auth** (off by default). `python scripts/auth.py --set-password` to enable, bcrypt-hashed.
- **Backup ZIP download** from the Settings page, exposed via `POST /api/backup/export`.
- **Feature toggles** (`config/features.json`) for Custom Reports, Scheduled TX, Quick Expenses, and bank reconciliation.
- **Branding configuration** in `config/branding.json` (display name, accent color).
- **Docker deployment.** `Dockerfile` + `docker-compose.yml` + `.env.example` for one-command deploys.
- **Documentation**: schema reference, transaction guide, deployment guide (Docker / systemd / Raspberry Pi), public roadmap, and FAQ — all in `docs/`.
- **GitHub templates** for issues (bug, feature) and pull requests under `.github/`.

### Notes

This is the initial open-source release, generated from an upstream private project via a one-way sanitize pipeline that strips personal data, generalizes the docs, and disables optional features that don't apply to a fresh fork (precious-metals tracker, mobile PWA). See `docs/ROADMAP.md` for what comes next.
