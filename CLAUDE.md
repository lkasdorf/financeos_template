# FinanceOS

## Project
A self-hosted, CSV-based personal finance system. Data lives in `data/`, scripts in `scripts/`, dashboard in `dashboard/`. Bookings happen via the dashboard (free-text + manual) or the Claude Code terminal.

Reference documents:
- **`docs/schema.md`** — final CSV structure (single source of truth)
- **`docs/tx-guide.md`** — example book for TX entries (every case, syntax, flow)
- **`docs/faq.md`** — feature reference, conventions, hard rules
- **`docs/deployment.md`** — always-on deployment guide (systemd, crontab, sudoers)
- **`docs/ROADMAP.md`** — public-facing roadmap

---

## TX Convention — Booking Transactions via Free-Text

Any message starting with `TX` is a booking input. Claude Code (you) interprets the free-text, shows a preview, and confirms with the user before writing to `data/transactions.csv`.

### Flow (binding)

1. **Detect TX prefix** → it's a booking
2. **Read `data/accounts.csv`** (every account with alias, currency, owner, type, pass_through_payee)
3. **Read `data/categories.csv`** (every active category with type)
4. **Parse the free-text** (amount, account, payee, category derivation, tags if any)
5. **Show a preview** in structured form (see example below)
6. **Wait for confirmation** — `y` = book, `n` = discard, free-text = correction
7. **On confirmation:**
   - `python scripts/backup.py transactions` (mandatory before every write)
   - Append the row(s) to `data/transactions.csv`
   - Generate the `import_id`: `sha1(date+account+amount+payee+category+note)[:12]`
   - For pass-through accounts (`account.type == 'pass_through'`): generate **two rows** (expense + auto income counter-booking)
   - Apply auto-tags (see rules below)
   - Short confirmation in chat: `✓ Booked. Import ID: a1b2c3d4e5f6`

### Batch TX (multiple bookings in one message)

Multiple TX can be submitted in one message — either multi-line (each line starts with `TX ...`) or semicolon-separated (`TX 45 Whole Foods cash; 8 Starbucks credit; 250 Electric Co reimburse`). Flow:

1. **Numbered batch preview** of every row (incl. auto counter-bookings for pass-through accounts) — mandatory.
2. Confirmation: `y` = all, `y 1,3` = subset, `y 2-4` = range, `n` = discard everything. Corrections reference the row number (`2: credit instead of cash`). `drop N` removes a row from the batch.
3. **Atomicity:** one backup before the write, one git commit for the entire batch. Either every selected row is written or none (rollback on error).
4. Open follow-up questions (unclear account, new category, archived account) only block the affected row — the rest stays in the preview, the batch is booked once every row is resolved.
5. Commit message summarises: `TX batch: N bookings (<short keywords>)`.

Details & confirmation variants: `docs/tx-guide.md` §14.

### Syntax conventions

**Amounts:**
- `45k` → 45,000
- `2.5m` → 2,500,000
- `15 eur` → 15 EUR (currency explicit)
- Without a currency marker: derived from the account context

**Account aliases** are configured per install in `data/accounts.csv` (each row defines an alias + name + currency + type + owner + status). Read the file each session — no hardcoded list lives in this prompt.

**Transfer syntax:**
- `TX transfer 500 checking to savings` → `type=transfer`, `account=checking`, `transfer_to_account=savings`
- `TX atm <amount> [account]` → ATM withdrawal. Fees come from `data/atm_fees.csv` (Settings → ATM Fees to maintain).
  - Lookup by `(bank, amount)`: matching active row → up to 4 rows (transfer + fee_net + levy + VAT). **Only the transfer row gets the `ATM` tag; the fee rows stay untagged.**
  - Fee category: `Fees:Bank Fees` for every fee row.
  - VAT is computed: `fee_net × vat_rate` (not stored separately in the CSV).
  - If `levy = 0` → only 3 rows (transfer + fee_net + VAT).
  - **No matching row** → ask back: "Amount X is not in `atm_fees.csv`. Provide the fees manually or create a preset?"

**Receipt split (one receipt, multiple categories):**
- `TX 45 Whole Foods cash: 30 groceries, 15 household`
- Generates two rows with the same `receipt_group` and identical `receipt_url`
- The colon signals a split, the comma list the individual line items

**Tags (explicit, optional):**
- `TX 45 Hotel cash #VacationCalifornia` → tag `VacationCalifornia` attached
- Tag names live in `data/tags.csv`; the engine asks back if a referenced tag doesn't exist

### Auto-tag rules

