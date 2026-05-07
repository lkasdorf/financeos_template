# FinanceOS — FAQ & Feature Reference

> Living documentation of every feature, convention, and quirk. Reviewed for accuracy on every release.

---

## Overview & Architecture

### What is FinanceOS?
A self-hosted, CSV-based personal finance system. Runs as a single-file dashboard on your own machine, on your own LAN or VPN. All data lives as CSV/JSON in `data/`, transactions are entered via the dashboard or the Claude Code terminal (TX free-text).

### Where does the data live?
- `data/` — every CSV/JSON file (Transactions, Accounts, Categories, Tags, Scheduled, Debts, FX, Payees, Budgets, Goals, ATM Fees, Custom Reports)
- `data/backups/` — automatic backups before every write
- `data/bank_imports/` — drop bank statement files (CSV/XLS) here for the Reconciliation feature
- `docs/` — reference documents (Schema, TX Guide, this FAQ, deployment)
- `dashboard/` — single-file SPA (HTML + JS modules + CSS)
- `scripts/` — Python tools (Serve, TX Engine, Backup, Cron jobs)
- `config/` — branding, features, defaults, smart-defaults, auth, i18n

### Which source is authoritative?
`docs/schema.md` is the single source of truth for CSV structure. Scripts read accounts/categories exclusively from `data/accounts.csv` and `data/categories.csv`.

---

## Booking Transactions

### How do I book a transaction?
Open the dashboard, click **+ Add Transaction** (or press the `+` floating button on mobile). Fill in date, amount, account, payee, category, optional tags + note, click **Save**. The CSV plumbing — backup, atomic write, git-commit when a remote is configured — happens behind the scenes.

The free-text terminal `TX ...` flow that earlier versions of this template advertised was removed in v1.2.0. Manual entry through the form is now the only supported path.

### Smart defaults — what auto-fills?
- **Currency** is inherited from the chosen account (`data/accounts.csv` row).
- **Category** suggestions come from the payee history (`data/payees.json`) — book the same payee twice with the same category and the third entry pre-fills.
- **Auto-tags** trigger when you configure rules in `config/defaults.json` (`auto_tag.by_account` and `auto_tag.by_payee`). The template ships without auto-tag rules — add the ones that recur in your data.

### How do I make a transfer?
Set the type to **Transfer**, pick source and destination accounts, enter the amount. One row, no double-booking.

### How do I split a receipt across categories?
Click **Add split line** in the form for as many sub-lines as you need. Each line gets its own category and amount; the live-sum badge turns green when the splits add up to the typed total. Save writes one row per split, all sharing the same `receipt_group` and (if attached) `receipt_url`.

### How do I add tags?
Pick from the multi-select tag chip in the form, or type a new tag name and confirm to create it. New tags get added to `data/tags.csv` automatically.

---

## Pass-Through & Custody

### What does a pass-through account do?
An account marked `type=pass_through` in `data/accounts.csv` (with a `pass_through_payee` column populated) automatically generates **two rows** for every booking:

1. The actual expense (with the real category, e.g. `Bills:Electricity`)
2. An income counter-booking (`Income:<payee> Reimbursement`)

The pass-through balance therefore stays at 0. Useful for accounts that hold someone else's money you spend on their behalf — e.g. an employer-funded prepaid card. **The Setup wizard ships without pass-through accounts;** add them via Settings → Accounts after install.

### What is a custody account?
An account with `owner != self`. Normal bookings, **no** automatic counter-booking. The balance shows under "Custody" on the dashboard, **not** in Net Worth. Useful for money you administer for someone else (a partner's savings, a child's allowance).

### Private vs Business — how does the dashboard distinguish?
Two ways:

