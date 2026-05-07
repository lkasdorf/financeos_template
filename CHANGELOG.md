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

## [1.3.0-rc.7] - 2026-05-07

### Fixed

- **Setup wizard step 6 dropdowns now show your real MMEX categories.** rc.3 added `categories` to the `/api/setup/mmex-upload` response, and rc.5 wired the report-config UI — but `setup.js` never copied `data.categories` into `state.staging`. `reportsWizardCategories()` therefore always saw `undefined` and fell back to the empty-start canonical category set. One-line fix in the upload handler.
- **Report-list titles + descriptions translate when you switch locale.** rc.5 added 74 i18n keys per locale (`reports.list.<id>.{title,desc}`) and wired the REPORTS array via getters, but the renderer in `reports.js` used `t('reports.<id>.title', …)` without the `.list.` middle path — namespace mismatch, every key fell back to the English literal. Bulk-renamed all 74 keys + the two getter call sites so the namespace lines up.

### Known limitations / still in v1.3.x backlog

- Setup wizard's own labels (steppers, h2 headings, hints, button text) still hard-coded English. The locale picker only carries the choice into the dashboard.
- Accent-color override via the wizard doesn't recompute `--accent-dim` / `--accent-glow` / `--accent-subtle`, so picking e.g. a green accent leaves blue glows on hover/focus.
- "Accent color in Settings" — currently only writable during Setup; should also be editable in `Settings → Branding` after install.

## [1.3.0-rc.6] - 2026-05-07

### Added

- **Setup wizard classifies each MMEX-imported account.** Step 7 gets a Type dropdown per row with a curated 10-item vocabulary: cash / bank / savings / credit / loan / mobile_money / brokerage / pass_through / custody / other. Default per row is a best-guess from the MMEX type string; user picks the right one. `setup_core.run_setup` honours the override and auto-flips owner to `custody` when type=custody so the account drops out of Net Worth.
- `ACCOUNT_TYPES` is the single source of truth in `scripts/setup_core.py`. The frontend reads the list via `/api/setup/status` (with a built-in fallback for offline boot). `/api/setup/finalize` accepts `account_type_overrides`, `account_owner_overrides`, `account_pt_payee_overrides` (the last two are wired API-side, not yet exposed in the UI — follow-up).

## [1.3.0-rc.5] - 2026-05-07

Continuous user-test sweep. Combines what would have been rc.4 (income-bucket configurability + FAQ rewrite + setup locale picker) with rc.5 (report-title i18n + accent color + dashboard favicon).

### Added

- **All 37 report list titles + descriptions are now i18n-aware.** New `_r(id, category, render, title, desc)` helper builds REPORTS array entries with getters that route through `t()`. Locale switch re-translates the list immediately. 74 new keys per locale.
- **Income Sources Breakdown is configurable.** New `income_sources.buckets` section in `config/reports.json` covers salary / interest / investments_sales / reimbursement / refunds. The Salary column auto-appears once you map a category to it (Settings → Reports or Setup wizard step 6). Per-business salary classification still wins via `config/businesses.json`.
- **Setup wizard locale picker.** Top-bar `<select>` lets users pick `en` / `de` during install. Saves to `localStorage:lp-locale` so the dashboard boots in the chosen language. Wizard's own labels stay English for now (full wizard i18n is on the v1.3.x backlog).

### Fixed

- **Accent color from the setup wizard wasn't applied to the dashboard.** `applyBranding` updated text content only; the `accent_color` from `branding.json` was loaded into `window.BRANDING.accent_color` but never propagated to CSS. Now sets `--accent-color` and `--accent` on `:root` so every consumer picks it up.
- **Dashboard favicon was the "LP" wordmark.** Replaced with the same generic three-bar chart icon used in the setup wizard.
- **Income Sources Breakdown classifier** reads category buckets from `REPORTS_CONFIG.income_sources` instead of the hard-coded set, so users with renamed `Income:*` categories see them in the right column instead of dumped into "Other Income".
- **FAQ "Booking Transactions" / "Batch TX" sections rewritten** to match the public template's actual UX. Free-text `TX ...` references removed (manual entry form has been the only path since v1.2.0). Pass-Through & Custody section adds an explicit "Private vs Business — how does the dashboard distinguish?" block.