Auto-tag rules are configured in `config/defaults.json` (`auto_tag.by_account` and `auto_tag.by_payee`). Empty by default. Add rules as you find recurring patterns:

```json
{
  "auto_tag": {
    "by_account": { "<alias>": "<TagName>" },
    "by_payee":   { "<lowercase payee>": "<TagName>" }
  }
}
```

Manual tags (`#TagName` in the input) are always honoured on top of auto-tags. The engine does not invent tags that aren't in `data/tags.csv` — it asks back if a manual tag is unknown.

### Pass-through logic (binding)

If `account.type == 'pass_through'`:
1. Write the normal expense row (with the real category, e.g. `Bills:Electricity`)
2. **Generate a second row automatically:** same account, `type=income`, same amount, `payee=<pass_through_payee>`, `category=Income:<pass_through_payee> Reimbursement`
3. Both rows pick up any auto-tags configured for the account
4. **Show both rows in the preview** — a single confirmation covers both

The pass-through balance therefore always stays at 0.

### Custody accounts

If `account.owner != 'self'`:
- Normal booking as usual
- **No** automatic counter-booking (different from pass-through)
- Transactions count in category reports
- The balance is shown separately under "Custody" in the dashboard, **not** in net worth

### Free-text interpretation — examples

| Input | Interpretation |
|---|---|
| `TX 45 Whole Foods cash` | Cash, expense, 45.00 USD, Whole Foods, `Food:Groceries` |
| `TX 100 Target credit` | Credit, expense, 100.00 USD, Target, `Shopping:Household` |
| `TX Salary 4500 checking` | Checking, income, 4,500.00 USD, Employer, `Income:Salary` |
| `TX 250 Electric Co reimburse` | **Two rows:** expense on `reimburse` with `Bills:Electricity` + income counter-booking `Income:<payee> Reimbursement` |
| `TX transfer 500 checking to savings` | Transfer Checking → Savings, 500.00 USD, one row |
| `TX 45 Whole Foods cash: 30 groceries, 15 household` | Split: two rows with `receipt_group` |
| `TX 15 eur Tapas Bar eur` | Cash [EUR], expense, 15 EUR, Tapas Bar, `Food:Dining out` |
| `TX 4 Coffee Cart` | **Asks back if no smart-default rule exists** for "Coffee Cart": Which account — cash, checking, credit? |

### Smart defaults — leaving out the account

For payees / contexts where the account is unambiguous, you can omit it. Configure rules in `config/smart_defaults.json` (`prompt_rules`). Empty by default — add rules as recurring patterns emerge.

```json
{
  "prompt_rules": [
    { "trigger": "Coffee Cart", "account": "cash", "category": "Food:Coffee" }
  ]
}
```

**How it works:**
- Input `TX 4 Coffee Cart` → interpreted as `TX 4 Coffee Cart cash`, category `Food:Coffee`
- Input `TX 4 Coffee Cart credit` → **explicit account overrides the default** (credit instead of cash)
- The preview shows "Account: cash (default for Coffee Cart)" for clarity

**Limits:** to bypass a default once, just specify the account explicitly. The rule only kicks in when the account is missing.

### Question rules

You ask back when:
- **Account ambiguous or missing** → "Which account — cash, checking, or credit?"
- **Category ambiguous** → "Did you mean `Home:Maintenance` or `Automobile:Maintenance`?"
- **New category needed** → "That category doesn't exist yet. Should I create it, or pick an existing one?"
- **Amount without a currency** → derive from the account; if not possible, ask back
- **Archived account** → "That account is archived. Book anyway?"
- **Tag not in `data/tags.csv`** → "That tag doesn't exist. Add it or skip the tag?"

### What you do NOT do automatically

- Invent categories (unless explicitly asked)
- Apply tags that don't exist in `data/tags.csv`
- Overwrite historical data
- Write without a preview + confirmation
- Skip the pass-through auto counter-booking (mandatory whenever the account has a `pass_through_payee`)

---

## Quick commands

- `BALANCE` → current account balances (computed from `accounts.csv` + `transactions.csv`)
- `QUEUE` → open entries from `data/prompt_log.csv` (`booked=False`)
- `THIRD PARTY` → open third-party entries from `data/third_party.csv`
- `SCHED` → due entries from `data/scheduled.csv` as a batch preview, book on `y` (see below)
- `SCHED LIST` → every active scheduled entry, regardless of due date
- `SCHED ALL` → every entry incl. `active=false` (for maintenance / review)
- `MEMORY SYNC` → snapshot the Claude Code memories from `~/.claude/projects/.../memory/` to `memory/` in the repo, commit + push (see below)
- `RECON` → bank reconciliation for the current month (see below)