1. **Account-driven** — when an account is marked `type=pass_through` with the appropriate `pass_through_payee`, every booking on it is implicitly business-side, and the auto-tag system (`config/defaults.json` `auto_tag.by_account`) can stamp a `BUSINESS_<entity>` tag on it.
2. **Tag-driven** — manually attach a `BUSINESS_<entity>` tag to a booking. Used when a private account paid for a business expense (you'll be reimbursed later).

The "Business vs. Personal" report and the per-business Reimbursement reports rely on **`config/businesses.json`**. Each entity declares its tags (`tag: 'BUSINESS_Acme'`), accounts (the pass-through aliases), and income categories (`{salary: 'Income:Acme Salary', reimbursement: 'Income:Acme Reimbursement'}`). The template ships with `entities: []` so the business reports gracefully degrade to "no entities configured" — fork-side users add their own.

### Reimbursement rule
Pass-through reimbursement income (e.g. `Income:Employer Inc. Reimbursement`) counts **everywhere as regular income** — dashboard, cashflow chart, reports. Don't filter it out. The Income report shows the split "Real Income" vs. "Reimbursements" as info tiles when business entities are configured.

---

## Scheduled Transactions

### What is it?
Recurring booking templates in `data/scheduled.csv`. The engine does **not** run them automatically — only on request.

### Commands
- `SCHED` → due entries as a batch preview, book on `y`
- `SCHED LIST` → all active scheduled entries
- `SCHED ALL` → including `active=false`

### Frequency format
- `monthly:15` → on the 15th of every month
- `monthly:last` → last day of the month
- `weekly:<weekday>` → mon/tue/wed/thu/fri/sat/sun
- `yearly:MM-DD` → once a year on MM-DD
- `quarterly:MM-DD` → every three months on DD; MM anchors the set (`03-15` → Mar/Jun/Sep/Dec, `01-01` → Jan/Apr/Jul/Oct)

### After a fire
`last_run` is updated, `next_run` rolled forward to the next occurrence. Git commit covers `transactions.csv` + `scheduled.csv` together.

### Maintenance
- **New:** append a row to the CSV, `sched_id` continues sequentially
- **Deactivate:** `active=false`
- **Delete:** only if the entire template should disappear
- **Modify:** edit directly in the CSV

---

## ATM Withdrawals

### How do I book a withdrawal?
`TX atm 200 checking`. The engine reads `data/atm_fees.csv`, finds the matching row via `(bank, amount)`, and generates the bookings:
1. Transfer (amount) from bank → cash, tag `ATM`
2. `fee_net` as expense, category `Fees:Bank Fees`, no tag
3. `levy` as expense (if > 0), no tag
4. VAT = `fee_net × vat_rate`, no tag (only when the bank charges VAT on fees)

### Where do I configure fees?
`Settings → ATM Fees` in the dashboard. Fields: Bank, Amount, Currency, Fee (net), Levy, VAT rate, Note. The total is shown live in the table.

### Unknown amount?
The engine asks back: "Amount X is not in `atm_fees.csv` — provide the fees manually or create a preset?"

---

## Accounts

### Account types
- `bank` / `cash` / `savings` / `mobile_money` / `credit_card` (Self, count toward net worth)
- `pass_through` (balance = 0, auto counter-booking)
- Custody (`owner != self`, separate display)

### Maintaining accounts
`Settings → Accounts`: alias, name, currency, type, owner, status (active/archived), pass-through payee, initial balance.

### Viewing balances
- `BALANCE` in the terminal → current balances from `accounts.csv` + `transactions.csv`
- Dashboard → `Accounts` page with a detail view per account

### Booking directly from an account
Each account detail page shows a large primary **"+ Add TX"** button below the balance + meta row. Click it →

1. The Add TX page opens with the **account pre-filled** and a **`← Back` button** at the top.
2. Book as usual.
3. After a successful commit → **automatic jump back to the same account detail page**, with the refreshed balance and the new transaction in the list.

The smaller "+ Add TX" button at the top right (next to Export XLSX) stays around as a quick-access shortcut for when you've scrolled far down.

**Behaviour of the back button:** it only appears if you actually came from an account detail. If you switch to the Add TX page via the sidebar, the FAB, or the `n` key in between, the return context is discarded.

---

## Categories & Tags

### Category structure
Hierarchical via `:` — `Food`, `Food:Groceries`, `Food:Dining out`. Defined in `data/categories.csv` with the fields: `path`, `type` (income/expense/transfer), `active`, `note`, `pnl`, `essential`.

### `essential` flag
Marks a category as cost-of-living (e.g. Food, Bills, Transport). Used by the Cashflow Forecast (F3 report) and the "pure cost-of-living" calculations.

### `pnl` flag
Marks whether a category appears in the P&L reports (Income Statement). `false` = transfer / internal movement, `true` = real income/expense.

### Maintaining tags
`Settings → Tags` — tag + optional description. Define your own; the empty-start template ships without preset tags.

### Editing categories
Essential + pnl can be set in the edit modal. Changes generate an auto-commit and the dashboard re-renders the active page so reports show the new values immediately.

---

## Reports

### Standard reports (categorised)
**Income:**
- Income Analysis — Real Income vs. Reimbursements (stacked chart)
- Income vs. Expense Summary — month / year, net balance, savings rate
- Income Sources Breakdown — detailed split

**Expenses:**
- Bills Overview — Rent / Electricity / Water / Internet
- Category Deep Dive
- Seasonal Heatmap
- Bank Fees
- Subscriptions

**Forecast:**
- **F3 Cashflow Forecast** — 4-layer model: essential cost median per month + pass-through net + variable income + scheduled

### Custom Reports
User-defined reports via filter builder — savable, duplicable, with their own rendering path. Configuration in `data/custom_reports.json`. Behind the `custom_reports` feature flag.

### Report consistency
All expense reports use the same total logic as the dashboard (incl. reimbursements as income).

### Why is my Dining Out / Bills / Vice / AI Costs / etc. report empty?
Eight reports filter transactions by category and look for the canonical category strings (`Food:Dining out`, `Bills:Rent`, `Subscriptions:AI`, `Leisure:Alcohol|Smoking|Vaping`, `Fees:*`, `Other Expenses:Cash Discrepancy`, `Automobile:*`, plus the FIXED_PREFIXES list driving Discretionary vs. Fixed). If you renamed a category — e.g. "Restaurants" instead of "Food:Dining out" — the report sees no matching rows.

**Fix:** open **Settings → Reports** and map your category names to the report buckets (multi-select per report or per bucket for Bills/Automobile). The Setup wizard step 6 asks the same questions on first run. Save persists to `config/reports.json`; reports re-render with the new mapping immediately.

### How do I rename categories without breaking reports?
Two options:

1. **Rename in `data/categories.csv`, then update Settings → Reports.** The category-driven reports read the in-memory `REPORTS_CONFIG`, so once you list your new name in the affected report's bucket, things just work. Existing transactions keep their old category until you bulk-update them — Settings → Categories has a rename helper.
2. **Build a Custom Report.** Settings → Custom Reports → Add report → filter `category equals "Restaurants"`. Save. The original "Dining Out" report shows zero for you (or stays as documentation), and your custom report does the right thing.

### Which reports are NOT affected by renames?
Net Worth Trend, Top Payees, Income vs. Expense Summary, Account Balances Over Time, Cashflow Forecast, Year-over-Year Comparison, Seasonal Heatmap, Monthly Comparison, Largest Transactions, FX Exposure, Cash vs. Digital, Weekday vs. Weekend, Savings Rate Trend, and most "Overview" reports — they aggregate by amount/account/date/payee, never by category string.

### Schema of `config/reports.json`
- **Flat reports** (Dining Out, AI Costs, Vice Spending, Bank Fees): `{ categories: [...], match?: 'exact' | 'prefix' }`. `match` defaults to `'exact'`. Multiple categories OR-match.
- **Bucket reports** (Bills, Automobile): `{ buckets: { <bucketId>: { categories: [...] }, ... } }`. Bucket IDs are stable (rent / electricity / petrol / maintenance / …) — the report uses them for column names, colours, and i18n labels. Categories per bucket: OR-match.
- **Cash Discrepancy:** `{ expense_categories: [...], income_categories: [...] }`. Two separate sets so the report can distinguish a "found money" income from a "lost money" expense.
- **Discretionary vs. Fixed:** `{ fixed_prefixes: [...] }`. Plain prefix list. Anything starting with one of these is "fixed", everything else is "discretionary".

---

## Updating

### How do I get notified about updates?
On the GitHub repo page, top-right click `Watch` → *Custom* → tick *Releases*. You get an email for every new tag. RSS feed: `https://github.com/<owner>/financeos/releases.atom`.

### What does each version bump mean?
- **Patch** (`v1.2.x → v1.2.y`) — bugfixes only, just `git pull && restart`.
- **Minor** (`v1.x.0 → v1.y.0`) — backwards-compatible new features. Read the release notes; usually you can pull straight away.
- **Major** (`v1.x → v2.0.0`) — breaking changes. The release ships a migration script and the notes describe the steps.

### How do I update without losing data?
Bind-mounts (Docker) or `data/` and `config/` outside the install path (local Python) keep your state separate from app code. Update steps:

- **Docker / Compose:** `git pull && docker compose down && docker compose up -d --build`
- **Synology Container Manager:** click *Build* on the project — DSM pulls fresh code, rebuilds, restarts. Volumes untouched.
- **Unraid:** *Force Update* on the container from the WebUI.
- **Local Python:** `git pull && pip install -r requirements.txt && restart`

### Should I back up before updating?
For patch + minor updates: not strictly necessary, but cheap. **Settings → Backup → Export full data ZIP** is a one-click full snapshot. For major updates: yes, always.

### What if a release breaks something?
`git checkout <previous-tag>` and restart. Bind-mounted data stays intact.

---

## PDF Export

### How?
In the report detail view click **"Export PDF"** → options modal (orientation, page size, include charts) → `window.print()` opens the system print dialog. No extra tool.

### What can be configured?
- **Orientation:** Portrait / Landscape
- **Page Size:** A4 / Letter / A3
- **Include Charts:** Yes / No
- The last choice is remembered for the session.

### Professional typography
Financial-report density: 8 pt body, 12 pt title, 7.5 pt (portrait) / 8 pt (landscape) tables, 0.25 pt thin rules + 0.5 pt heavy rules.

### Auto-fit
Wide tables (e.g. 14-column Income Sources) are scaled down to page width automatically via `transform: scale()` — minimum 55%.

### Dark-mode caveat
Chart text renders in dark colours when dark mode is active. Workaround: switch to the light theme before exporting.

---

## Dashboard

### Navigation
SPA via hash routing (`#dashboard`, `#reports`, `#accounts`, …). Sidebar on the left, "More" menu on mobile. Account detail via `#account:<alias>`.

### Layout & widths on large monitors
The dashboard and every other page are **left-aligned** to the sidebar. Content width adapts to the viewport:

| Viewport | max-width |
|---|---|
| `< 1800px` (1080p / 1440p) | 1400px |
| `≥ 1800px` (QHD / 2K) | 1600px |
| `≥ 2200px` (WQHD / 4K / Ultrawide) | 1800px |

### Net Worth
The sum of every Self account in the active display currency. Pass-through balances are 0 by definition; custody accounts are shown separately.

### Currency Switcher
In the header. Live rates from the FX provider configured in `config/defaults.json`, fallback to `data/fx_rates.csv`. History in `data/fx_rates_history.csv`.

### Sidebar modules
Add TX · Dashboard · Reports · Accounts · Transactions · Custom Reports · Alerts · Debts · Reconciliation · Settings · **FAQ**

(Modules behind off feature flags are hidden.)

### Mobile navigation (smartphone / tablet)
Below 768 px width the mobile layout takes over with a **top bar + hamburger drawer**:
- **Top bar pinned at the top:** hamburger on the left, the brand centred, an optional alerts dot on the right
- **Drawer slides in from the left** (280 px wide, max 80 vw) with the full nav list
- **FAB for Add TX** — round 56 px accent button bottom right (fixed, always thumb-reachable)
- **Drawer closes on:** tap on the backdrop, ESC, or tap on a nav item
- **Body scroll is locked** while the drawer is open

---

## Reconciliation (Adapter System)

### Purpose
Monthly reconciliation of bank statements against `transactions.csv`. Bank statement files live under `data/bank_imports/`.

### Flow
`RECON` → parse statement → totals/balance check → row matching by (date, amount) → explain differences → write the report as `reconciliation_YYYY_MM.md` → update `recon_index.json`.

### Adapter plugin system

The bank-statement logic is pluggable via `scripts/reconciliation/`. Each bank is an adapter (subclass of `BankAdapter`); the account → adapter mapping is routed through `config/reconciliation.json`.

The template ships with one default adapter:

| Adapter | File | Format | Use |
|---|---|---|---|
| `csv_generic` | `scripts/reconciliation/csv_generic.py` | `.csv` | configurable columns (date, details, amount or debit+credit), date format, decimal separator |

**Adding a new bank:**
1. New module `scripts/reconciliation/<bank>.py` with a subclass of `BankAdapter` (see `base.py`)
2. Implement `parse(filepath)` + `match_payee(details)`, set the class attributes (`name`, `display_name`, `file_extensions`, `data_subdir`, `default_account`, `default_currency`)
3. Add it to `ADAPTERS` in `scripts/reconciliation/__init__.py`
4. Add the account mapping in `config/reconciliation.json`

### Expected differences
- Date shift (the dashboard sometimes books a day before the bank's posting date)
- Splits (bank = 1 row, FinanceOS = several)
- Rounding from import sources

### Dashboard view
`#reconciliation` shows every monthly report grouped by year with details. Three recon endpoints behind the `crdb_recon` feature flag (yes, the flag is named after the original reference adapter — kept for compatibility): `POST /api/recon/adapters` (list of installed adapters with metadata), `POST /api/recon/files?account=` (statement discovery per adapter), `POST /api/recon/suggestions` (with optional `account` in the body).

---

## Debts & Third Party

### Debts (loans)
`data/debt_payments.csv` + dashboard page `#debts`. Features:
- Partial payments, top-up
- Foreign currency support
- Auto TX generation on payment
- Payment history per debt

Behind the `debt_tracking` feature flag.

### Third Party (other people's money)
`data/third_party.csv` — open advances for third parties. The `THIRD PARTY` command lists open entries.

---

## Payees

### Auto-learn
The dashboard auto-learns payees from new bookings — entry in `data/payees.json`. Review the list periodically via Settings → Payees.

### Groups
Payees can be grouped (e.g. "Utilities" = Electric Co + Water Co + Internet). CRUD via the dashboard.

### Settings tab
`Settings → Payees` — list of every payee with edit/delete/merge.

---

## Quick Expenses

### Chips below "Add TX"
Preset chips for frequent cash expenses (e.g. "Coffee", "Lunch"). One click opens the Add TX form pre-filled.

### Configuration
`Settings → Quick Expenses`. Fields: Name (chip label), Account, Payee, Category, Tags, Type, Note, Active. Behind the `quick_expenses` feature flag.

---

## Budgets & Savings Goals

### Budgets
Per category + month — `Settings → Budgets`. The dashboard widget shows the month-to-month tracker with percentage bars.

### Savings Goals
Goals with amount + deadline — `Settings → Goals`. The dashboard shows progress.

---

## Settings Tabs (Overview)

| Tab | Purpose |
|---|---|
| Categories | CRUD for `categories.csv` incl. pnl + essential |
| Tags | CRUD for `tags.csv` |
| Scheduled | CRUD for `scheduled.csv` |
| Quick Expenses | CRUD for `quick_expenses.csv` |
| ATM Fees | CRUD for `atm_fees.csv` |
| Payees | CRUD for `payees.json` + groups |
| Accounts | CRUD for `accounts.csv` |
| Currency | default display currency |
| FX Rates | manual rate overrides + history |
| Goals | savings goals |
| Budgets | category budgets per month |
| Backup | manual backup trigger + full ZIP download |

(Tabs behind off feature flags are hidden.)

---

## Always-on Deployment

### Purpose
Run FinanceOS on a 24/7 host (single-board computer, NAS, VPS) with bidirectional Git sync between your local PC and the always-on host. Full setup guide: **`docs/deployment.md`**.

### Cron jobs (opt-in)
The repo ships with several cron scripts that you wire up via crontab on your always-on host:

- `cron_commit.py` — every 5 minutes a bidirectional git sync: fetch → rebase → commit pending data/ → push. The service is **not** restarted automatically on code pulls; auto-restart was removed because it interrupted active dashboard sessions during PC-side coding. Restart manually after a code push: `sudo systemctl restart <unit>` (or `ssh <host> 'sudo systemctl restart <unit>'` from the dev machine).
- `cron_fx.py` — daily FX-rate snapshot
- `cron_sched.py` — daily scheduled-due check
- `cron_integrity.py` — daily schema/balance check

See `docs/deployment.md` for the full crontab + systemd unit + sudoers snippet.

---

## Hard Rules

### Backup mandate
A `scripts/backup.py` run executes before every write to `data/*.csv`. No exceptions.

Three backup layers in the live system:
1. **Rolling backups** (`data/backups/*.csv`) — automatic before every write, max. 30 generations per file, older ones are auto-pruned. Settings → Backup tab → "Backup Transactions/Scheduled/Debts/All" triggers them manually as well.
2. **Full ZIP download** (Settings → Backup → "Download full backup (.zip)") — packs the whole `data/` directory (without `data/backups/` and `__pycache__/`) into a DEFLATE ZIP with a UTC timestamp in the filename. Endpoint: `POST /api/backup/export`.
3. **Git** (see next bullet) — every write is committed and pushed.

### Git after every write
`git add` + commit with a meaningful message + push (when a remote is configured).

### Offline queue
Every TX entry lands **first** in `data/prompt_log.csv` (`booked=False`), then it's parsed/booked. On success `booked=True`.

### Schema fidelity
`docs/schema.md` is binding. Scripts read accounts/categories only from `accounts.csv` and `categories.csv`.

### Versioning scheme
Semantic Versioning. Bump only on user-relevant changes; data-only commits do not bump the version.

### Response style (Claude integration)
Short, structured, no fluff. For bookings: preview → confirmation → commit message.

---

## Feature Flags (config/features.json)

### Purpose
Top-level features can be toggled on/off via `config/features.json` without touching code. Built so a fresh install is small and focused; opt in to features as you need them.

### Available flags

Seven boolean flags. The empty-start template ships with the optional ones `false` and the core ones `true`.

| Flag | What gets gated |
|---|---|
| `metals` | Precious-metals page (`#metals`), sidebar nav entry, metals CSVs in `data/`, spot cron, metals loader at boot. **Off by default in the template.** |
| `pwa` | Static serving under `/pwa/*` (index, service worker, manifest, app JS). **Off by default in the template.** |
| `crdb_recon` | Reconciliation page (`#reconciliation`), sidebar nav, `/api/recon/*` endpoints, files under `/data/bank_imports/*` |
| `debt_tracking` | Debts page (`#debts`), sidebar nav, `/api/debts/*` endpoints |
| `quick_expenses` | Quick-expense chips below Add TX, Settings tab "Quick Expenses", `/api/quickexp/*` endpoints |
| `custom_reports` | Custom Reports page (`#custom-reports`), sidebar nav, `/api/custom-reports/*` endpoints |
| `scheduled_tx` | Settings tab "Scheduled" for SCHED templates, `/api/scheduled/*` endpoints. The `SCHED` CLI command is independent (still works) |

API calls against an OFF feature return `404 {"error": "feature '<flag>' disabled"}`. UI elements are hidden via `data-feature` attributes (sidebar/pages) or code filters (Settings tabs, chips).

### Toggle
Edit `config/features.json`, set the value to `true`/`false`, restart the server (Python caches per process). Example:

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

### Graceful default
If the file or a flag key is missing, the default is `true` — the dashboard stays functional even without the config.

---

## Defaults (config/defaults.json)

### Purpose
System-layer configuration for values that should be adjustable without code changes: server port, backup retention, currency defaults, FX/metals API URLs, auto-tag rules, pass-through reimbursement mappings.

### Structure

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

### Where each key is consumed

| Key | Consumed by |
|---|---|
| `server.default_port` / `default_bind` / `dashboard_path` | `scripts/serve.py` (CLI defaults + URL building) |
| `backup.max_per_file` | `scripts/backup.py` (retention for `data/backups/`) |
| `currency.primary` | `dashboard/core.js` `state.primaryCurrency` |
| `currency.fx_api_url` | `dashboard/core.js` + `scripts/cron_fx.py` |
| `auto_tag.by_account` / `by_payee` | `scripts/tx_engine.py` `apply_auto_tags()` |
| `pass_through.reimbursement_categories` | `scripts/tx_engine.py` `generate_pass_through_line()` |

### Toggle / customise
Edit the file, restart the server (and the cron if needed). On the backend `lru_cache` caches the content once per process. In the dashboard `loadDefaults()` runs at boot and overwrites `window.DEFAULTS` — a page reload is enough.

### Graceful default
If the file or a sub-key is missing, the hardcoded fallbacks take over. No crashes.

---

## Smart Defaults (config/smart_defaults.json)

### Purpose
UX layer for user-centric defaults: which display currency to start in.

```json
{
  "ui": { "default_display_currency": "USD" }
}
```

### `ui.default_display_currency`
The display currency on the **first** dashboard load (when `localStorage['lp-default-currency']` is still empty). As soon as the user toggles the currency switcher, `localStorage` wins.

### Graceful default
Like `defaults.json`: if the file is missing → hardcoded fallbacks kick in, the app keeps running.

---

## i18n (config/i18n/)

### Purpose
Multi-language support for the dashboard UI without a build step or framework. Pattern like `features.json` / `defaults.json`: one JSON file per locale, the loader pulls it at boot, English HTML defaults stay as the fallback in the markup.

### Structure

```
config/i18n/
  en.json    ← default, always present
  de.json    ← (optional, fork users add)
  pl.json    ← (optional, ditto)
```

Format: flat dot-path keys, values as strings. Example:

```json
{
  "nav.dashboard": "Dashboard",
  "settings.tab.language": "Language",
  "settings.language.heading": "Interface Language"
}
```

Placeholders via `{name}` are supported (`t('foo.bar', { count: 3 })` → `"Foo: 3"` if the string is `"Foo: {count}"`).

### Language selection
**Settings → Language** shows a dropdown with every code from `window.AVAILABLE_LOCALES`. The selection is persisted to `localStorage['lp-locale']` and overrides the browser default locale. On switch the dashboard reloads so every dynamic render picks up the new language.

Locale resolution order:
1. `localStorage['lp-locale']` if set AND in `AVAILABLE_LOCALES`
2. `navigator.language[:2]` if the code is in `AVAILABLE_LOCALES`
3. `'en'`

### Adding your own language
1. Create `config/i18n/<code>.json`, translate every key from `en.json` (missing keys silently fall back to English)
2. In `dashboard/i18n.js` add the code to `window.AVAILABLE_LOCALES`
3. Optional: add a label in every locale: `"settings.language.option.fr": "French"` / `"settings.language.option.fr": "Français"`
4. Reload — the new language is in the dropdown

### What is marked in HTML
`data-i18n="key"` swaps `textContent` during the `applyI18n()` pass. The fallback text stays in the markup, so the browser is readable without JS or before the locale fetch:

```html
<span data-i18n="nav.dashboard">Dashboard</span>
```

`data-i18n-title="key"` sets the `title` attribute (for tooltips).

`data-i18n-placeholder="key"` sets the `placeholder` attribute (for inputs).

`data-i18n-aria-label="key"` sets the `aria-label` attribute (for icon-only buttons).

`data-i18n-html="key"` sets `innerHTML` instead of `textContent` — for strings that should contain inline markup (e.g. page titles with `<span class="accent">` for the accent split).

### In JS code
`t(key, params, fallback)` for dynamically generated strings:

```js
const label = t('settings.tab.language', {}, 'Language');
container.innerHTML = `<h3>${t('settings.language.heading')}</h3>`;
```

The third argument (`fallback`) is the English default to show if the key is missing in the active locale.

### Graceful default
If `en.json` is entirely missing or a key is absent, the dashboard shows the English defaults baked into HTML/JS — no crash, no empty area.

### Validation with i18n_check.py

`scripts/i18n_check.py` is the safety net: scans `dashboard/**/*.{js,html}` for every `t()` call and `data-i18n*` attribute and compares the keys against `config/i18n/en.json`.

```bash
python scripts/i18n_check.py          # text report, exit code 1 on hard errors
python scripts/i18n_check.py --json   # machine-readable for CI / pre-commit
```

Three error classes:

| Class | Meaning | Exit code |
|---|---|---|
| `missing-in-EN` | key is called from code but absent from `en.json` | 1 (hard) |
| `missing-in-<locale>` | key exists in `en.json` but missing from another locale (parity break) | 1 (hard) |
| `orphan` | key in `en.json` is referenced nowhere in code | 0 (warn) |

---

## Setup Wizard (CLI + Web)

### Purpose

Initialises a fresh FinanceOS instance — writes `data/.setup_state.json`, `config/branding.json`, `config/auth.json`, plus the data files. After a successful run `.setup_state.json.initialized` flips to `true` and a second run aborts with exit code 2 (re-init guard).

### Architecture

- `scripts/setup_core.py` — pure logic (no side effects outside the supplied paths). Public API: `run_setup`, `write_branding`, `write_auth`, `write_setup_state`, `write_empty_seed`, `write_mmex_seed`, `check_not_initialized`. Called by both the CLI and the web wizard with the same `config` dict.
- `scripts/setup.py` — CLI frontend, thin. Collects config via flags **or** interactive prompts.
- `dashboard/setup.html` + `setup.js` + `setup.css` — browser frontend, thin. Six-step wizard in vanilla JS.

### Modes

| Mode | Command | When |
|---|---|---|
| Non-interactive (flags) | `python scripts/setup.py --brand "X" --currency USD --auth-user admin --auth-pass "***" --empty` | scripted / Docker Compose / CI |
| Interactive | `python scripts/setup.py --interactive` | first-time setup with human eyes |
| With initial commit | `... --git-commit` | when the target dir is a git repo |

### Data sources

- **`--empty`** — starts with 4 generic accounts (`cash`, `checking`, `savings`, `credit`, all in the chosen default currency) and ~34 neutral categories.
- **`--mmex path/to/db.mmb`** — reads a Money Manager EX file via `scripts/importers/mmex.py` (read-only) and converts the staging payload deterministically into the data files.

### Interactive steps

Six steps, each with a default + validation:

1. **Branding** — display name + accent colour
2. **Default currency** — 3-letter ISO (USD, EUR, GBP, …)
3. **Auth** — `basic` (username + password, bcrypt hash) or `none` (with an explicit WARNING confirm)
4. **Datasource** — `(a)` MMEX file or `(b)` empty start
5. **Optional features** — toggles for the seven togglable features
6. **Summary + confirm** — full overview, `n` aborts without a write (exit 1)

### Web wizard

Browser-based counterpart to the CLI wizard. In a fresh-install state `dashboard/index.html` redirects automatically to `dashboard/setup.html`.

API endpoints (all POST):

| Endpoint | Purpose |
|---|---|
| `/api/setup/status` | gate for the frontend — returns `{initialized, has_data, default_currency, wizard_version}` |
| `/api/setup/mmex-upload` | accepts a base64-encoded `.mmb` (max. 20 MB), parses, stores staging payload, returns summary + account preview |
| `/api/setup/finalize` | calls `setup_core.run_setup(config, staging=…)` 1:1 like the CLI |

**Double guard** in both mutations: 409 refusal when `data/.setup_state.json.initialized=true` OR `data/transactions.csv` has data rows — protects live instances from accidental wipe.

### Dependency

`bcrypt>=4.0` in `requirements.txt` (lazy-imported in `setup_core` — auth mode `none` does not need it).

---

## Authentication

### Purpose
Optional HTTP Basic Auth middleware in front of every server route. Default for the empty-start template: **off** (LAN/VPN only). Opt-in for public hosting or shared deployments.

### Enable

```bash
python scripts/auth.py --set-password
# Username [admin]: alice
# Password (min 8 chars): ********
# Repeat: ********
# ✓ Basic auth enabled for user 'alice'.

# Restart the server (lru_cache reads auth.json once)
python scripts/serve.py
```

The browser then shows a native login dialog on the next request (HTTP `401 + WWW-Authenticate: Basic realm="FinanceOS"`).

### Other modes

```bash
python scripts/auth.py --status     # shows current mode + user (no hash leak)
python scripts/auth.py --disable    # back to mode=none
```

### Schema (`config/auth.json`)

```json
// Auth off
{ "mode": "none" }

// Basic auth active
{
  "mode": "basic",
  "user": "alice",
  "password_bcrypt": "$2b$12$..."
}
```

### Exempt paths (still reachable when auth is on)

| Path | Condition |
|---|---|
| `/api/health` | always (for cron / monitoring) |
| `/dashboard/setup.{html,js,css}` | only while `data/.setup_state.json` is not initialised |
| `/api/setup/{status,mmex-upload,finalize}` | only while `data/.setup_state.json` is not initialised |

### What is not supported

- **Logout button in the dashboard:** browsers cache basic-auth credentials per realm until tab close. The server can't invalidate that — a "logout" would be fake.
- **Multiple users:** `auth.json` has exactly one user slot. Multi-user is on the v2 roadmap.
- **Session cookies:** stateless basic auth only.

### Dependency

`bcrypt>=4.0` (same as the setup wizard). Lazy-imported, not needed when `mode=none`.

---

## CHANGELOG & Versioning

### Format
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). File `CHANGELOG.md` in the repo root.

### Subsections
Added · Changed · Deprecated · Removed · Fixed · Security

### Versioning policy

[Semantic Versioning 2.0.0](https://semver.org/):
- **MAJOR** — breaking changes
- **MINOR** — new features, backward compatible
- **PATCH** — bug fixes

### What belongs in here?
Only **user-relevant** changes (features, UX, bugfixes, schema migrations). No internal refactors, data batches, or maintenance commits.
