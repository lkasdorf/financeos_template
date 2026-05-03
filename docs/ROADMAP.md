# FinanceOS — Roadmap

> Public-facing roadmap for the FinanceOS self-hosting template.
> Status as of `v1.0.0`: stable, production-ready for personal finance use.

---

## What FinanceOS is

A self-hosted, CSV-based personal finance system you run on your own machine (laptop, NAS, single-board computer, or VPS). The dashboard is a single-file SPA that talks to a small Python backend; data lives entirely on your filesystem as CSV/JSON. No cloud account, no telemetry, no SaaS lock-in.

**Design principles:**

1. **Data first.** Your data stays in plain CSV files you can open in Excel, grep through, or rsync to a backup drive.
2. **Self-hosting is the default.** No "free tier" with a paid SKU lurking around the corner.
3. **Config over code.** Branding, currency, auth, feature flags, smart-defaults, and reimbursement rules are all driven from `config/*.json` — fork-friendly without a build step.
4. **Optional features are off by default in the template.** Bank reconciliation, debts, scheduled transactions, custom reports, etc. all sit behind feature flags so a fresh install is small and focused.

---

## Current status (v1.0.0)

**Shipped:**

- Dashboard (Net Worth, Accounts, Monthly Summary, Charts, Recent TX)
- Transactions page (filter, sort, paginate, bulk ops)
- Accounts page + per-account detail views
- Reports — Income (Analysis / vs. Expense / Sources Breakdown), Expenses (Bills, Category Deep Dive, Seasonal Heatmap, Bank Fees, …), Forecast (F3 4-layer cashflow), Custom Reports (filter-builder + runner)
- PDF export (browser print with KPMG-exhibit typography)
- FX (multi-currency, full ISO-4217 list, live rates via open.er-api.com with offline fallback)
- Payees with auto-learn + groups
- Quick Expenses (preset chips below Add TX)
- Scheduled Transactions
- Debts + Third Party
- Budgets + Savings Goals
- Pass-through accounts (business reimbursements with auto counter-booking)
- Custody accounts (held money, separate from net worth)
- ATM-fees configuration
- Bank reconciliation with a pluggable adapter system (CSV-generic by default, custom adapters trivial to add)
- Backup system — rolling per-write backups + on-demand full ZIP export
- CHANGELOG (Keep a Changelog 1.1.0)
- Mobile UI (top bar + hamburger drawer + FAB)
- i18n layer (`config/i18n/<locale>.json`, locale-aware number/date formatters, settings switcher)
- Optional HTTP Basic Auth middleware
- Setup wizard — six-step CLI **and** browser flow, MMEX importer (`.mmb` SQLite read-only) for users migrating from Money Manager EX

**Currently in progress (Phase 3):**

The upstream private repository is the source of truth. A sanitisation pipeline (`scripts/template_export.py`) regenerates this template from the upstream on every release. Phase 3 covers that pipeline, the public deployment docs, and the first full `v1.0.0` release.

---

## Roadmap

### Near-term (v1.1 series)

- **Reconciliation UI polish** — adapter dropdown in the Reconciliation page, per-account bank-statement upload, per-row "match preview" toggles.
- **PWA (mobile cash-entry)** — opt-in offline-first mobile entry surface for cash-only spending.
- **Multi-user / role separation** — currently one user per `auth.json`. Multi-user with per-user TX entry tags is on the table.
- **More bank adapters** — community contributions for the popular consumer banks (Chase, Wells Fargo, N26, Revolut, Wise, …) via the `BankAdapter` ABC.
- **Locale expansion** — additional `config/i18n/<lang>.json` files (currently EN by default; community-contributed locales welcome).

### Mid-term (v1.x)

- **Receipt OCR** — drop a photo of a receipt, get a TX preview with category suggestion. Bring-your-own-API-key for the OCR provider.
- **Investment-account view** — basic positions tracking with cost-basis, unrealised P&L. (The upstream has a precious-metals page; the generalised version would handle equities + ETFs the same way.)
- **Tax-year reports** — country-presets for common tax-year layouts (calendar-year, fiscal-year), with category → tax-line mappings configurable in `config/tax_lines.json`.
- **Plugin discovery API** — expose `POST /api/plugins/list` so a UI can show which optional features / adapters are installed and their version.

### Long-term (v2)

- **Schema migration framework** — currently CSV schema changes are documented in the changelog and applied by hand. v2.0 is the natural cut for a versioned migration runner.
- **API stability guarantee** — the `/api/*` surface is currently marked "internal". v2.0 freezes a documented public subset for third-party tools.

---

## Versioning policy

FinanceOS uses [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** (`v2.0.0`) — breaking changes: config schema migrations, removed/renamed APIs, dependency upgrades that require user action.
- **MINOR** (`v1.1.0`, `v1.2.0`, …) — new features, backward-compatible. Released roughly every 2–3 months.
- **PATCH** (`v1.0.1`, `v1.0.2`, …) — bug fixes, security patches. Released as needed.

The template repository is force-pushed on every release; it does not carry the upstream commit history. Use the GitHub release notes / `CHANGELOG.md` for "what changed".

---

## Contributing

Contributions are welcome on the template repository. Two patterns work well:

1. **Bug reports + small UI fixes** — open an issue, then a PR. The maintainer reviews, applies the change upstream, and the next template release ships it.
2. **Bank adapters + locale files** — drop a new module under `scripts/reconciliation/<bank>.py` (subclass of `BankAdapter`) or a new file under `config/i18n/<lang>.json`. These are isolated additions that almost never conflict with upstream.

Larger architectural changes (new pages, schema additions, new feature flags) are best proposed as an issue first — the upstream + template split means a one-shot PR is rarely the right shape for them.

See `docs/contributing.md` for the full guide (PR format, commit conventions, local dev setup, lint/format steps).

---

## What is deliberately out of scope

- **Multi-tenant SaaS hosting.** FinanceOS is single-instance. If you want to host it for multiple unrelated users, run multiple instances behind a reverse proxy.
- **Realtime sync between devices.** The intended pattern is one always-on host (NAS, Pi, VPS) reachable from your devices over LAN / VPN / Tailscale. No vendor-specific sync layer.
- **Auto-categorisation via ML.** Rule-based smart-defaults are config-driven; everything beyond that is left to your own pipeline.
- **Mobile native apps.** The dashboard is mobile-responsive; a PWA flavour is on the roadmap. Native iOS/Android is not.

---

## Resources

- **`docs/schema.md`** — CSV schema reference (single source of truth for data structure)
- **`docs/tx-guide.md`** — TX free-text grammar, batch syntax, smart-defaults
- **`docs/faq.md`** — feature reference, conventions, hard rules
- **`docs/deployment.md`** — systemd, crontab, sudoers — full always-on deployment guide
- **`docs/contributing.md`** — contributor guide, dev setup, PR conventions
- **`CHANGELOG.md`** — release notes per version

---

## History

The template was extracted from a private personal-finance project that ran in production from early 2026. The first public release (`v1.0.0`) ships the seven-block refactor that made the upstream config-driven and template-ready: a config layer, an i18n infrastructure, a setup wizard with MMEX import, a pluggable bank-reconciliation system, feature toggles, an optional auth middleware, and a backup-export endpoint. The sanitisation pipeline then strips the upstream's personal data, swaps in generic seed accounts/categories, and force-pushes the result here.