---

## Memory Sync — `MEMORY SYNC` command

Claude Code stores its persistent memories in a directory it manages outside the repo (the exact path depends on your install — typically under `~/.claude/projects/<project-id>/memory/`). That is the **primary source** — Claude reads and writes there in every session. The repo `memory/` folder is a **snapshot** (backup + deploy vehicle for an always-on host) that is synchronised manually.

**Rule:**
- **At session end** — when memories were changed or added in the session — Claude proactively offers: "Memories were updated. Run `MEMORY SYNC`?"
- **On request** — the user types `MEMORY SYNC` at any time, Claude runs the sync.

**`MEMORY SYNC` flow:**
1. List the files in `~/.claude/projects/<project-id>/memory/`
2. Copy every `*.md` to `memory/` in the repo (overwriting)
3. `git add memory/` — if there are no changes, note "Memories are already in sync" and stop
4. `git commit -m "chore: Memory-Sync <YYYY-MM-DD>"` with an optional detail line (which memories changed)
5. `git push origin main`
6. Short confirmation with the commit hash

**One-way, not bidirectional:** sync goes **only** from `~/.claude/.../memory/` to `memory/` in the repo. Changes made directly in the repo's `memory/` folder (e.g. on a foreign checkout) are **overwritten**. To persist memories from another device into the primary source, copy them manually back into the `.claude/` directory — `MEMORY SYNC` does **not** run that direction automatically.

---

## Scheduled Transactions — `SCHED` command

**File:** `data/scheduled.csv` — templates for recurring bookings. Claude does **not** execute them automatically — only on request (`SCHED`) with a preview and confirmation.

### Schema

```
sched_id, name, account, amount, currency, payee, category, note, manual_tags, frequency, next_run, last_run, active
```

- `frequency`: compact string. Supported: `monthly:<day>` (1–31, or `last` for the month-end), `weekly:<weekday>` (mon/tue/…/sun), `yearly:MM-DD` (once a year on MM-DD), `quarterly:MM-DD` (every three months on DD; MM anchors the quarter set, e.g. `03-15` → Mar/Jun/Sep/Dec, `01-01` → Jan/Apr/Jul/Oct). Day capped per month length (Feb 29 in non-leap year → Feb 28).
- `next_run`: ISO date the row becomes due. Auto-rolled forward after every fire.
- `last_run`: last actual fire date (audit).
- `active`: `true`/`false`. `false` → ignored by `SCHED`, but stays in the file.
- `manual_tags`: only for tags not already covered by auto-rules. Usually empty.
- Pass-through logic kicks in automatically when `account.type == pass_through` — no extra column needed.

### `SCHED` flow

1. Claude reads `data/scheduled.csv`, filters to `active=true AND next_run <= today`.
2. **Batch preview** (numbered, incl. pass-through counter-bookings, incl. auto-tags).
3. Confirmation analogous to batch TX: `y`, `y 1,3`, `y 2-4`, `drop N`, numbered corrections.
4. After `y`:
   - `python scripts/backup.py transactions` + `python scripts/backup.py scheduled`
   - Write every selected row to `transactions.csv` (with fresh `import_id`s)
   - For every triggered row in `scheduled.csv`: `last_run = today`, `next_run = today + 1 month` (or the next match of the `frequency` pattern)
   - **One git commit** covering both modified files: `SCHED: N bookings triggered (<keywords>)`
5. Short confirmation in chat with every new import ID.

### Maintaining `scheduled.csv`

- **New entry:** append a row directly. `sched_id` runs sequentially (`sched-001`, `sched-002`, …). Claude can do this on request, always with a preview.
- **Deactivate:** set `active=false`, the row stays for history.
- **Delete:** only when the template should disappear entirely (no historical relevance left).
- **Change amount/date:** edit the CSV directly, don't convert it to a one-off scheduled tx.

---

## Reconciliation — `RECON` command

Monthly reconciliation of bank statements against `data/transactions.csv`. Drop the bank statement file (CSV / XLS depending on the bank) into `data/bank_imports/`.

**Adapter system:** the parse + match logic lives under `scripts/reconciliation/` and is pluggable. Each bank is an adapter (subclass of `BankAdapter` from `scripts/reconciliation/base.py`). The account → adapter routing is configured in `config/reconciliation.json`. The template ships with `csv_generic` as the default adapter (configurable column map for date/details/amount or debit+credit). Adding a new bank: write `scripts/reconciliation/<bank>.py`, register it in `scripts/reconciliation/__init__.py`, add the account mapping. See `docs/faq.md` → "Reconciliation" for the full guide.

