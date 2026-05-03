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

## [1.1.0] - 2026-05-03

Promotes `1.1.0-rc.1` to stable. No functional changes from the release candidate; the upstream code spent the rc.1 day under live load on the maintainer's deployment plus a multi-agent design/UX review pass with 7 follow-up fixes folded in. See the `[1.1.0-rc.1]` entry below for the full feature inventory.

## [1.1.0-rc.1] - 2026-05-03

Release candidate for `1.1.0`. Six weeks of upstream work bundled into one preview release after a multi-agent code-review marathon. 145 upstream commits, ~+23k/-19k LOC across 116 files. Promote to `1.1.0` final after a live-validation settle-in period.

### Added

- **ui-Dialog helpers (`uiAlert` / `uiConfirm` / `uiPrompt`).** Promise-based modal dialogs that replace `window.alert/confirm/prompt` across the dashboard. OK/Cancel labels follow the dashboard locale (not the browser locale). Typed variants: `uiConfirm({ type: 'destructive' | 'warning' | 'default' })` and `uiAlert({ type: 'error' | 'warning' | 'info' | 'default' })` adjust title color, OK button class, default-focus, and backdrop-block behaviour.
- **Universal modal close-X.** Every dashboard modal (~20 templates) automatically gets a 32×32 px close button in the top-right via `installModalA11y`. Click dispatches `Escape` on the overlay, so legacy `_escHandler` and overlay-scoped Escape both fire.
- **Modal focus-trap + a11y polyfill.** MutationObserver stamps `role="dialog"` + `aria-modal` + `aria-labelledby` on every dynamically-created `.modal-overlay`, traps Tab/Shift+Tab inside, and restores focus on close. Modal stack supports nested dialogs.
- **Tab-strip arrow-key navigation.** `.atx-tabs` containers get `role="tablist"` + `role="tab"` + `aria-selected` + Roving-Tabindex automatically. ArrowLeft/Right/Home/End move focus + auto-activate the tab (debounced 150 ms so rapid arrow-sweeps don't trigger re-render storms).
- **Custom Reports subsystem.** Filter builder + runner, saved reports surface on the Reports page, supports include/exclude modes for categories, tags, accounts, and payees.
- **Reconciliation adapter pattern.** New `BankAdapter` ABC with `CrdbTzAdapter` (Tanzania CRDB, reference) and `CsvGenericAdapter` (configurable columns). Account-to-adapter routing in `config/reconciliation.json`. Add a new bank by subclassing and registering in `scripts/reconciliation/__init__.py`.
- **Vehicles / fuel-tracking subsystem (Block G).** KPIs (cost/km, L/100 km, total spend), 3 charts, fuel-log table with heatmap, reconciliation against transactions (linked / unlinked / orphaned), dismiss + restore for non-vehicle fuel TX, PWA fuel tile, `TX fuel`-syntax for one-line entry.
- **ATM-fees lookup table.** `data/atm_fees.csv` per (bank, amount) preset; `TX atm 400k` expands into 4 atomic transactions (transfer + fee_net + levy + VAT).
- **Net Worth per-account toggle.** Settings → Accounts column lets you exclude individual accounts from the dashboard Net Worth calculation while keeping them in reports.
- **Mobile top-bar + hamburger drawer + FAB.** Replaces the previous bottom-tabs nav (which collided with mobile-browser chrome). Drawer slides from left; FAB lives bottom-right for one-tap "Add TX".
- **PWA WebCrypto credential encryption.** Cached basic-auth credentials are now AES-GCM encrypted at rest in IndexedDB.
- **Server-side gold-price proxy.** `/api/metals/spot` proxies goldprice.org to bypass browser CORS.
- **Setup-wizard polish.** First-run web wizard initializes branding, currency, optional auth, and accepts `.mmb` upload for one-click MMEX import.

### Changed

- **Backdrop click-to-close gets visible affordance.** `.modal-overlay` shows `cursor: pointer` (with `.modal` resetting to `cursor: default`) so the dismissable backdrop is discoverable without an explicit hint.
- **Destructive `uiConfirm` blocks backdrop dismissal.** When `type: 'destructive'`, accidental outside-clicks no longer silently cancel — Cancel button or Escape required.
- **Action-row footer chrome.** New `.ui-dialog-actions` matches the existing `.modal-footer` border-top + padding so action buttons read as a footer zone instead of floating off the body.
- **Mobile dialog touch-targets.** `min-height: 44px` + `gap: 12px` on `.ui-dialog-actions button` for finger-friendly hit areas.
- **Tab-strip auto-activation debounced 150 ms.** Quick arrow-sweep through Settings or Reconciliation tabs no longer triggers a re-render per keypress.

### Fixed

- **Multi-agent code review marathon.** 2 BLOCKER + 19 HIGH + 8 MEDIUM + 25 LOW + NIT findings across backend / cron / frontend / PWA all resolved over 24 sub-releases. Highlights: path-traversal hardening in `serve.py`, stack-trace leak removal, atomic CSV rewrites guarded by `tx_write_lock` with backup-on-write, HTTP keep-alive body-drain in `do_POST`, PWA cache-bust on `app_version` change, 51 native dialog migrations to `ui*` helpers, 117 duplicate `class=""` attributes merged via codemod, ~98 inline-style migrations to utility classes, modal a11y dashboard-wide.
- **PWA service-worker cache-busting.** `CACHE_NAME` auto-bumps from `/api/health.app_version` so version changes invalidate cached shell.
- **Cron-commit Pi-restart documentation.** Docstring clarifies the manual `ssh <your-pi-host> 'sudo systemctl restart financeos'` step (the older auto-restart was racing).
- **Reconciliation date-cutoff and dismiss-list** in fuel reconciliation prevent old already-handled mismatches from re-appearing.

### Removed

- **8 one-shot migration scripts** retired (~1.3k LOC). `scripts/i18n_add_*.py`, `scripts/migrate_payees.py` etc. served their one-time purpose during the initial template build and are no longer relevant for forks.

### Tooling

- **`scripts/template_export.py`** sanitize pipeline grew from 11 to 18 surgical edits to cover new hardcoded references that crept in post-v1.0.0 (FinanceOS brand in `<title>` + footer, hardcoded Pi LAN/Tailscale IPs, Pi hostname, person-name placeholders, House_4C / SBR commentary). Pre-public-push privacy scan codified as a hard gate before each release.

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
