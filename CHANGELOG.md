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

## [1.7.1-rc.1] - 2026-05-14

Patch release on top of `v1.7.0`. Three backend fixes — no schema or
config changes, drop-in for existing installations.

### Fixed

- **Integrity check (`scripts/cron_integrity.py`) reported false-positive
  orphans on pass-through accounts.** The reimbursement matcher
  compared each expense line individually against income lines with a
  ±1-day tolerance, which broke for three legitimate booking patterns:
  receipt splits that share a single aggregated reimbursement,
  reimbursements booked several days after the spend, and same-day
  salary + savings transfer pairs that are reimbursed together. The
  matcher now runs in two stages: (1) aggregate expenses per
  `(date, account, receipt_group_or_solo)` and match against income
  amounts on the same account within ±14 days; (2) for any remaining
  unmatched bucket, run a subset-sum over same-day transfer-outs as a
  fallback. Closes the bulk of stale orphan warnings without weakening
  the check — genuine orphans still surface.
- **HTML cache-bust marker stayed stale across normal version bumps.**
  `_serve_html_with_cache_bust()` appended `?v=<WIZARD_VERSION>` to
  every JS/CSS reference, but `WIZARD_VERSION` only moves on major
  releases. Between point releases the marker stayed identical, which
  meant the browser's 1-hour static-asset cache never invalidated and
  users saw stale `app.js` / dashboard bundles long after a deploy.
  The marker now uses the footer's `app_version` (parsed from
  `dashboard/index.html` via `_read_app_version()`) and falls back to
  `WIZARD_VERSION` only when the footer can't be parsed.
- **`meter_reading_kwh` was silently dropped from new LUKU entries.**
  `serve.py:handle_luku_add` accepted the field in the request body
  but never passed it through to `utilities.add_luku_entry`, so the
  column stayed empty in `data/luku_log.csv` regardless of what the
  user typed. The endpoint now forwards the value with string/number
  normalisation so both form-encoded and JSON callers behave the same.

## [1.7.0] - 2026-05-13

Promoted from `v1.7.0-rc.1` after end-of-day verification on the
upstream maintainer's Pi (`pi-host`): boot-time drift check clean,
service running on `0.0.0.0:8080` via `tailscale serve` HTTPS at
`https://pi-host.your-tailnet.ts.net/dashboard/`, all dashboard pages +
PWA reachable. No functional changes vs rc.1 — same tree at commit
`831e606`. See the `[1.7.0-rc.1]` section below for the full release
notes (115 / 115 Code-Review-2026-05-12 findings closed, plus two
new dashboard features).

## [1.7.0-rc.1] - 2026-05-13

End-of-day rollup of the full Code-Review 2026-05-12 closure. 25
sprints, 115/115 findings closed (13 Critical + 32 High + 41 Medium +
29 Low). Two new dashboard features land alongside the hardening.

### Added

- **Accounts overview: opt-in multi-currency Balance columns.**
  Chip-strip toggle "Also show in: [TZS] [EUR] [USD] [PLN]" above
  the accounts table. Each active chip adds a `Balance (CUR)` column
  showing every account converted into that currency, plus a
  `Total {{group}} (≈ CUR)` row per group. Selection persists in
  `localStorage` (`lp-accounts-extra-cols`). Native-currency totals
  stay unchanged.
- **ATM-fee auto-cascade in Add TX.** `build_manual_lines()` detects
  a bank→cash-like transfer with an exact-amount match against
  `data/atm_fees.csv` and expands it into a 4-row batch (transfer +
  fee_net + levy + VAT). Fee rows are flagged `is_auto_generated`
  so the preview shows them with the auto badge. The transfer line
  picks up the `ATM` tag automatically.
- **Boot-time `requirements.txt` drift check** via `importlib.metadata`.
  Prints a `[warn]` block when the venv lags the pinned dependencies
  — catches the bcrypt-style outage after a deploy that bumped
  `requirements.txt` but didn't `pip install -r` in the active venv.