### Flow

1. Parse the statement file via the configured adapter
2. **Totals check:** bank total debits/credits vs. FOS total for the period
3. **Balance check:** bank closing balance vs. FOS-computed account balance
4. **Row matching:** group by `(date, amount)`, count matched/unmatched
5. **Difference analysis:** explain unmatched (date shifts, splits, rounding)
6. Write the result to `data/bank_imports/reconciliation_YYYY_MM.md`
7. Update `data/bank_imports/recon_index.json` (for the dashboard view)

### Expected differences (no action required)

- **Date shift:** booking date often 1 day before bank posting date
- **Splits:** bank shows 1 row, FOS has multiple split rows (sum matches)
- **Rounding:** small differences from imported sources

---

## Dashboard — `dashboard/index.html`

Single-file dashboard. Start via `python scripts/serve.py` (or `python -m http.server 8080` in the repo root) → `http://localhost:8080/dashboard/`.

### Pages (SPA routing via hash)

- **Dashboard** (`#dashboard`) — Net Worth, Accounts (list), Monthly Summary, Charts, Recent TX
- **Reports** (`#reports`) — categorised (Income / Expenses / Forecast), detail view with back navigation
- **Transactions** (`#transactions`) — every TX, filters (type + account + tags + …), sortable, paginated (100/page)
- **Accounts** (sidebar fold-out) — click an account → detail page with every TX
- **Reconciliation** (`#reconciliation`) — monthly reconciliation reports grouped by year (behind the `crdb_recon` feature flag)

### FX conversion

- **Currency switcher** in the dashboard header — values from `config/i18n/<locale>.json` and `config/defaults.json`
- Live rates from the FX provider configured in `config/defaults.json` (default: `open.er-api.com`, no API key required)
- Fallback: `data/fx_rates.csv`
- All amounts are converted on the fly (Net Worth, Accounts, Monthly Summary, Charts)

### Important rule: reimbursements

Reimbursements (e.g. `Income:<payee> Reimbursement`) count **everywhere as regular income** — dashboard, cashflow chart, reports. Don't filter them out. Otherwise the income/expense balance would be skewed (the expenses on pass-through accounts are included).

The Income report additionally shows the split "Real Income" vs. "Reimbursements" as info tiles.

### Dashboard language

The dashboard is fully internationalised via `config/i18n/<locale>.json`. The default locale is English; additional locales are added by dropping a JSON file and updating `window.AVAILABLE_LOCALES` in `dashboard/i18n.js`.

---

## Auth Layer — optional

The default install runs **without auth** (intended for LAN / VPN reach only). To enable: `python scripts/auth.py --set-password` (interactive), then restart the server. Writes `config/auth.json` with a bcrypt hash. Disable: `python scripts/auth.py --disable`. Status: `python scripts/auth.py --status`. The middleware in `scripts/auth.py` is a no-op while `auth.json` is missing or `mode=none`. With `mode=basic` the server returns HTTP `401 + WWW-Authenticate: Basic realm="FinanceOS"`, the browser shows its native login dialog. Exempt paths: `/api/health` always; setup-wizard assets only while the install isn't initialised.

---

## Hard Rules

1. **Backup mandate:** `scripts/backup.py` runs before every write to `data/*.csv`. No exceptions.
2. **Git after every write:** `git add data/transactions.csv` + `git commit` with a meaningful message + `git push` (when a remote is configured).
3. **Offline queue:** every input lands **first** in `data/prompt_log.csv` (`booked=False`), then it's parsed/booked. On success `booked=True`. On failure the entry stays in the queue.
4. **Single source of truth:** `docs/schema.md` is binding. Scripts read accounts/categories **only** from `data/accounts.csv` and `data/categories.csv`.
5. **API key:** `ANTHROPIC_API_KEY` from the environment (only relevant when using the optional Claude API for free-text TX parsing — Claude Code itself doesn't need it).
6. **Response style:** short, structured, no fluff. For bookings: preview → confirmation → commit message. No small talk.

---

## Where the user-specific bits live

The template ships with empty `data/accounts.csv`, `data/categories.csv`, `data/tags.csv` (just the header rows + the seed sets generated by the setup wizard). User-specific configuration — auto-tag rules, smart-default prompt rules, pass-through reimbursement payees — lives in `config/*.json`. As you and the user work together over time, you'll learn their accounts, payees, and category preferences from `data/accounts.csv` + `data/payees.json` + `data/categories.csv`. There is no hardcoded list in this file.