### Still in v1.3.x backlog

- Full wizard-string i18n (every label in setup.html via `t()`).
- FAQ German twin (`docs/faq.de.md`) — currently the FAQ tab loader falls back to English for DE locale.
- Step 6 dropdowns may still miss MMEX-imported categories that have no transactions — the importer is parent-only filtered for those; a follow-up will re-include all leaf categories.

## [1.3.0-rc.3] - 2026-05-07

Setup-wizard MMEX staging-payload completion. Caught when rc.2 testing showed the Currency column was *still* empty and the Step-6 dropdowns *still* didn't have the user's MMEX categories.

### Fixed

- **MMEX staging account currency was never sent to the frontend.** Root cause was in `serve.py` — `accounts_preview` did `acc.get("currency", "")` but the importer returns `currency_code`. The earlier rc.2 fix on the JS side (`acc.currency_code || acc.currency`) was a no-op because the server already stripped the value before the JS could read it. Now the response carries both `currency` and `currency_code` with the same value.
- **Setup step 6 dropdowns showed the empty-start canonical categories instead of the user's MMEX categories.** `accounts_preview` was the only collection echoed back; `categories` was never in the staging response, so `state.staging.categories` was `undefined` on the frontend, and `reportsWizardCategories()` correctly fell back to `EMPTY_START_CATEGORIES`. Now the response carries `categories: [{id, name, path}, …]` mirroring the importer's `full_path` so the dropdowns offer the user's real categories.

### Still in v1.3.x backlog (not in rc.3)

Same as rc.2: Setup wizard locale picker, report-title i18n, FAQ German twin, FAQ TX-command cleanup. Each gets its own focused rc to keep testable.

## [1.3.0-rc.2] - 2026-05-07

Bug sweep from the rc.1 user test on Windows 11. Same scope as 1.3.0, three blockers fixed.

### Fixed

- **Setup wizard brand name was never persisted to the dashboard.** Pre-existing bug since v1.0: the web wizard ships `brand: {display_name, accent_color}` (nested object) but `setup_core.run_setup` only knew the CLI's flat shape (`brand: "name"` plus a separate top-level `accent_color`). Result: `branding.json` got `display_name: <object>`, the dashboard rendered `[object Object]` everywhere. Now `run_setup` accepts either shape and normalises before calling `write_branding`.
- **Review screen "Currency" column showed `—` for every imported MMEX account.** The MMEX staging payload uses `currency_code`, the JS read `acc.currency`. Now reads `acc.currency_code || acc.currency || '—'`.
- **Setup wizard logo was an opinionated "LP" wordmark** (visible in the favicon and the in-page header). Replaced both with a generic three-bar chart icon that inherits the active accent colour via `currentColor`.

### Added

- **Test-drive section** in `README.md` and `README.de.md` — PowerShell + bash recipes for a sandbox local install, Docker variant, 6-step verification checklist, and cleanup. Pulls `v1.3.0-rc.1` so users running the README straight from `main` get a known-good tag.

### Known limitations / v1.3.x backlog (not in rc.2)

- Setup wizard itself is English-only; the locale picker is in `Settings → Language` after install. Picking the locale during setup is on the v1.3.x backlog.
- Some report titles (Income Analysis, Bills Overview, …) and the FAQ content stay English when the locale switches to DE — i18n key migration for report names is on the backlog.
- FAQ still references the `TX` free-text command path that the public template removed in v1.2.0; cleanup is on the backlog.
- Setup step 6 dropdown lists may not show every MMEX-imported category when the staging payload is large; under investigation.

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
