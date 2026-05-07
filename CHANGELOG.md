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

## [1.3.0] - 2026-05-07

Reports become user-configurable, the public template ships bilingual (EN + DE), the README and deployment guide get serious treatment, and the long-standing Docker bug is fixed.

### Added

- **Configurable report → category mapping.** Eight reports (Dining Out, AI Costs, Vice Spending, Bank Fees, Cash Discrepancy, Bills Overview, Automobile Costs, Discretionary vs. Fixed) now read their category filters from `config/reports.json`. Forks that rename a category — e.g. "Restaurants" instead of "Food:Dining out" — keep working. The default mapping reproduces the pre-1.3 behaviour.
- **`Settings → Reports` sub-tab.** Multi-select picker per report (or per bucket for Bills/Automobile); separate expense + income pickers for Cash Discrepancy; textarea for the Discretionary-vs-Fixed prefix list. Save persists to `config/reports.json`. Reset writes an empty object → server falls back to defaults.
- **Setup wizard step 6 — "Map reports to your categories."** Two-radio chooser ("Use defaults" / "Customize now"); customise form mirrors the Settings tab, populated from the canonical empty-start category set or from the MMEX staging payload's category list. Selected mapping rides on `/api/setup/finalize` and is written via `config_loader.save_reports_config`.
- **Bilingual delivery.** The template now ships `config/i18n/de.json` alongside `en.json`. The dashboard's locale picker offers both. The new Settings tab and report-config strings have full EN + DE parity (47 keys per locale).
- **API endpoints:** `POST /api/reports-config/get` and `POST /api/reports-config/save`.
- **Comprehensive bilingual README twin** — `README.md` (English, GitHub default) and `README.de.md` (German). Both link to each other. New sections: full sectioned reports list, deployment matrix with deep links to `docs/deployment.md`, "Reach it from outside your network" (Tailscale, Twingate, Cloudflare Tunnel), "Stay updated" (GitHub Watch + SemVer + per-platform pull workflow), configuration table covering `config/reports.json`.
- **`docs/deployment.md` rewritten** — now covers Synology Container Manager (step-by-step), Unraid, generic Docker, Pi systemd, reverse proxy (Caddy / nginx / Traefik), remote access (Tailscale / Twingate / Cloudflare Tunnel), enabling auth, updating workflows per platform, backups, and recurring jobs (with explicit `docker exec` patterns for Synology Task Scheduler / Unraid User Scripts). Bilingual DE/EN per section.
- **FAQ entries:** "Why is my Dining Out / Bills / Vice / AI Costs / etc. report empty?", "How do I rename categories without breaking reports?", "Which reports are NOT affected by renames?", schema for `config/reports.json`, and a full Updating section with notification, SemVer, per-platform workflows, backup advice, and rollback.

### Changed

- **Eight reports refactored to read `window.REPORTS_CONFIG`** instead of hard-coded category strings. Fallback values match the canonical category set, so default-category installs see no behavioural change.
- **Bills + Automobile reports now bucket-keyed** (`row.rent`, `row.petrol`, …) instead of category-string-keyed (`row['Bills:Rent']`, `row['Automobile:Petrol']`, …). Bucket meta (label, color) lives in JS; per-bucket category lists come from config.

### Fixed

- **Public template Docker container previously crashed on startup.** The Dockerfile called `serve.py --host 0.0.0.0` but the script only knows `--bind`. Container exited immediately with `argparse: unrecognized arguments: --host`. Fixed by switching to `--bind 0.0.0.0 --port 8080 --no-open`. Verified by running `serve.py --help` against the new flags.

### Roadmap notes for v1.4

- **Built-in scheduler** so users on Docker / Synology / Unraid no longer have to wire up host-side cron entries for FX, metals, scheduled-tx, and integrity checks. Will run inside `serve.py` via apscheduler, auto-detected on container hosts. Until v1.4 ships, the host-cron / NAS-Task-Scheduler recipes in `docs/deployment.md#recurring-jobs` are the documented path.
- **One-time migration banner** for installs that upgrade from 1.2.x without going through the new wizard step 6 — points to Settings → Reports.

## [1.2.1] - 2026-05-07

UI design refresh — visible polish across Add-TX, Reports, Dashboard. Pure UI: no data-format, schema, or migration impact.

### Added