- **Boot-time `auto_tag` schema validator** rejects typo'd rule keys
  (`by_acccount` with three c's etc.) at save time and warns on boot
  when the on-disk config has issues.
- **Decimal accumulators for money** in `cost_overview` and
  `ytd_cumulative` — multi-month cumulative sums no longer drift
  cents through float-arithmetic. Float only at the JSON boundary.
- **Single-flight locks + pre-scan size caps** on `/api/backup/export`
  (200 MB, excludes `data/receipts/`) and `/api/receipts/export`
  (500 MB). Second concurrent caller gets HTTP 429.
- **Argv allowlist** on `/api/backup/create` — `target` is validated
  against `backup.BACKUP_TARGETS` before reaching `subprocess.run`.
- **Request-body cap** of 60 MB on every `do_POST` so a hostile
  Content-Length can't OOM the Python server.
- **Per-IP serialization lock** for the auth throttle so the sleep-
  delay actually slows N concurrent attackers from one source.
- **AES-key rotation on PWA logout** — the encrypted-creds blob plus
  the wrapping key get wiped in one IDB transaction.
- **IDB-quota soft-limit warn** via `navigator.storage.estimate()`
  plus a compensating delete if a queued receipt blob fails to write
  after its TX row landed.
- **`syncQueue` in-flight promise lock** + automatic retry of error
  rows up to 5 attempts with per-row `retry_count`.
- **`/api/health` minimal payload** for unauthenticated callers when
  the server is in `auth.mode=basic` — drops hostname / git status /
  data-dir size from the response.
- **`pyproject.toml`** with pytest + ruff config; **MIT LICENSE** at
  repo root.

### Changed

- **Properties Settings UI fully internationalized.** 35 dormant
  `settings.properties.*` keys were finally wired up; DE-locale users
  no longer see the Properties tab in English.
- **CRDB-reconciliation Pass-2 aggregation** only fires on real
  receipt-group splits. Three separate same-day same-payee
  transactions no longer collapse into one bucket that the first
  bank line over-claims.
- **`add_payee` case-insensitive dedup** — `add_payee({"payee": "Acme"})`
  followed by `add_payee({"payee": "ACME"})` returns the existing id
  instead of creating a second record.
- **`generate_import_id` collision re-validation** happens under
  `tx_write_lock` so two concurrent writers can't both produce the
  same `_2` suffix.
- **Pass-through reimbursement category map** picks up Settings
  changes without a server restart (Proxy class replaces the
  module-level dict that was captured at import time).
- **Forecast widget** classifies scheduled income vs expense by
  category prefix and uses `max(actual+sched, baseline)` instead of
  additive projection — no more double-counting of recurring
  scheduled entries that are already in the 6-month average.

### Fixed

- **Trailing-slash redirect** for directory URLs (`/dashboard` →
  `/dashboard/`) behind reverse proxies. The cache-bust handler used
  to short-circuit `SimpleHTTPRequestHandler`'s redirect and ship
  index.html at the un-slashed URL, which broke every relative href.
- **Subscription URL filter** rejects `javascript:` / `data:` /
  `vbscript:` / `file:` schemes before they reach the anchor's
  `href`. Paste-and-click no longer fires arbitrary script in the
  dashboard origin.
- **24+ XSS render paths** now escape `account.alias`, `account.name`,
  `tx.account`, and related fields — covers `<option>` dropdowns,
  every transaction table render, the recent-TX widget, sidebar
  account links, the receipt lightbox, the pay-debt modal, and the
  quick-expense chip.
- **`SimpleHTTPRequestHandler` jail-check** against `REPO_ROOT` so a
  symlink inside the repo pointing outside it can't pivot
  cache-bust into serving arbitrary HTML from disk.
- **SQLite magic-byte check** on the MMEX-upload path refuses
  non-SQLite payloads upfront — junk uploads never hit the parser.
- **Bcrypt errors surface to stderr** so a corrupt-hash on disk is
  diagnostically distinguishable from a wrong-password rejection.
- **Account-input length caps** — alias 32 chars max
  (`[a-z][a-z0-9_]{0,31}`), name 64 chars max — enforced on both
  add and update, plus client-side `maxlength` + `pattern`.
- **`parse_amount` rejects** NaN, infinity, negative numbers, and
  inputs longer than 32 characters — earlier validators that did
  `amount <= 0` checks silently let NaN/inf slip into
  `transactions.csv`.
- **PWA receipt-paste handler** was probing the wrong DOM element
  (`#view-tx`) since v1.6.0; now checks `screen-main.classList.contains
  ('active')` and the paste-to-attach flow works again.
- **Backup retention ring** no longer rotates valid snapshots out
  during rapid edit sessions of `subscriptions.csv` and
  `subscription_log.csv` — backup only runs when the new content
  actually differs from disk.

### Security

- **CSRF gate** on every mutating `/api/*` POST. Same-origin
  Host==Origin shortcut covers Tailscale MagicDNS / Cloudflare
  Tunnel / ngrok without forcing the operator to extend
  `FINANCEOS_CORS_HOSTS` for every new hostname.
- **Multi-signal setup-wizard initialization check** — marker file
  alone is no longer trusted; presence of `config/auth.json` or a
  populated `data/accounts.csv` also blocks the wizard from being
  reachable on a tampered marker.
- **`counter_entry_id` FK column** on `transactions.csv` makes
  pass-through pairs explicitly linked instead of triple-field
  matching — survives manual edits.
- **Atomic cascade writes** under a reentrant `tx_write_lock` for
  fuel + utilities CRUD (update / delete / add all see the cascade
  as all-or-nothing).
- **PWA-XSS hardening** in the queue renderer (payee / account /
  date / currency all routed through `escapeHtml`).
- **Privacy-verify pipeline gate** — the template-export pipeline
  scans the output tree for 30 sensitive terms and refuses to ship
  if any non-whitelisted hit remains.

### Notes

- 168 commits in the private repo land in this single public-repo
  commit. Sprint-level decomposition is in the private CHANGELOG;
  this entry summarises the user-visible deltas.
- Pre-rc.1 was v1.6.0-rc.2 (2026-05-12).

## [1.6.0-rc.2] - 2026-05-12

### Added

- **Properties module: full Cost-of-Living view.** The per-property drilldown page now surfaces every transaction carrying the property's `cost_tag` — not just LUKU + Water. New KPI cards for `Property Total {{year}}`, `Rent {{year}}`, `Service Charges {{year}}`, `Maintenance {{year}}`, `Staff {{year}}`, and `Other Costs {{year}}` (residual after the named buckets), all period-aware. A new full-width stacked bar chart "Monthly Cost Breakdown — Rent / Service Charges / Maintenance / Staff / Electricity / Water / Other" sits at the top of the charts grid, plus an "Other Costs by Category" donut for the long-tail (top-8 categories + an "Other (rest)" slice). A third log block "Other Property Costs" lists every non-utility TX with the cost_tag — Maintenance, Staff, Service Charges, etc. — with TX-id links straight back into Transactions. Period-pills now include any year that has property-tagged TX even if it had no LUKU/Water purchases.
- **Property-Picker in the Add-TX and Edit-TX forms.** A new dropdown row directly under the tag chips lists every active property. Selecting one attaches the property's `cost_tag` automatically — no more memorising tag names. The picker hides for transfer transactions (transfers aren't a cost event) and stays invisible while `data/properties.csv` has no active rows, so vanilla template forks see no UI clutter. In Edit mode the picker pre-selects the TX's current property (reverse-lookup from tags) and switching to a different property swaps the old `Property_<X>` tag for the new one atomically.
- **Cross-tag bridges in `apply_auto_tags()`.** A new `auto_tag.bridge` map propagates a source tag to additional target tags at TX-write time. Use case: a landlord-relevant cost tag can automatically flow into the per-property cost-of-living tag without bookkeeping. The pass is a fixed-point loop, so chains settle in a single iteration. Configured per-fork via `config/defaults.json` or the new Auto-Tags UI (see below).
- **Category-prefix auto-tags (`auto_tag.by_category_prefix`).** New rule type: case-sensitive category-prefix → tag. Example: a rule `Staff:Caretaker ` → `Property_HomeABC` (trailing space deliberate) catches every Salary/Bonus/Rent sub-category for that staff member without sweeping unrelated Custody / Loans rows for the same person. Joins `by_account` and `by_payee` as a third additive matcher in the auto-tag pipeline.
- **Settings → Auto-Tags — full CRUD UI for all four rule maps.** New sub-tab between Reports and Branding. Inline tables for `by_account`, `by_payee`, `by_category_prefix`, and `bridge` with add/edit/delete per row, a shared Save button, Revert-to-last-saved, plus a dedicated "Backfill matching TX" button on the category-prefix section. The backfill runs dry-run first, shows "X transactions / Y total — apply?", then writes through `_atomic_csv_rewrite`. Saves clear the `get_defaults()` lru_cache so the next TX-write picks up new rules without a server restart.
- **`scripts/category_prefix_tag_backfill.py`** — one-shot tool that walks `transactions.csv` and applies every `by_category_prefix` rule retroactively to expense rows missing the target tag. Dry-run by default, idempotent, atomic write via the same helper TX-engine uses.

### Changed

- **`apply_auto_tags(account, payee, explicit_tags, category="")`** — new optional `category` parameter. Three-arg call sites (fuel_log, ad-hoc helpers) keep working without modification; the manual TX, scheduled-fire, and LUKU/Water booking surfaces all pass the line's category through so prefix-based rules can fire on the right split.
- **`tx_engine.build_manual_lines()` computes tags per line** instead of once upfront. Split TX with mixed categories (one Staff:Salary split, one Loan:Outgoing split, same person as payee) now correctly tag only the matching split — the loan split stays untagged regardless of payee.
- **`tx_engine.AUTO_TAG_*` constants** are no longer frozen at import. The four rule maps (`accounts`, `payees`, `category_prefix`, `bridge`) are read via lazy helpers on every `apply_auto_tags()` call so the Auto-Tags UI's save-and-go workflow works without restarts. A dict-like backwards-compat proxy preserves the old `AUTO_TAG_CATEGORY_PREFIX` import for external scripts.
- **`config_loader`** gained `get_auto_tags_config()` and `save_auto_tags_config()` — atomic write preserves every other top-level key in `defaults.json` and invalidates the `get_defaults()` lru_cache on save.
- **3 new API endpoints:** `POST /api/auto-tags/get` (current rules + the list of valid Property_<X> tags from `properties.csv` for the bridge-target picker), `POST /api/auto-tags/save` (atomic upsert + git commit), `POST /api/auto-tags/backfill-prefix` (wraps `category_prefix_tag_backfill`, dry-run default).
- **`/api/properties/details`** response gained a `cost_overview` sub-object — full bucket aggregation, per-month breakdown, by-category roll-up, and TX list — feeding the new KPI cards, the stacked Monthly Breakdown chart, and the Other-Costs log block. Backend logic is shared with the existing Cost-of-Living report so both surfaces stay in sync.
- **41 new i18n keys** in `en` + `de`: Auto-Tags settings tab labels, hints, column headers, and confirm dialogs (~38 keys), plus 3 new property KPI labels and 3 shared `common.table.*` keys (Category / Note / Payee) reusable for future tables.

### Migration

After pulling this release no schema migration is needed — `cost_overview` is read-only aggregation over existing data and the new auto-tag maps default to empty. Optional follow-ups:

1. Restart `serve.py` (systemd / Docker) so the new `/api/auto-tags/*` endpoints are picked up.
2. **Settings → Auto-Tags** — add your own rules. Common starters: account `kft` → `BUSINESS_<X>` business tag; payee `landlord co name` → `House_costs`; category prefix `Staff:<Person> ` → `Property_<X>` for any household staff whose pay is genuinely a property cost; bridge `House_costs` → `Property_<X>` to fold landlord-relevant costs into the per-property Cost-of-Living view.
3. After adding a category-prefix rule, click **Backfill matching TX** on that section to retroactively tag historical transactions (dry-run first; idempotent).

