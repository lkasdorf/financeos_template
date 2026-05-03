# FinanceOS — Schema Reference

This document is the **single source of truth** for the FinanceOS CSV schema. Every script must conform. Schema changes are documented here first and propagated to the CSV files in lockstep.

---

## Guiding Principles

1. **Four CSV files are the truth:** `transactions.csv`, `accounts.csv`, `categories.csv`, `third_party.csv`. Plus `prompt_log.csv` for the offline queue.
2. **Amounts are always positive.** Direction lives in the `type` field (`expense` / `income` / `transfer`).
3. **Transfers are one row.** `type=transfer` + `transfer_to_account` (+ `transfer_to_amount` for cross-currency).
4. **Pass-through expenses are two rows**, generated automatically by the TX engine when the account has a `pass_through_payee`.
5. **Custody accounts (`owner != self`)** do not appear in net worth, but their transactions still count in category reports.
6. **Archived accounts (`status=archived`)** disappear from active UI lists; their transactions stay in statistics.
7. **Categories are hierarchical**, max 3 levels deep, separator `:` (e.g. `Home:Office:Equipment`).
8. **Tags are orthogonal** to categories, semicolon-separated in the `tags` field.
9. **CSV format:** UTF-8, comma separator, header in row 1, fields containing commas/newlines wrapped in quotes.

---

## `data/transactions.csv`

The core table. One row per booking. Pass-through expenses produce two rows (expense + income).

| Column | Type | Required | Description |
|---|---|---|---|
| `import_id` | string(16) | ✓ | SHA1(date+account+amount+payee+category+note)[:12], tiebreaker `_2`/`_3` for true duplicates |
| `date` | YYYY-MM-DD | ✓ | Booking date (ISO 8601, no time) |
| `account` | string | ✓ | FK → `accounts.csv.alias` |
| `type` | enum | ✓ | `expense` / `income` / `transfer` |
| `amount` | decimal(14,2) | ✓ | Always positive |
| `currency` | string(3) | ✓ | ISO 4217 code — must match the account's currency |
| `payee` | string | — | Who pays / who is paid. Empty for transfers |
| `category` | string | — | Full hierarchical path with `:`, FK → `categories.csv.path`. Empty for transfers |
| `note` | string | — | Clean handwritten note (visible in dashboard) |
| `raw_note` | string | — | POS raw text from bank exports (hidden in dashboard) |
| `transfer_to_account` | string | — | Only for `type=transfer`: target account alias |
| `transfer_to_amount` | decimal(14,2) | — | Only for cross-currency transfers (e.g. checking USD → cash EUR at an ATM) |
| `receipt_group` | string(16) | — | ID for receipt splits (multiple rows = one physical receipt) |
| `receipt_url` | string | — | Path/URL to the receipt scan (identical across split rows) |
| `tags` | string | — | Semicolon-separated, e.g. `Vacation;Reimbursable` |
| `third_party_id` | string | — | FK → `third_party.csv.id`, when the TX is linked to a third-party balance |

### CSV header
```csv
import_id,date,account,type,amount,currency,payee,category,note,raw_note,transfer_to_account,transfer_to_amount,receipt_group,receipt_url,tags,third_party_id
```

### Example rows
```csv
a1b2c3d4e5f6,2026-04-10,checking,expense,42.50,USD,Whole Foods,Food:Groceries,,,,,,,,
b2c3d4e5f6a1,2026-04-10,checking,expense,8.75,USD,Uber,Transport:Rideshare,evening commute,,,,,,,
c3d4e5f6a1b2,2026-04-10,credit,expense,120.00,USD,Electric Company,Bills:Electricity,monthly,,,,,,,
d4e5f6a1b2c3,2026-04-10,checking,transfer,500.00,USD,,,,,savings,,,,,
e5f6a1b2c3d4,2026-04-10,checking,transfer,200.00,USD,,"USD → EUR ATM withdrawal",,,cash,180.00,,,ATM,
f6a1b2c3d4e5,2026-04-10,cash,expense,30.00,USD,Whole Foods,Food:Groceries,,,,,split-a1b2c3,drive/wholefoods-20260410.jpg,,
091a2b3c4d5e,2026-04-10,cash,expense,15.00,USD,Whole Foods,Home:Household,,,,,split-a1b2c3,drive/wholefoods-20260410.jpg,,
```

---

## `data/accounts.csv`

Every account with its configuration. Aliases are the short names used in TX prompts.

| Column | Type | Required | Description |
|---|---|---|---|
| `alias` | string | ✓ | Unique, lowercase, no whitespace (e.g. `checking`, `cash`, `savings`) |
| `name` | string | ✓ | Full display name (e.g. `Main Checking [USD]`) |
| `currency` | string(3) | ✓ | ISO 4217 code (USD, EUR, GBP, JPY, …) |
| `type` | enum | ✓ | `bank` / `cash` / `mobile_money` / `credit_card` / `savings` / `pass_through` |
| `owner` | enum | ✓ | `self` (your money) / arbitrary string (Custody — e.g. a partner, an employer, a spouse) |
| `status` | enum | ✓ | `active` / `archived` |
| `pass_through_payee` | string | — | Only for `type=pass_through`: auto counter-booking payee (e.g. an employer name) |
| `initial_balance` | decimal(14,2) | ✓ | Starting balance at `initial_balance_date` |
| `initial_balance_date` | YYYY-MM-DD | ✓ | |
| `notes` | string | — | Free annotation |

