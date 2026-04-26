# TX Guide — Booking Transactions via Free-Text

Practical reference with examples for every case. The binding rules live in `CLAUDE.md` (section "TX convention"). This document is the example book that goes with them.

---

## Core principle

Any message that starts with `TX` is a booking input. The TX engine parses the free-text, shows a preview, and only writes to `data/transactions.csv` after your confirmation (`y`).

**Flow:**
1. You type `TX ...`
2. The engine shows a preview (account, amount, payee, category, optional tags)
3. You answer `y` / `n` / a correction
4. On `y`: backup → write the row(s) → short confirmation with the import ID

---

## 1. Amount shorthands

| Input | Meaning |
|---|---|
| `45k` | 45,000 |
| `2.5m` | 2,500,000 |
| `3200` | 3,200 |
| `15 eur` | 15 EUR (currency explicit) |
| `25 usd` | 25 USD |
| `50 gbp` | 50 GBP |

Without an explicit currency marker, the currency is derived from the account.

---

## 2. Simple expenses (Self accounts)

**Cash:**
```
TX 45 Whole Foods cash
→ Cash, expense, 45.00 USD, Whole Foods, Food:Groceries

TX 10 Farmers Market cash veggies
→ Cash, expense, 10.00 USD, Farmers Market, Food:Groceries, note="veggies"
```

**Checking / debit card:**
```
TX 100 Target checking
→ Checking, expense, 100.00 USD, Target, Shopping:Household

TX bank fee 5
→ Checking, expense, 5.00 USD, Bank, Fees:Bank Fees
```

**Credit card:**
```
TX 8 Starbucks credit
→ Credit, expense, 8.00 USD, Starbucks, Food:Coffee

TX 120 Best Buy credit
→ Credit, expense, 120.00 USD, Best Buy, Shopping:Electronics
```

**Foreign-currency accounts (travel / second residency):**
```
TX 15 eur Tapas Bar eur
→ Cash [EUR], expense, 15 EUR, Tapas Bar, Food:Dining out

TX 45 eur Lidl checking_eur
→ Checking [EUR], expense, 45 EUR, Lidl, Food:Groceries
```

---

## 3. Income

```
TX Salary 4500 checking
→ Checking, income, 4,500.00 USD, Employer, Income:Salary

TX Refund 50 cash from Sam
→ Cash, income, 50.00 USD, Sam, Income:Other
  (asks back if the category is unclear)
```

---

## 4. Transfers (between Self accounts)

**Same-currency transfer:**
```
TX transfer 500 checking to savings
→ type=transfer, account=checking, transfer_to_account=savings, 500.00 USD

TX transfer 200 eur checking_eur to cash_eur
→ Checking [EUR] → Cash [EUR], 200 EUR
```

**ATM withdrawal — preset fees:**

ATM withdrawals can be modelled as a transfer plus one or more fee bookings. The default account, the fee schedule, and the fee category are configured in `data/atm_fees.csv` (UI: Settings → ATM Fees). Once a row exists for `(bank, amount)`, the engine generates the matching bookings automatically.

```
TX atm 200 checking
  [1] transfer checking → cash, 200.00 USD, tag ATM
  [2] expense  checking,    2.50 USD, Bank, Fees:Bank Fees
  [3] expense  checking,    0.45 USD, Bank, Fees:Bank Fees   (VAT line, optional)
```

**Important:** Only the transfer row gets the `ATM` tag. The fee rows stay untagged so they show up cleanly under `Fees:Bank Fees` and don't double-count in ATM reports.

**Unknown amount** (no row in `atm_fees.csv`) → the engine asks back with the missing fee details, no automatic guess.

---

## 5. Pass-through accounts — auto counter-booking

Accounts of `type=pass_through` (e.g. an employer-funded prepaid card) generate **two rows** for every expense: the actual expense + an income counter-booking to the configured `pass_through_payee`. The balance stays at 0.