## [1.6.0-rc.1] - 2026-05-12

### Added

- **Receipt attachments on transactions (Photos + PDFs).** Each transaction can now carry one or more receipt files. New module `scripts/receipts.py` handles upload, delete, multipart parsing, and image normalisation; images are re-encoded server-side as JPEG quality 92 so EXIF, GPS, camera model and any other metadata are dropped at the encoder boundary regardless of what the client sent. PDFs are stored as-is. HEIC from iPhone uploads decodes transparently via `pillow-heif`. 256-px JPEG thumbnails are generated for fast list rendering.
- **Storage layout.** Files live under `data/receipts/YYYY/MM/<hex>.<ext>` (originals) and `data/receipts/thumbs/<hex>.jpg` (thumbnails), keyed by a 16-character random hex so URLs are unguessable. The path is git-ignored by default; back it up via your usual data-volume strategy.
- **Add-TX form: three input channels.** File picker, drag-and-drop, **and clipboard paste** — copy an image (Snipping Tool / Cmd+Shift+S / browser screenshot) and `Ctrl+V` in the form drops it straight into the upload list, no file-save detour.
- **Edit-TX modal: receipt gallery.** Existing attachments render as a thumbnail grid with remove (×) buttons. New files can be added via the same picker/drop/paste channels. Save uploads new files, deletes removed ones, then PATCHes the TX in a single round-trip.
- **Transactions list: 📎 indicator + action button.** A 📎 next to the payee shows the row has receipts; a matching 📎 button in the action column (right side, between the edit/duplicate icons and the existing actions) opens a read-only viewer. Both surfaces dispatch the same `showTxReceipts` handler.
- **Lightbox + PDF embed.** Click an image thumbnail → full-screen image viewer with ESC-to-close. Click a PDF thumbnail → modal with the native browser PDF viewer (`<embed type="application/pdf">`). No PDF.js dependency needed.
- **Settings → Receipts tab.** Coverage KPIs (with / without / coverage % / storage MB / file-types breakdown) + a "missing receipts" table listing non-transfer transactions above a per-currency threshold (default TZS 50 000 / EUR 20 / USD 20 / PLN 100 / GBP 20) that don't yet have an attachment, newest first. Click **Attach →** on a row to open the edit modal directly. KPI cards render in a CSS-grid with `repeat(auto-fit, minmax(160px, 1fr))` so they all have the same width regardless of content length.
- **Bulk ZIP export.** Settings → Receipts → "Bulk ZIP export" section. Pick a date range (default: first of current month → today) plus optional account and tag filters and an "only with receipts" toggle, hit **Export ZIP**. Server builds a tempfile-backed ZIP and streams it back in 64-KB chunks (no double-buffering in memory). ZIP layout: `index.csv` with one row per transaction (date / import_id / account / type / payee / category / amount / currency / tags / files) + `files/<date>_<shortid>_<seq>.<ext>` with the original photos and PDFs, prefix-sorted chronologically. Response headers `X-Tx-Count` / `X-File-Count` power the success toast.
- **PWA: mobile camera capture + offline blob queue.** Two new buttons in the PWA TX form — 📷 Camera (`<input capture="environment">`) and 📁 Pick (file picker for images + PDFs) — plus clipboard-paste support while the TX pane is visible. Captured files persist in a new IndexedDB store `rcptqueue` (DB version 3, schema-additive upgrade) so they survive across app reloads and browser restarts. `syncQueue()` uploads the blobs ahead of each pending TX, sets `receipt_url` from the returned URLs, then submits the TX through the existing `/api/tx/manual` + `/api/tx/confirm` flow. If the upload fails the TX is held back (`status='error'`) so a transaction never lands without its photos.
- **Scheduled-TX ↔ Subscription auto-link.** Recurring templates in `data/scheduled.csv` can now reference an optional `subscription_id`. When the template fires (manual via `SCHED` command or via `scripts/cron_sched.py`), `cron_sched.run_due` writes a matching row into `subscription_log.csv` automatically — no more manual re-linking each month. Pass-through reimbursement counter-entries deliberately stay unlinked (only the expense line carries the link). Settings → Scheduled gets a dropdown picker for the field, and SCHED rows show a 🔗 badge with the linked subscription name when set. Migration: `python scripts/migrate_v151_sched_subscription.py` adds the new column to existing CSVs (idempotent, takes a backup first).
- **Subscriptions drift alert.** New helper `subscriptions.compute_drift_alerts(threshold_pct=5.0)` compares the most recent charge in `subscription_log.csv` against the prior charge per active subscription and surfaces alerts when the increase is at or above the threshold. Hooked into the regular `computeAlerts()` pipeline so drift findings render in the dashboard alerts widget alongside scheduled / balance / fuel alerts. Endpoint: `POST /api/subscriptions/drift_alerts`. Inactive subscriptions and logs with fewer than 2 entries are skipped — there's nothing to compare against, and you can't act on an alert for a cancelled subscription anyway.

### Changed

- `tx_engine.build_manual_lines()` propagates the new `receipt_url` field from the form payload into every generated TX line, including split rows (all split lines share the same uploaded receipts — one receipt photographed once, multiple categories).
- `tx_engine.SCHEDULED_FIELDS` gained a `subscription_id` column. Existing CRUD entry points (`load_scheduled` / `add_scheduled` / `update_scheduled` / `save_scheduled`) flow it through automatically, no API change for callers.
- `tx_engine._atomic_write_bytes()` — binary equivalent of the existing `_atomic_write_text`, used by the receipts module so a crashed upload mid-write can't truncate an existing file.
- `dashboard/styles.css` extended with the receipt grid, tile, pending-state, lightbox, PDF-embed, and 📎-icon styles. Drag-over states use the accent colour so the dropzone is visibly active.
- Caddy reverse-proxy config (`deploy/Caddyfile`) routes `/data/receipts/*` to the file_server directly (7-day cache; hex filenames are effectively content hashes), so thumbnails and PDFs don't tie up the Python process.
- 16 new i18n keys for the Bulk ZIP export form (`settings.receipts.export.*`) + 12 new keys for the Receipts tab + 4 keys for the SCHED-Subscription picker + 3 keys for the drift alert. All synced EN ↔ DE.

### Migration

After pulling this release:

1. `pip install -r requirements.txt` — picks up the new `Pillow>=10` and `pillow-heif>=0.13` dependencies (10-15 MB).
2. `python scripts/migrate_v151_sched_subscription.py` — idempotent; adds the `subscription_id` column to `data/scheduled.csv` if it isn't already present. Takes a backup before rewriting.
3. Restart the FinanceOS service.

The PWA's IndexedDB schema upgrades on first open after the deploy (v2 → v3, store `rcptqueue` added). Existing TX-queue and auth records are preserved.

### Footer

- `WIZARD_VERSION`: `1.5.0-rc.1` → `1.6.0-rc.1`

## [1.5.0-rc.1] - 2026-05-10

### Added

