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

## [1.0.0] - 2026-04-27

First stable release. Promotes `1.0.0-rc.2` after a settle-in period — no functional changes from the release candidate. See the `[1.0.0-rc.2]` entry below for the full feature inventory.

## [1.0.0-rc.2] - 2026-04-27

Second public release candidate. Completes the multi-entity business-tag generalization that was deferred from `rc.1`: the four reports that previously hard-coded a single business identity (Reimbursements, Income Sources, Business vs. Personal, Dining Out split) now read entity definitions from `config/businesses.json` and adapt to whatever entities the fork configures (zero, one, or many). The `v1.0.0` final tag follows after a settle-in period on `rc.2`.

### Changed

- **Business reports are now config-driven via `config/businesses.json`.** Define one entity per business with `{id, label, tag, accounts, color, income_categories}`. Reports auto-generate per-entity cards (Reimbursements report) or aggregate across all entities (Dining Out's Personal-vs-Business split, Business-vs-Personal report). Forks with zero entities see no business-specific reports — the section disappears cleanly.
- **Income Sources classifier** now derives sub-types (`<entity>_salary`, `<entity>_dividends`, `<entity>_reimb`, `<entity>_income`) from the entity's `income_categories` map plus an optional `income_prefix` for prefix matching. The five generic source buckets (interest, investments_sales, reimbursement, refunds, other) stay unchanged.
- **Cashflow Forecast's Special Income** list (the lumpy categories with user-adjustable occurrence counts) now expands per configured entity for dividends + reimbursement, plus the universal Interest entry.

### Fixed

- **HTTP keep-alive pipelining bug in `serve.py`.** Handlers that ignored their request body left bytes in the socket buffer; the next POST on the same connection got its method line prefixed with the leftover bytes (manifested as `"Unsupported method ('{}POST')"` 501 errors). `do_POST` now drains `Content-Length` bytes up front into `self._raw_body` and `_read_json_body()` parses from there. Defense-in-depth across the whole API surface.

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