Configure the account once in `accounts.csv` with a `pass_through_payee` (e.g. `"Employer Inc."`); every booking on that account becomes a pair of rows automatically.

**Pass-through expense:**
```
TX 250 Electric Co reimburse
→ Row 1: reimburse, expense, 250.00 USD, Electric Co, Bills:Electricity
→ Row 2: reimburse, income,  250.00 USD, Employer Inc., Income:Employer Inc. Reimbursement
```

**Cross-currency pass-through (USD card):**
```
TX 450 usd AWS reimburse_usd
→ Row 1: reimburse_usd, expense, 450 USD, AWS, Bills:Software
→ Row 2: reimburse_usd, income,  450 USD, Employer Inc., Income:Employer Inc. Reimbursement
```

Optional: a tag rule in `config/defaults.json` (`auto_tag.by_account`) can attach a recurring tag like `Reimbursable` to every row on this account. The template ships with the rule list empty — add what you need.

---

## 6. Custody accounts (`owner != self`)

Custody accounts hold someone else's money you administer (e.g. a partner's savings, a child's allowance). They are **not** counted in net worth, but bookings against them work normally — no auto counter-booking.

```
TX 80 Office Supplies partner_usd
→ Partner Savings [USD], expense, 80.00 USD, Office Depot, Office:Supplies

TX 500 eur Deposit partner_eur
→ Partner Savings [EUR], income, 500 EUR, …, Income:Other
  (category asked back if ambiguous)

TX 100 Reserve emergency_jar
→ Emergency Jar, normal entry, no auto counter
```

Custody balances are surfaced in the dashboard under "Custody", separated from net worth.

---

## 7. Receipt splits (one receipt, multiple categories)

Syntax: `Amount Payee Account: Sub-amount Category, Sub-amount Category, ...`

```
TX 45 Whole Foods cash: 30 groceries, 15 household
→ Row 1: cash, 30, Whole Foods, Food:Groceries,    receipt_group=split-xxxx
→ Row 2: cash, 15, Whole Foods, Shopping:Household, receipt_group=split-xxxx

TX 100 Target credit: 60 groceries, 40 alcohol
→ Two rows, same receipt_group
```

Every split row shares the same `receipt_group` and `receipt_url` — that keeps the physical receipt linked.

---

## 8. Tags (manual + automatic)

**Auto-tags** are configured in `config/defaults.json` (`auto_tag.by_account` and `auto_tag.by_payee`). The template ships with the rule lists empty — add your own when you spot a recurring need (e.g. tag every booking on a reimbursable account, tag every payment to a specific landlord).

**Manual tags — with `#`:**
```
TX 45 Whole Foods cash #VacationCalifornia
→ tag VacationCalifornia

TX 250 HVAC Service cash #HouseRepairs
→ tag HouseRepairs

TX 1200 Flight credit #BusinessTrip2026
→ tag BusinessTrip2026
```

**Combining multiple tags:**
```
TX 300 Hotel cash #VacationCalifornia #Anniversary
→ tags: VacationCalifornia;Anniversary
```

Valid tag names live in `data/tags.csv`. Add new ones via Settings → Tags or by appending a row in the CSV; the engine asks back if you reference a tag that doesn't exist yet.

---

## 9. Smart defaults — leaving the account out

When the payee uniquely implies an account, you can omit it. The engine fills the default and points it out in the preview.

The default rules live in `config/smart_defaults.json` (`prompt_rules`). The template ships with the rule list empty — add rules as you find recurring patterns.

Example with a configured rule for `"Coffee Cart"` → cash:

| Input | Interpreted as |
|---|---|
| `TX 4 Coffee Cart` | `TX 4 Coffee Cart cash`, category `Food:Coffee` |
| `TX 4 Coffee Cart credit` | default overridden → credit |

An explicit account always wins over the default.

---

## 10. Third Party (other people's money — pass-through line items)

When you advance money for somebody else (or receive money that will flow back later), it lives in `data/third_party.csv`. The booking itself is a normal TX, just linked via `third_party_id`. Examples emerge with the first real use case — until then: book it as a regular TX and ask the engine to link it after the fact.