- **Properties subsystem (electricity & water tracking).** New top-level page (sidebar entry **Properties**, feature-flag `properties`, default-OFF in the Setup-Wizard since the prepaid-meter model is most common in East Africa — fully configurable for any utility model). Per-property drilldown with KPIs (electricity / kWh / water YTD, avg price/kWh, rolling-12 monthly averages, latest entry / days-since), 9 charts (monthly cost / kWh / water cost / yearly stack / price-per-kWh trend / YTD-cumulative current-vs-prev electricity + water / purchases-per-month / seasonality heatmap), full LUKU + Water log tables with Edit/Delete + receipt-group cascade.
- **Properties data model.** `data/properties.csv` (header-only in the template), `data/luku_log.csv`, `data/water_log.csv`. `properties.csv` has 17 columns: id, name, address, owner, default_account, currency, electricity_payee, water_payee, electricity_meter, water_meter, water_control_number, electricity_category, water_category, cost_tag, start_date, end_date, active, notes. `luku_log` carries kWh + price-per-unit + meter-reading. `water_log` carries control_number + meter-reading. Both link back to `transactions.csv` via `tx_import_id`.
- **TX-CLI for utilities.** `TX luku <kWh>kWh <cost>` and `TX water <cost>` — free-text prefixes that create both the log entry and the linked expense TX (plus pass-through reimbursement counter-entry where applicable) atomically. Supports `account=`, `date=`, `prop=`, `meter=`, `control=`, `note=` overrides. Backend at `python scripts/utilities.py luku tx <freetext>` / `... water tx <freetext>`.
- **Cost-of-Living-per-Property report.** New entry under Reports → Expenses ("Cost of Living — Property"). Property dropdown + dynamic year pills (one per year present in the logs). Three KPI tiles (Total / Avg-per-month / biggest cost line) + stacked-bar monthly composition chart over 10 cost buckets (Rent / Service charges / Electricity / Water / Other utilities / Maintenance / Staff / Household / Legal & fees / Other) + by-bucket and by-category drill-down tables. Backend at `POST /api/properties/cost_overview` aggregates over TX tagged with the property's `cost_tag` and excludes reimbursement counter-entries so pass-through accounts don't zero out costs.
- **Property `cost_tag` auto-tagging.** Each property now has a `cost_tag` field (default-derived from `property_id` — `prop-myhouse` → `Property_MYHOUSE`). `add_luku_entry` / `add_water_entry` automatically attach this tag to the expense TX in addition to the existing pass-through auto-tags, so the Cost-of-Living report aggregates without manual tagging.
- **Lifecycle dating for properties + vehicles.** Properties get `start_date` (move-in) + `end_date` (move-out); vehicles get an `end_date` (`tracking_start_date` already doubles as acquisition). Empty = open-ended. Selector pills + drilldown headers render a lifecycle badge (`since YYYY-MM` / `until YYYY-MM` / `ended YYYY-MM`); archived rows (end_date in the past) drop to 0.7 opacity so historical periods are visually distinct from live data.
- **Year-Picker in Property-Drilldown.** Pill strip below the property selector now shows `Last 3 months / This year / <every year in the logs> / All time`. Year mode recomputes the headline KPIs client-side from the filtered logs and labels the avg-cards as `Ø {{year}}` instead of `rolling 12m`.
- **Built-in scheduler (`scripts/scheduler.py`).** Optional APScheduler-based daemon thread that runs `cron_fx` (06:00 UTC) / `cron_metals` (08:00) / `cron_sched` (09:00) / `cron_integrity` (02:00) as subprocess jobs. Auto-detects Docker (`/.dockerenv`) or opt-in via `FINANCEOS_BUILTIN_SCHEDULER=on`; bare-metal Pi defers to host cron. Override schedule via `config/scheduler.json`. `apscheduler` is an optional dependency in `requirements.txt`.
- **`scripts/serve.py --reload`.** Optional dev-loop auto-restart on `.py` changes. Parent process watches `scripts/` via `watchdog`, kills + respawns the server child on every save. Child detects itself via `FINANCEOS_RELOAD_CHILD=1` env. `watchdog` is an optional dependency.
- **Migration banner for pre-1.3.0 installs.** Alerts page surfaces a dismissable info card ("Reports may filter the wrong categories") when `config/reports.json` is missing AND transactions exist. Click → Settings → Reports. `/api/reports-config/get` now also returns `file_exists`. Generic dismissable-alert mechanism: any alert with `dismissable: '<key>'` gets a `×` button that persists in `localStorage`.
- **Properties Recon-Banner.** `compute_property_alerts()` parses `data/utilities_unmapped.md` (written by the upstream backfill helper after each XLSX import) and surfaces unmapped LUKU/Water entries as a dismissable info alert. Reuses the same dismiss mechanism as the migration banner.
- **`vehicles` and `properties` as Setup-Wizard feature toggles.** Step 5 of the Setup-Wizard now lists both subsystems alongside the existing toggles (`debt_tracking`, `metals`, `pwa`, `crdb_recon`, `quick_expenses`, `custom_reports`, `scheduled_tx`). Vehicles default-on; properties default-off (regional-fit caveat in the description).
- **Setup-Wizard form-label i18n polish.** Four hard-coded English strings (Step-1 brand title, Step-3 auth-none-confirm checkbox, Step-6 filter label + placeholder, Step-6 extra-categories textarea placeholder) now flow through `data-i18n` / `data-i18n-placeholder` with EN+DE parity.

### Changed

- **`t()` substitution supports both `{name}` and `{{name}}`.** The legacy single-brace pattern (used by ~50 keys in `accounts/accp/...`) and the Mustache-style double-brace pattern (used by ~50 keys in `alerts/properties/vehicles/...`) now both substitute correctly. Previously the regex only matched single-brace, so `over {{months}} months` rendered as `over {20} months` because the inner `{months}` was consumed and the outer braces leaked.
- **Cost-of-Living bucket classifier.** `Staff:*` is now checked before the `rent` substring match — staff rent-stipend categories now correctly land in the Staff bucket instead of inflating the Rent line. New `legal` bucket catches `Professional:Legal` + `Government:*` so lawyer fees and tribunal charges aren't anonymous "Other" rows.
- **Property-pill `.vehicle-pill-meta` contrast in active state.** Was `var(--muted)` on the dark accent background, dropping below WCAG. Now `rgba(255,255,255,0.78)` so the secondary line ("Total · YTD") stays legible on the active pill.
- **Print-CSS extended to Property-Drilldown.** Drilldown was previously hidden in `@media print` (only `#page-reports` was allowed). Now the drilldown prints as a multi-page report — interactive chrome (Add buttons, period pills) hidden, charts capped at 220px, `page-break-inside: avoid` per chart card.

### Fixed

- **Multiple chart legends in Properties were hard-coded German.** `Stromkosten` / `Verbrauch` / `Wasserkosten` / `Strom` / `Wasser` / `Median` / `TZS / kWh` are now i18n keys with EN+DE parity.
- **Cost-of-Living report rendered empty.** `renderCostPerPropertyReport` targeted `#report-detail-content` but the reports framework injects content into `#report-output`. Container-ID mismatch led to an early return without render. Fixed + added an inline error banner that surfaces "server may need to be restarted" if the new endpoint isn't yet served.

## [1.4.0] - 2026-05-09

Promoted v1.4.0-rc.2 to final. No code changes vs. v1.4.0-rc.2 — this is the version-string promotion and the GitHub release tag. The v1.4.0 series shipped the **Vehicles UI subsystem** (Settings → Vehicles tab, per-vehicle drilldown selector, optional FX Charts sidebar link) plus six modal-edit-bug fixes. Properties / Cost-of-Living / lifecycle dating land in v1.5.0.

## [1.4.0-rc.2] - 2026-05-09

### Fixed

- **Edit buttons in 6 modal forms were silently broken.** Save buttons in the Scheduled-TX, Categories, Tags, Quick-Expenses, ATM-Fees, and Debts edit modals serialized the edit-ID via `data-arg1="${isEdit ? \`'${editId}'\` : 'null'}"`. The global `data-action` dispatcher in `core.js` passes `dataset.arg1` through verbatim, so the backend received `sched_id="'sched-005'"` (8-char quoted string) instead of `sched-005` and returned `404 not found`. The Add-mode fallback string `'null'` was also truthy in JS, so an Add submission would have routed to the update endpoint instead of the add endpoint. Both bugs fixed by switching to `data-arg1="${isEdit ? escapeHtml(editId) : ''}"` — empty string is falsy, IDs ship bare. Affects every Edit operation in the listed Settings tabs and the Debts page.

## [1.4.0-rc.1] - 2026-05-09

### Added