### Behaviour
- **Net worth** (dashboard): only accounts with `owner=self` and `status=active`.
- **Pass-through** (`type=pass_through`): every expense automatically produces an income counter-booking with `pass_through_payee` and category `Income:<Payee> Reimbursement`. Balance always stays at 0. Useful for accounts that hold someone else's money you spend on their behalf (e.g. a prepaid expense card from an employer).
- **Custody** (`owner != self`): transactions count in category reports but the balance is shown separately under "Custody", not in net worth.
- **Archived**: drops from active dropdowns and account tiles. Transactions stay visible in every report.

---

## `data/categories.csv`

Every category with its path and type.

| Column | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✓ | Full hierarchical path with `:` separator, unique |
| `type` | enum | ✓ | `income` / `expense` (consistent with the top-level membership) |
| `active` | boolean | ✓ | `true` / `false` — inactive ones stay visible but drop out of dropdowns |
| `note` | string | — | Free annotation |
| `pnl` | boolean | ✓ | `true` = operational income/expense (P&L-relevant), `false` = balance-sheet movement (loans, debt repayment, custody) — used as a filter in every income/expense report |
| `essential` | boolean | — | `true` = cost-of-living category (food, bills, transport, healthcare). Powers the cost-of-living view and the cashflow forecast |

### Hierarchy
- Maximum **3 levels**, e.g. `Home:Office:Equipment`
- Intermediate categories (`Home`, `Home:Office`) also exist as rows in the file, but transactions should ideally book against leaf categories
- **Transfers** have no category (`category` field empty in `transactions.csv`), so there is **no** `Transfer` category in `categories.csv`

---

## `data/third_party.csv`

Third-party-money tracking: open receivables and payables.

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Sequential ID, e.g. `tp-0001` |
| `person_name` | string | ✓ | Person or company name |
| `type` | enum | ✓ | `owed_to_me` (they owe you) / `owed_by_me` (you owe them) |
| `amount` | decimal(14,2) | ✓ | Open amount (positive) |
| `currency` | string(3) | ✓ | |
| `date_created` | YYYY-MM-DD | ✓ | |
| `date_settled` | YYYY-MM-DD | — | Set on settlement |
| `settled` | boolean | ✓ | `true` / `false`, default `false` |
| `linked_transaction_ids` | string | — | Comma-separated `import_id`s from `transactions.csv` |
| `note` | string | — | Context |

---

## `data/prompt_log.csv`

Offline queue: every entry is stored **here first** before a script processes it. Protects against data loss on write errors.

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | int | ✓ | Sequential number |
| `timestamp` | ISO 8601 | ✓ | Time of entry |
| `raw_input` | string | ✓ | Original free-text (e.g. `TX 42 Whole Foods checking`) |
| `parsed_json` | string | — | JSON result of the Claude interpretation (empty until parsed) |
| `booked` | boolean | ✓ | `true`/`false` — was the TX written to `transactions.csv`? |
| `booked_at` | ISO 8601 | — | Time of successful booking |
| `error` | string | — | Error message on failed processing |

---

## Conventions

### Transfer handling
- Transfer between same-currency accounts: one row, `amount` + `transfer_to_account`, `transfer_to_amount` empty.
- Transfer with currency crossing (e.g. checking USD → cash EUR at an ATM): one row, `amount` in source currency, `transfer_to_amount` in target currency.
- Dashboard math: source account loses `amount`, target account gains `transfer_to_amount` (or `amount` if empty).

### Pass-through
- Account with `pass_through_payee=X`: every expense booking on this account automatically generates a second row:
  - Same account, `type=income`, same amount, `payee=X`, `category=Income:<X> Reimbursement`
- The pass-through balance therefore always stays at 0.

### Receipt splits
- One physical receipt with multiple categories becomes multiple rows with the same `receipt_group` (UUID/hash) and the same `receipt_url`.
- The sum of the split rows equals the receipt total.
- Each split row has its own category and its own amount.

### Import ID
- Deterministic hash from `sha1(date+account+amount+payee+category+note)[:12]`
- For true duplicates (two identical rows across all fields): suffix `_2`, `_3`, etc.
- Prevents double-importing on re-imports from external sources.

### Auto-tags
Auto-tag rules are configured in `config/defaults.json` under `auto_tag.by_account` and `auto_tag.by_payee`. The empty template ships without auto-tag rules — add your own once you decide which accounts/payees should carry recurring tags. Manual tags applied to a row are never auto-stripped or overridden.

---

## File paths

```
data/
├── transactions.csv        ← main table, every booking
├── accounts.csv            ← account configuration
├── categories.csv          ← category hierarchy
├── third_party.csv         ← third-party balances
├── prompt_log.csv          ← offline queue
├── fx_rates.csv            ← current spot rates (base USD by default), refreshed daily by cron_fx.py
├── fx_rates_history.csv    ← historical monthly rates, for reports
├── backups/                ← automatic backups (gitignored)
│   └── transactions_YYYYMMDD_HHMMSS.csv
└── imports/                ← raw data for migration (gitignored)
    └── (your importer drops files here)
```