---

## 11. When the engine asks back

| Situation | The engine asks |
|---|---|
| Account missing / ambiguous | "Which account — cash, checking, or credit?" |
| Category ambiguous | "Did you mean Home:Maintenance or Automobile:Maintenance?" |
| New category needed | "That category doesn't exist yet — create it or pick an existing one?" |
| Amount without a currency, account unclear | "Which currency — USD, EUR, GBP?" |
| Archived account | "That account is archived. Book anyway?" |
| New tag not in the list | "That tag doesn't exist — add it or skip the tag?" |

---

## 12. Confirmation flow — concrete example

**You:**
```
TX 250 Electric Co reimburse
```

**The engine shows:**
```
Preview — 2 rows (pass-through):

Row 1 — Expense:
  Account:  Reimbursable Card (reimburse)
  Amount:   250.00 USD
  Payee:    Electric Co
  Category: Bills:Electricity

Row 2 — Auto counter-booking:
  Account:  Reimbursable Card (reimburse)
  Amount:   250.00 USD  (income)
  Payee:    Employer Inc.
  Category: Income:Employer Inc. Reimbursement

Book? (y / n / correction)
```

**You:** `y`

**The engine:**
```
✓ Booked. Import IDs: a1b2c3d4e5f6, f6e5d4c3b2a1
```

---

## 13. Correction instead of yes/no

Instead of `n` you can correct directly — the engine interprets the free-text as a change request:

```
TX 45 Whole Foods cash
→ Preview: ..., Food:Groceries
You: "no, Leisure:Alcohol"
→ New preview with Leisure:Alcohol
```

```
TX 100 Target credit
→ Preview: ...
You: "split 60 groceries 40 household"
→ New preview as a split
```

---

## 14. Batch TX — multiple bookings in one message

You can submit several transactions in one message. The engine shows a **numbered batch preview**, you confirm with a single `y`, the backup runs once, and every row lands in one commit.

### Variant A — multi-line (best on desktop)

```
TX 45 Whole Foods cash
TX 8 Starbucks credit
TX 250 Electric Co reimburse
```

### Variant B — semicolon-separated (best on mobile)

```
TX 45 Whole Foods cash; 8 Starbucks credit; 250 Electric Co reimburse
```

The leading `TX` is enough — the following segments are auto-detected as additional bookings.

### Batch preview

```
Batch preview — 3 TX (4 CSV rows, incl. 1 pass-through counter-booking):

[1] Cash, expense, 45.00 USD, Whole Foods, Food:Groceries
[2] Credit, expense,  8.00 USD, Starbucks, Food:Coffee
[3] Reimbursable Card (reimburse), expense, 250.00 USD, Electric Co, Bills:Electricity
    + Auto counter-booking: reimburse, income, 250.00 USD, Employer Inc., Income:Employer Inc. Reimbursement

Book? (y / n / subset / correction)
```

### Confirmation options for batches

| Input | Meaning |
|---|---|
| `y` | book every row |
| `n` | discard everything |
| `y 1,3` | only book rows 1 and 3, drop the rest |
| `y 2-4` | book rows 2 to 4 |
| `2: credit instead of cash` | correction for row 2, new preview |
| `3: Leisure:Alcohol` | change row 3's category |
| `drop 2` | remove row 2 from the batch, re-render the rest |

### Guarantees

- **One backup** before the write (not per row).
- **One git commit** with every row and a summary message, e.g. `TX batch: 3 bookings (Whole Foods, Starbucks, Electric Co reimburse)`.
- **Pass-through auto counter-bookings** are added correctly per row and shown in the preview.
- **Atomicity:** either every selected row is written or none. On a mid-batch error the whole batch is rolled back (nothing committed).

### Limits