- **Settings → Vehicles tab** — new management UI for tracked vehicles, sitting between **Accounts** and **Currency** (feature-gated `vehicles`). Lists every vehicle (active + archived) with name + plate + ID, currency, default account, default payee, and a status badge that surfaces the per-vehicle fuel-entry count. Each row gets **Edit** / **Archive** (or **Activate** when archived) / **Delete** actions. The header **+ Add Vehicle** button reuses the existing modal; Edit reuses the same modal with the row prefilled.
- **Vehicle modal — Edit mode.** `openVehicleModal(existing)` now accepts an existing vehicle record (guarded against accidental MouseEvent passthrough). Title and save label flip to "Edit" / "Update vehicle"; the form prefills every field; the save handler routes to `/api/vehicles/update`. The `active` flag is inherited from the row so the Settings tab's archive button stays the only path that toggles active state.
- **Per-vehicle drilldown on the Vehicles page.** A tab-pill row appears above the period tabs **only when 2+ active vehicles exist** (single-vehicle setups are unchanged). "All vehicles" aggregates as before; selecting a specific vehicle filters every KPI / chart / fuel table through `filterFuelEntries()`. The selection persists in `localStorage` (`lp-vehicles-selected`) and falls back to "All" automatically if the persisted vehicle is later deleted or archived.
- **Optional FX Charts sidebar link** — bridge to an external self-hosted FX/charts dashboard. Configurable in **Settings → Branding** as **FX Dashboard URL**; persists in `config/branding.json` as `fx_dashboard_url` (validated as `http(s)://`). Empty by default — the sidebar entry stays hidden, so the template ships unchanged for forks who don't run a separate FX surface. When set, an **FX Charts** entry appears between **Vehicles** and **Settings** with a `↗` indicator and opens the URL in a new tab.

### Changed

- **`/api/vehicles/delete` rejects vehicles with fuel-log history.** The endpoint now counts referencing rows in `data/fuel_log.csv` first and returns `409 Conflict` + the entry count when non-zero, so a vehicle cannot be deleted out from under its history. Frontend already mirrors this via a disabled Delete button + tooltip — the server check is defense-in-depth against direct API calls. To delete, archive first or remove the entries.
- **Vehicle modal name placeholder is now generic** ("e.g. Family car") instead of a private brand example.
- **`/api/branding/{get,save}` round-trip `fx_dashboard_url`** — the branding API and the in-memory `window.BRANDING` object both pick up the new optional URL field. `applyBranding()` patches the sidebar entry on every save so the change reflects without a reload.

## [1.3.1] - 2026-05-08

Promoted rc.9 to final. No code changes vs. v1.3.1-rc.9; this is the version-string bump and a final GitHub release. The v1.3.1 series ran through 9 release candidates over a single day (2026-05-08), driven by a fresh-fork Windows-11 testing pass.

### Highlights of the v1.3.1 patch

- **Discretionary vs. Fixed — clearer settings hint + empty-state warning** (rc.1).
- **Historical FX-rate backfill** (rc.2): new `scripts/fx_backfill.py` (Bank of Tanzania + Frankfurter cross-rate), `POST /api/fx/backfill` + Settings UI + Setup-Wizard auto-delta hook, `cron_fx.py` upgraded to BoT-primary with er-api fallback. Public template now ships the populated `data/fx_rates_history.csv` (8 years of daily rates back to 2018-01-01) so fresh forks render historical multi-currency reports correctly out of the box.
- **Dividends as a first-class income source** (rc.3): new bucket alongside Salary / Interest / Investments & Sales / Reimbursement / Refunds; seed category `Income:Dividends` + Income Sources Breakdown column.
- **Windows console flash gone** (rc.3 / rc.4): `CREATE_NO_WINDOW` + `pythonw.exe` for detached spawns — no more transient console window flickering on every TX save.
- **JS/CSS cache-busting** (rc.5): every release bump appends `?v=<WIZARD_VERSION>` to script/link references, so deploys reach users immediately without manual hard-reload.
- **FX backfill as a background job** (rc.6): kick off in one tab, leave / close the browser, come back later — `POST /api/fx/backfill/status` + localStorage resume.
- **Add Account UI** (rc.7): Settings → Accounts → "+ Add Account". Closes the gap where new accounts could only be created via the Setup-Wizard or hand-editing `data/accounts.csv`. Hard-delete intentionally not implemented; `status='archived'` stays the canonical "remove" path.
- **Full Setup-Wizard German translation** (rc.8 / rc.9): every previously hardcoded English string now uses `data-i18n` / `data-i18n-html`. DE renders Custody as **Treuhand**, Pass-through as **Durchlauf**, plus every step's labels, hints, feature checkboxes, and Step 7 review labels.
- **Dividends defaults wired through `config_loader.py` REPORTS_DEFAULTS + `setup.js` initial state** (rc.4) so the wizard's "Customize now" path pre-selects `Income:Dividends`.

### Footer

- `WIZARD_VERSION`: `1.3.1-rc.9` → `1.3.1`

## [1.3.1-rc.9] - 2026-05-08

### Fixed

- **Setup-Wizard: every remaining hardcoded English string is now translatable.** rc.8 covered Step 7 (account-type dropdown + review labels). rc.9 finishes the rest: the "Setup already complete" banner, Step 1 form labels (Display name / Accent color), Step 2 ISO-code label, Step 3 Auth options + username/password labels + the warning banner, Step 4 datasource options + upload button + "Imported records" heading, Step 5 feature checkboxes (all 7 features with `<strong>name</strong> — desc` rendered via `data-i18n-html`), and Step 6 customize hints + extra-categories summary/button. ~30 new keys per locale. DE translations cover everything; EN keys are also present so future locales drop into the same skeleton.

### Footer

- `WIZARD_VERSION`: `1.3.1-rc.8` → `1.3.1-rc.9`

## [1.3.1-rc.8] - 2026-05-08

### Fixed

- **Setup-Wizard Step 7 account-mapping was English-only on a German install.** The account-type dropdown rendered values straight from the backend's `ACCOUNT_TYPES` list (English labels: "Custody", "Pass-through", "Bank account", …), and the Step 7 review headers (Brand / Currency / Auth / Datasource / Features), the "Account aliases" sub-heading, the long alias-hint paragraph, and the table column headers had no `data-i18n` attributes at all. Added `data-i18n` to all those nodes and a new `setup.account_type.<key>` lookup in `setup.js` that translates the dropdown label via `t()` while keeping the backend's English label as fallback. New i18n keys for EN + DE; DE renders Custody as "Treuhand", Pass-through as "Durchlauf", Cash as "Bargeld", etc.

### Footer

- `WIZARD_VERSION`: `1.3.1-rc.7` → `1.3.1-rc.8`

## [1.3.1-rc.7] - 2026-05-08

### Added

- **Add Account UI** in Settings → Accounts. Until now, accounts could only be created via the Setup-Wizard's MMEX import or by hand-editing `data/accounts.csv` — a real gap once a user wanted to onboard a new account post-setup. The "+ Add Account" button opens a modal with alias / name / currency / type / owner / initial balance / initial balance date / notes / "include in Net Worth" fields. Validation enforces alias uniqueness (lowercase letters/digits/underscore, must start with a letter) and ISO-3 currency codes. Type / owner / currency dropdowns seed from the install's existing distinct values plus a fallback list, so a fresh fork already sees `bank` / `cash` / `savings` / `credit_card` / `mobile_money` / `pass_through` before any account exists. New `POST /api/accounts/add` writes via the standard atomic-CSV + backup + git-commit cascade. Hard-delete is intentionally NOT included — the existing `status='archived'` flow stays the canonical "remove" path because it preserves the transaction audit trail.

### Footer

- `WIZARD_VERSION`: `1.3.1-rc.6` → `1.3.1-rc.7`

## [1.3.1-rc.6] - 2026-05-08

### Changed

- **FX backfill is now a background job — leave the page, come back later.** Previously `POST /api/fx/backfill` ran synchronously and the user had to keep the Settings → Currency tab open until completion (a few seconds for a delta, several minutes for a multi-year seed). The endpoint now returns immediately with a `job_id` and runs the backfill in a daemon thread; the result lives in an in-memory job registry. The frontend persists the active `job_id` to `localStorage` and polls a new `/api/fx/backfill/status` endpoint every 3 seconds — navigating away from Settings (or even closing the browser) does not stop the work, and re-opening Settings → Currency picks up the same job and shows its result.

### Footer