- **Add-TX split lines** now have a visually grouped container, an inline circular ✕ remove button, and a colored live-sum badge that flips green when the split total matches the typed main amount and red with a ±diff display when it doesn't.
- **Net Worth hero card** — the largest-balance currency renders as a wider, accent-tinted card with an inline 6-month sparkline, absolute delta, and percentage change. The standalone trend card now only appears when the trend currency does not match the hero currency.
- **Account groups** are now native `<details>` sections (Own / Custody / Archived) with a rotating ▸ caret. Archived starts collapsed.
- **Empty-state pattern** — dashed-border default variant plus a new `.empty-state.compact` modifier for inline panels and an `.empty-state-cta` button class for primary actions.

### Changed

- **Reports KPI cards** consolidated under shared `.kpi-grid` / `.kpi-card` classes (label / value / cur / delta slots). Print mode forces a 4-column horizontal strip.
- **Report tables** denser padding and font with `color-mix` zebra striping and a sticky `<thead>` so column headers stay visible when scrolling long lists.
- **Print layout** — `print-header` repeats across pages where browsers support CSS Paged Media `position: running()`; KPI / summary cards print as compact 4-up strips; report-section tables drop to 8pt.
- **Account balance readability** — explicit `.amt.negative` (red), `.amt.zero` (muted), `tr.row-archived` (dimmed) states; tabular-nums applied throughout balance columns.
- **Chart.js defaults** — animation tightened from 1000ms to 400ms, point-style legend with smaller swatches and tighter padding, points hidden until hover, softer line tension (0.25), bar border-radius, denser tooltip with index-mode hover. Scale grid/ticks now extend Chart.js defaults via property assignment instead of replacing the whole config object.

### Fixed

- Three inline empty-states migrated to the shared `.empty-state.compact` pattern: payee TX overlay (`pages-payees`), debt payments (`pages-debts`), custom-report runner with no TX in period (`custom-reports-ui`).

## [1.2.0] - 2026-05-04

Removes the optional Claude-API-backed free-text TX entry mode. Manual entry is now the sole in-dashboard booking path; Claude Code terminal TX (a CLAUDE.md convention, no server endpoint) and `TX fuel` (a local regex parser in `scripts/fuel.py`) are unaffected. No data-format or migration impact.

### Removed

- **Dashboard Free-text TX mode and the Claude API path that powered it.** The tab bar (`Free-text` / `Manual`) is gone; the Add-TX page is now a single manual form.
- **`POST /api/tx/parse` endpoint** and the `handle_tx_parse` handler in `scripts/serve.py`.
- **`tx_engine.parse_with_claude`, `build_parse_prompt`, `_render_smart_default_rule`** and the entire Claude-API-parsing section in `scripts/tx_engine.py`. The `anthropic` Python package is no longer imported anywhere in the project.
- **`ANTHROPIC_API_KEY` requirement.** No feature in this release reads the key; the startup banner no longer mentions it, `.env.example` no longer lists it, and `docs/local-setup.md` no longer documents a setup path for it.
- **`config/smart_defaults.json:prompt_rules`** field and the sanitizer step that emptied it during template export. The field only existed to be rendered into the Claude API system prompt.
- **i18n keys** `atx.tab_freetext`, `atx.tab_manual`, `atx.free.*`, `txflow.free.*` in `config/i18n/en.json`. `page.add_tx.subtitle` is now `"Manual entry"`.
- **CSS:** `input.atx-freetext-input` rule removed from `dashboard/styles.css`.
- **Frontend:** `submitFreeText()` and `switchTxMode()` removed from `dashboard/forms-add-tx.js`; the `addTxState.mode` field is gone.

### Migration

No action required. Forks that referenced `prompt_rules` in their `config/smart_defaults.json` can safely delete the field; the parser that consumed it no longer exists. If you depended on the dashboard's free-text mode in your own deployment, switch to the Manual form (same data, structured input) or drive bookings from a Claude Code terminal session against the repo.

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

- **`scripts/template_export.py`** sanitize pipeline grew from 11 to 18 surgical edits to cover new hardcoded upstream references that crept in post-v1.0.0 (brand strings in `<title>` and footer, hardcoded LAN/VPN IPs, host aliases, person-name placeholders, household/property tag commentary). Pre-public-push privacy scan codified as a hard gate before each release.

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