- Splits (`TX 45 Whole Foods cash: 30 groceries, 15 household`) are allowed **inside** a batch item but count as **one** TX in the preview (the sub-rows are shown indented).
- Batches with more than ~10 TX in one message: the engine asks back to confirm that it's intentional.
- For pending follow-ups (unclear account, new category, archived account) the affected row stays on "needs clarification" while the rest is shown normally. The batch can only be booked once every row is resolved.

---

## 15. Scheduled Transactions — `SCHED` command

Recurring bookings live in `data/scheduled.csv`. They are **not** executed automatically — you have to type `SCHED` to make the engine show the due entries and book them after your confirmation.

### Commands

| Input | Effect |
|---|---|
| `SCHED` | Every due entry (`active=true AND next_run <= today`) as a batch preview |
| `SCHED LIST` | Every active entry, regardless of due date (for an overview) |
| `SCHED ALL` | Every entry incl. `active=false` (for maintenance) |

### `SCHED` flow

```
> SCHED

Due scheduled transactions (as of 2026-05-01):

[1] sched-001 Bank Account Fee
    checking, expense, 5.00 USD, Main Bank, Fees:Bank Fees

[2] sched-002 Apartment Rent
    reimburse, expense, 1,500.00 USD, Landlord, Bills:Rent
    + Auto counter-booking: reimburse income 1,500.00 USD, Employer Inc., Income:Employer Inc. Reimbursement

... (more rows)

Summary: 5 templates → 6 CSV rows (incl. 1 pass-through counter-booking)

Book? (y / n / subset / correction)
```

The confirmation syntax mirrors batch TX (§14): `y`, `y 1,3,5`, `y 2-4`, `drop 4`, numbered corrections.

### What happens after `y`

1. Backups: `transactions.csv` + `scheduled.csv`
2. New rows in `transactions.csv` (with fresh `import_id`s)
3. `scheduled.csv` updated:
   - `last_run` = today
   - `next_run` = next match (for `monthly:1` → 1st of the next month)
4. **One** git commit: `SCHED: N bookings triggered (<keywords>)`
5. Confirmation with the new import IDs

### Adding a scheduled transaction

Append a new row in `data/scheduled.csv` directly, or via Settings → Scheduled. Example input the engine accepts:

```
New scheduled tx: Streaming subscription, 8.99 USD monthly on the 15th, credit, Subscriptions:Services
```

The engine shows the new row, asks for `next_run`, and writes after `y`.

### Limits

- Currently only `monthly:<day>` and `weekly:<weekday>` are implemented as frequencies. Quarterly / yearly come on demand.
- Pass-through counter-bookings are derived at fire time from `accounts.csv.type` — no extra column in `scheduled.csv`.
- Auto-tag rules apply the same way as for manual TX, so `manual_tags` usually stays empty.
- `SCHED` is idempotent per day: if you've already fired an entry today, its `next_run` has already rolled forward and it won't show up again.

---

## 16. What is NOT allowed (hard rules)

- **No write without preview + confirmation.**
- **No skipping the pass-through counter-booking.**
- **No free-form new tags** — only what's in `data/tags.csv` (or explicitly approved on the fly).
- **No free-form new categories** without explicit approval.
- **No booking on archived accounts** without confirmation.
- **No overwriting historical data.**

---

## Quick reference — one-liners for daily life

```
TX 45 Whole Foods cash                    # standard expense
TX 100 Target credit: 60 food, 40 household  # split
TX Salary 4500 checking                   # income
TX 250 Electric Co reimburse              # pass-through (2 rows auto)
TX transfer 500 checking to savings       # transfer
TX atm 200 checking                       # ATM (transfer + fees)
TX 4 Coffee Cart                          # smart default (account omitted)
TX 15 eur Tapas Bar eur                   # foreign currency
TX 800 Landlord checking                  # auto-tag if configured
TX 45 Hotel cash #VacationCalifornia      # manual tag
```

---

**See also:**
- `CLAUDE.md` — binding rules, account table, tag list
- `docs/schema.md` — CSV structure (single source of truth)
- `data/accounts.csv` — every account with its alias
- `data/categories.csv` — every active category