- `WIZARD_VERSION`: `1.3.1-rc.5` → `1.3.1-rc.6`

## [1.3.1-rc.5] - 2026-05-08

### Fixed

- **JS/CSS cache-busting on every release.** `serve.py` caches `/dashboard/*.{js,css}` for 1 hour to keep page reloads fast during a work session. The downside: a deploy that shipped a fixed `setup.js` wouldn't reach users until either the cache TTL expired or they manually hard-reloaded — meaning a real bug fix could appear "still broken" for an hour after the deploy. The HTML response handler now rewrites every `<script src="x.js">` / `<link href="x.css">` reference to `<script src="x.js?v=<WIZARD_VERSION>">`. Each release bump invalidates the cache for every browser automatically without losing the 1-hour cache benefit during normal use. Absolute URLs (CDN libs) and references that already carry a query string are left untouched.

### Footer

- `WIZARD_VERSION`: `1.3.1-rc.4` → `1.3.1-rc.5`

## [1.3.1-rc.4] - 2026-05-08

Two follow-up fixes after rc.3 found-during-fresh-test:

### Fixed

- **Dividends bucket appeared in the UI but was empty in the wizard.** rc.3 added the new bucket to the section spec and to the shipped `config/reports.json`, but two hardcoded defaults blocks were overlooked: `scripts/config_loader.py` REPORTS_DEFAULTS (Python-side fallback) and `dashboard/setup.js`'s own state initial block (used to pre-fill the Setup-Wizard Step 6 form). The Dividends row showed up but with no pre-selected category. Both now seed `Income:Dividends`.
- **Windows console flash made truly invisible.** rc.3's `CREATE_NO_WINDOW` flag suppresses the new console window, but `python.exe` still flashes briefly during console-host attach/detach on Windows 11. The detached `_trigger_async_sync` spawn and `serve.py`'s backup spawn now use `pythonw.exe` (the windowless Python interpreter) when available — no flicker even on a stress-clicked tag-toggle. POSIX behaviour unchanged.

### Footer

- `WIZARD_VERSION`: `1.3.1-rc.3` → `1.3.1-rc.4`

## [1.3.1-rc.3] - 2026-05-08

Two small but visible improvements landed in the same RC: a missing income classification, and a Windows-only papercut.

### Added

- **Dividends as a first-class income source.** Setup-Wizard Step 6 + Settings → Reports now expose **Dividends** as its own bucket alongside Salary / Interest / Investments & Sales / Reimbursement / Refunds. The Income Sources Breakdown report renders a 6th column for it, and the seed categories include `Income:Dividends` ("Stock / fund / ETF dividend distributions"). Previously dividends had to be lumped into `Income:Investments` together with capital gains and interest — fine for accounting but useless for "where does my income come from?" reporting.

### Fixed

- **No more Windows console flash on every transaction save.** Each `git commit` issued by FinanceOS used to pop a transient console window on Windows because Python's default subprocess invocation creates one. The flash was visible whenever a user added / edited / deleted a transaction (the auto-commit path), or when the dashboard ran a backup or git-status check. Added `creationflags=CREATE_NO_WINDOW` to every subprocess invocation that runs git or python in `tx_engine.py`, `cron_commit.py`, and `serve.py`. POSIX behaviour unchanged (the flag is no-op on non-Windows).

### Footer

- `WIZARD_VERSION`: `1.3.1-rc.2` → `1.3.1-rc.3`

## [1.3.1-rc.2] - 2026-05-08

Multi-currency forks were dependent on the daily `cron_fx.py` to accumulate FX history over time — fresh forks rendered historical reports with today's rates retroactively applied to past months. This RC fixes that with two pieces:

### Added

- **`scripts/fx_backfill.py`** — CLI for filling `data/fx_rates_history.csv` from Bank of Tanzania (TZS-quoted EUR/USD) + Frankfurter (PLN/TRY via EUR cross-rate). Idempotent merge that never overwrites existing rows. Auto-detects start date from the last CSV row; explicit `--since`/`--until` for seeding gaps. Atomic write + backup snapshot before each run.
- **`POST /api/fx/backfill` endpoint** so the dashboard can run the backfill on demand without dropping to a terminal.
- **Settings → Currency → "Backfill historical rates"** — UI section with optional since/until date inputs and a status panel. Surfaces the merge summary inline (new dates, filled cells, total rows, optional Frankfurter warning).
- **Setup-Wizard auto-delta hook** — after the wizard's finalize step, the dashboard fires a fire-and-forget POST to `/api/fx/backfill` so fresh forks land with current rates without the user needing to know the script exists.
- **Public template now ships the populated `data/fx_rates_history.csv`** (8 years of daily rates, 2018-01-01 → release date, no PII). Was a header-only stub before. Fresh forks immediately render multi-year multi-currency reports correctly.

### Changed

- **`cron_fx.py`: BoT-primary fetch with er-api fallback.** Daily snapshot now prefers Bank of Tanzania for TZS-quoted EUR/USD and falls back to the er-api endpoint configured in `config/defaults.json` only if BoT is unreachable. PLN/TRY are derived via Frankfurter EUR cross-rate. The fetch returns `(rates, source_label)` so the daily log shows which source fired.

### Documentation

- `docs/faq.md` + `docs/faq.de.md`: new "Backfill historical FX rates" section explaining the Settings button + when to use it; "Currency Switcher" section updated with the BoT-primary / er-api-fallback flow.



## [1.3.1-rc.1] - 2026-05-08

First patch release after v1.3.0 — small but real UX gap surfaced while testing v1.3.0 fresh.

### Added

- **Discretionary vs. Fixed — empty-state warning.** When the report has expense data but **none** of the user's categories match any configured Fixed prefix, the chart shows everything as 100% Discretionary with no explanation why. The renderer now prepends a warning banner pointing to Settings → Reports so users can fix their prefix list. Affects both monthly and yearly views. New i18n keys `reports.fv.empty.{title,body,cta}` for EN + DE.

### Changed

- **Clearer hint for the Fixed-prefixes textarea.** The settings hint previously said "Use exact name or trailing colon for a prefix (e.g. 'Bills:')" — ambiguous about how `Rent` (no colon) and `Bills:` (with colon) differ. Now: "Trailing colon = whole subtree (e.g. 'Bills:' matches every Bills:* category). No colon = exact category name. Everything else → Discretionary." Empty textarea also shows a placeholder example.
- **Setup-Wizard prefix section now has hint text.** The Setup-Wizard Step 6 rendered the Discretionary vs. Fixed textarea with **no hint at all** — users seeing it for the first time had to guess. Now uses the same hint i18n key as the Settings tab.

### Deprecated

### Removed

### Fixed

### Security

## [1.3.0] - 2026-05-08

Promoted rc.17 to final. No code changes vs. v1.3.0-rc.17; this is the version-string bump and a final GitHub release. The full v1.3.0 series ran through 17 release candidates over 2026-05-07 and 2026-05-08, driven by a Windows-11 testing pass against a real MMEX file.

### Highlights of the v1.3.0 minor

**Configurable reports** (rc.1+) — eight category-driven reports (Bills, AI Costs, Dining, Vice, Bank Fees, Cash Discrepancy, Automobile, Discretionary vs. Fixed) read their filter rules from `config/reports.json`. Settings → Reports + Setup-Wizard Step 6 let users map their own category names without touching code.

**Bilingual delivery** (rc.5–rc.8, rc.13) — full DE locale (incl. setup wizard, FAQ, report titles + filter labels). Locale picker in Settings + the wizard's first step.

**Per-account type dropdown in Step 7** (rc.6) — user picks `cash` / `bank` / `savings` / `credit` / `loan` / `mobile_money` / `brokerage` / `pass_through` / `custody` / `other` per account during setup.

**Setup-Wizard category mapping** (rc.5–rc.10) — Step 6 unions every category source (MMEX staging + EMPTY_START + bucket defaults + already-selected + user-typed). Filter input + diagnostic banner + "Add categories manually" textarea.

**Brand follows the configured display name everywhere** (rc.11) — sidebar logo, mobile top-bar, page heading and tab title all read from `config/branding.json`. Self-heals on existing forks.

**SCHED button on the Dashboard** (rc.12) — fire due scheduled transactions with one click instead of relying on the Pi cron. Modal with full TX preview + per-row checkboxes.

**Add Vehicle dialog** (rc.13) — `+ Add Vehicle` next to `+ Add Fuel Entry`, with a form that POSTs atomically to `/api/vehicles/add`.

**`initial_balance` sign preservation** (rc.14) — credit-card and loan accounts keep their negative opening balance through MMEX import.

**Footer version matches the wizard label** (rc.14) — both show `v1.3.0` after this final release.

**Upstream-private "House 4C / Household Costs" report dropped from the template** (rc.15) — fork users got an empty report by default; replaced by the Custom Reports flow.

**Actionable empty-state on every category-driven report** (rc.16, rc.17) — when a report has zero matches across the dataset, it now shows the configured categories, the user's actual categories, and a deep link to Settings → Reports.

**Documentation** — full `docs/faq.de.md` ships alongside `docs/faq.md`. New "Running locally vs always-on" FAQ section explains which features need a 24/7 host (scheduled transactions, FX history, integrity checks) vs. which work fine on a stop/start laptop, with concrete Windows Task Scheduler / cron snippets.

### Upgrading from 1.2.x

`git pull origin main && git checkout v1.3.0` → restart `python scripts/serve.py` → hard-refresh the browser. Existing data files stay untouched.

If your dashboard balance for a credit-card or loan account looks wrong (off by 2 × |opening|), open `data/accounts.csv` and check the `initial_balance` sign — re-importing your MMEX file with the v1.3.0 wizard will fix it; for instances already initialised, just flip the sign manually.

### Upgrading from any 1.3.0-rc.X

Same as 1.2.x but no data fix needed.

## [1.3.0-rc.17] - 2026-05-08

### Added

- **Empty-state extended to Bills Overview, Automobile, and Cash Discrepancy.** rc.16 introduced the actionable empty state on the four simple category-driven reports (AI / Dining / Vice / Bank Fees). rc.17 brings the same treatment to the three remaining cat-driven reports with their own render paths:
  - **Bills Overview** (bucket-based, container `bl-content`)
  - **Automobile** (bucket-based, container `au-content`)
  - **Cash Discrepancy** (single-shot render, falls into `report-output`)

  Every category-driven report on the dashboard now shows an actionable panel with the configured categories, the user's actual categories, and a deep link to Settings → Reports when the report has zero matches across the dataset.

- **Discretionary vs. Fixed** is intentionally NOT wired up — its semantics work fine with zero `fixed_prefixes` matches (everything renders as "discretionary"), so an empty state would be misleading.

### Why this completes Punkt 4

After the rc.10 testing pass we identified four findings, the last of which was "every report should function out-of-the-box". rc.15 dropped the upstream-private House 4C report. rc.16 + rc.17 close the remaining gap: when a report can't show data because category names differ, the user sees an actionable fix path instead of an empty chart. That converts "this report is broken" into "click here to map your categories" — a single click away from working data.

## [1.3.0-rc.16] - 2026-05-08

### Added

- **Actionable empty-state for category-driven reports.** When a report (AI Costs, Dining Out, Vice Spending, Bank Fees) has zero matching transactions across your entire dataset — almost always because your category names differ from the report's defaults — you now see an actionable panel instead of a blank chart:
  - Title: "No matching transactions"
  - List of the categories the report is currently configured for
  - List of your own expense categories (top 30) for quick reference
  - "Fix in Settings → Reports" button that deep-links to the right tab

  Replaces the previous "empty chart that looks like the app crashed" behaviour. Bills Overview, Automobile, Discretionary vs. Fixed and Cash Discrepancy share the same root cause but use bespoke render paths — they get the same treatment in a follow-up rc.

### Why this matters

Until rc.15 you'd open a report after MMEX import, see nothing, and have no clue whether the report was broken or your data was wrong. Now you see exactly which categories the report wants vs. which categories you actually have, and one click takes you to the mapping UI. Closes the long-standing UX gap "I installed it and Reports look broken".

## [1.3.0-rc.15] - 2026-05-08

### Removed

- **"House 4C Costs" / "Household Costs" report dropped from the template.** Until rc.14 the public template shipped a renamed version of the upstream's "House 4C Costs" report — a tag-filtered view of expenses tagged `Household_costs`. In practice, fork users always landed on an empty report because the default tag name almost never matched their own data, and the only fix was a manual Settings → Reports tag remap. The report is now stripped from the public template entirely. If you want a similar view for your own house / project / tag, build a Custom Report with a `tag equals "<your-tag>"` filter and save it.

### Migration note

If you're upgrading from rc.{1..14} and were already using the report (unlikely without manual setup): your tag column in `tags.csv` and your tagged transactions are untouched. Open Custom Reports → New, pick your tag, and you reproduce what the report did in 30 seconds.

## [1.3.0-rc.14] - 2026-05-08

### Fixed

- **Setup-Wizard preserved sign on `initial_balance`.** Until rc.13, the wizard's MMEX importer wrote `accounts.csv initial_balance` through a helper that strips the sign (correct for transaction amounts, wrong for opening balances where negative means debt on credit cards or outstanding loans). Fork users with MMEX files containing negative-balance accounts saw the dashboard balance for those accounts off by **2 × |initial_balance|** — a credit card with a `-885.44 EUR` MMEX opening showed `+1,770.88 EUR` after wizard setup. rc.14 introduces `_format_signed_amount()` and uses it for `initial_balance` only. Re-run the setup wizard on a fresh fork to apply, or hand-edit `data/accounts.csv` to flip the sign on any affected account.
- **Footer version matches the wizard label.** Until rc.13 the template's dashboard footer showed `vYYYY-MM-DD.NN` — Leon's private version scheme. Pipeline now reads `WIZARD_VERSION` from `setup_core.py` and substitutes it into the footer during export (`v1.3.0-rc.14` for this release). The wizard label upper-right and the footer lower-left now agree, which makes "what version am I on?" a one-glance answer.

### Upgrading from rc.13

For fresh installs: just clone v1.3.0-rc.14 and run the wizard normally.

For instances already initialised on rc.{1..13}: the only data fix needed is for accounts where `initial_balance` was negative in MMEX. Open Settings → Accounts and check whether your credit-card / loan accounts show the right opening (negative for debt) — if not, flip the sign manually. This affects exactly the accounts where you provided a negative opening balance during MMEX import.

## [1.3.0-rc.13] - 2026-05-07

### Added

- **Add Vehicle dialog on the Vehicles page.** A new **"+ Add Vehicle"** button next to "+ Add Fuel Entry" opens a form modal (name, license plate, currency, default account, default payee, default category, tracking start date, notes). Save persists atomically to `data/vehicles.csv` with a git commit, then re-renders the page. Until rc.13 the only way to add a vehicle was hand-editing the CSV.
- **Three new vehicle CRUD endpoints**: `POST /api/vehicles/{add,update,delete}`. Atomic via `tx_engine._atomic_csv_rewrite`. Delete leaves orphan `vehicle_id` references in `fuel_log.csv` so historical aggregates stay intact.
- **German FAQ.** `docs/faq.de.md` shipping alongside the existing `docs/faq.md`. The dashboard's FAQ loader already tried `/docs/faq.{locale}.md` first with an EN fallback — until rc.13 the DE locale silently fell back to English because no DE file existed. Full ~600-line translation covering every section: overview, transactions, pass-through/custody, scheduled, ATM, accounts, categories, reports, updates, PDF export, dashboard, reconciliation, debts, payees, quick expenses, budgets, deployment, hard rules, feature flags, defaults, smart defaults, i18n, setup wizard, authentication, changelog.
- **New FAQ section "Running locally vs always-on"** in both EN and DE. Documents which features need a 24/7 host (scheduled transactions, FX-rate history, integrity checks) vs. which work fine on a laptop you stop/start. Concrete Windows Task Scheduler / cron snippets for users who want the FX-rate snapshot to keep running while they sleep. Answers the recurring question: "I run this only on my laptop — what breaks?"

### Changed

- **`scripts/fuel.py` exposes vehicle CRUD helpers** (`add_vehicle`, `update_vehicle`, `delete_vehicle`, `save_vehicles`). Used by the new API handlers; the existing `load_vehicles()` consumers are untouched.

### Why this matters

Two of the three remaining "found by Leon during rc.10 testing" findings get cleared:
- "Vehicles modul ist da, aber ich kann kein Auto hinzufügen" → the Add Vehicle dialog ships.
- "FAQ lässt sich nicht auf deutsch einstellen" → real German content under the locale-aware loader.

The third (FX-rate-history scheduling on local-only setups) is now documented end-to-end. The integrated `apscheduler` thread that would obviate Task-Scheduler entirely stays on the v1.4.0 list.

## [1.3.0-rc.12] - 2026-05-07

### Added

- **"Run due scheduled" button on the Dashboard.** When at least one entry in `data/scheduled.csv` has `next_run <= today`, a "Run N due now" button appears in the Upcoming Payments section header. Click → modal with full TX preview: every due entry as a checked-by-default row showing primary line, optional pass-through counter-entry, and the `next_run` date set after booking. Uncheck what you want to skip → "Book selected" fires the atomic backup + append + git-commit flow. **This unblocks local Windows / Linux deployments** — previously you had to either run the Pi cron, or shell into the repo and run `python scripts/cron_sched.py`. Now it's a button click.
- **Two new API endpoints** behind the widget: `POST /api/scheduled/preview-due` (read-only preview) and `POST /api/scheduled/run-due` (atomic write, optional `selected_ids` filter). Returns HTTP 207 if TXs were appended but git commit failed (partial-success state, surfaces clearly to the UI).

### Changed

- **`scripts/cron_sched.py` refactored** to expose `build_preview()` and `run_due()` as importable helpers. CLI behaviour (`python scripts/cron_sched.py [--dry]`) is unchanged — the cron job still runs the way it always did.

### Why this matters for local-only setups

Until rc.11 the only way to fire due scheduled transactions was the Pi cron at `0 6 * * *`. If you run FinanceOS only on your laptop, scheduled entries never fired automatically. The rc.12 widget gives you a one-click daily ritual that's idempotent (safe to click twice — second click finds nothing due) and atomic (single git commit per batch, both `transactions.csv` and `scheduled.csv` updated together).

## [1.3.0-rc.11] - 2026-05-07

### Fixed

- **Sidebar logo, mobile top-bar and page heading now follow your configured brand name.** After the Setup Wizard saved your brand (e.g. "MyMoney"), the browser tab updated correctly but the sidebar logo, mobile top-bar and page `<h1>` still said "FinanceOS" — the template default. Root cause: `config/branding.json` was being written with `display_name` only, no `display_name_html` — so anything bound via `[data-brand-html]` (sidebar / topbar / heading) fell back to the JS default in `core.js`.
  - `scripts/setup_core.py write_branding()` now writes `display_name_html` alongside `display_name`.
  - `scripts/serve.py handle_branding_save` (Settings → Branding) does the same.
  - `dashboard/core.js loadBranding()` mirrors `display_name` into the html slot whenever the loaded config omits it — so existing rc.{1..10} forks self-heal on the next page load without a manual `branding.json` edit.
- **Setup wizard version label** bumps to `1.3.0-rc.11` so testers can confirm at a glance they're running the brand-html fix.

### Upgrading from rc.{1..10}

`git pull origin main` → restart `python scripts/serve.py` → hard-refresh the browser (Ctrl+Shift+R / Cmd+Shift+R). Existing brand stays as you configured it — the JS-side fallback ensures the sidebar updates without you editing `config/branding.json`.

## [1.3.0-rc.10] - 2026-05-07

### Added

- **Setup wizard now shows a meaningful version label.** `WIZARD_VERSION` bumps per public-template rc (`1.3.0-rc.10`). Look at the upper-right corner of the wizard — if it says `v1.3.0-rc.10`, you're on the new code. If it still says `vc.3`, your browser cached the old setup.html — hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).
- **Filter input on Step 6.** "Type to filter all dropdowns" — applies live to every multi-select on the page. Already-selected entries always stay visible so you can unselect while filtering. The banner now shows total count + filtered count.
- **Bigger Step 6 dropdowns.** `<select multiple size="3">` was too cramped for 100+ category options. Bumped to `size="8"` for buckets / `size="10"` for flat reports.

### Fixed

- **Duplicate diagnostic banner** on Step 6 (rc.9 accidentally rendered the count message twice). Now rendered once with total + filtered note.

### If you're testing and Step 6 is still wrong

1. Stop the running `serve.py` (Ctrl+C in the terminal — Python doesn't reload Python files automatically).
2. `git pull origin main`.
3. Restart: `python scripts/serve.py`.
4. **Hard-refresh** the browser tab: Ctrl+Shift+R on Windows/Linux, Cmd+Shift+R on Mac.
5. Confirm the upper-right of the wizard shows `v1.3.0-rc.10`.
6. Open browser DevTools (F12) → Console tab. Upload your MMEX file and look for `[setup] MMEX upload OK — accounts:N categories:N tx:N`. Share the numbers if categories is still 0; that pins the bug to the server side.

## [1.3.0-rc.9] - 2026-05-07

### Fixed

- **Setup Step 6 dropdowns never show an unusably-small list anymore.** Previous rcs returned only the MMEX staging categories OR only the empty-start canonical set — when staging arrived empty for any reason (importer mismatch, schema variant, …), the dropdowns regressed and the user couldn't pick their actual category names. `reportsWizardCategories()` now returns a UNION of every known source (MMEX staging + empty-start canonical + bucket defaults + user-typed extras + already-selected entries from the running config).
- **Diagnostic banner at top of Step 6** tells you whether MMEX category parsing actually reached the frontend: green "✓ Detected N categories" when it worked, yellow "⚠ No categories detected …" with a clear "you can fix this in Settings → Reports later" message when it didn't. `console.log('[setup] MMEX upload OK — accounts:N categories:N tx:N')` in DevTools confirms the upload response payload count.
- **"Add categories manually" escape hatch.** Collapsible textarea on Step 6 — type any missing category names (one per line), click "Add to options", and they merge into every report's pickers. Stored in a module-level Set so they survive re-renders within the same wizard run. Useful when the importer happened to drop something or when the user knows a category name they want to create.

## [1.3.0-rc.8] - 2026-05-07

Closing-out sweep before next testing session: setup wizard becomes bilingual, accent color derives its variants from your chosen color, Settings → Branding sub-tab lands.

### Added

- **Setup wizard is bilingual.** Step labels, h2 headings, hints, and Back / Next / Confirm buttons translate when you change the locale picker. 23 new keys per locale. `setup.html` loads `i18n.js`; the picker triggers `loadLocale()` + `applyI18n(document)` for live re-translation.
- **Settings → Branding sub-tab.** Edit display name and accent color after install via `POST /api/branding/{get,save}`. Save calls `applyBranding()` immediately so the dashboard re-paints without a reload.
- **Accent color now propagates to every variant.** `applyBranding` computes `--accent-glow` and `--accent-subtle` as rgba over the chosen color and `--accent-dim` as a 25% white blend, instead of leaving the hardcoded blue defaults. Pick a green accent and your hover glows / focus rings actually turn green too.

### Changed

- **Setup wizard step 6 hint text** updated from "Eight reports" to "Nine reports" — Income Sources Breakdown landed in rc.5 but the hint wasn't updated.

### Still in v1.3.x backlog

- FAQ German twin (`docs/faq.de.md`) — currently the FAQ tab loader falls back to English for DE locale.
- MMEX importer including unused leaf categories — Step-6 dropdowns may still miss empty-leaf categories.
- Form labels inside each setup-wizard step (Display name, Username, etc.) are not yet `data-i18n`-tagged. Next iteration.

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
