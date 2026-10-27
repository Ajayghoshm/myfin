# Phase D (Debts and Wealth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Track informal lending and formal loans/EMIs (#1) without distorting spending.
- Explain monthly net-worth change (#17).
- Add a retirement/FIRE calculator (#5).
- Link investments to goals (#7).
- Keep an "if something happens to me" file (#18).

**Architecture:**
- **Debts:** a `debts` + `debt_payments` model. Transactions gain `debt_id` + `debt_role`.
  - The shared counts rule excludes lend, borrow, repayment and disbursement rows; EMI interest still counts.
  - Formal loans use a new account type `LOANAC`, with a negative balance equal to outstanding principal.
  - An EMI is stored as an interest `E` row plus a principal `T` row into the loan account.
- **Net worth:** one helper, `netWorthAt`. It powers #17 and #5 now, and #16 and #21 in Phase E.
- **Retirement:** the maths is pure functions in the API behind one endpoint, which takes optional what-if overrides.
- **#7:** mirrors the existing `goal_has_account` with a new `goal_has_asset`.
- **#18:** user-entered entries (`legacy_entries`) plus live data, printed client-side.

**Tech Stack:** myfin-api: Express 5, Prisma 7, MySQL 8.4, joi, vitest. myfin-web: React 19, MUI, react-query, i18next, nivo.

**Spec:** `docs/superpowers/specs/2026-10-27-shortlist-designs.md`. Sections #1, #17, #5, #7 and #18, and "Cross-cutting decisions" 1, 2, 8 and 10, are binding.

## Global Constraints

- **Counts rule:** `countsForAnalyticsSql` becomes `type IN ('E','I') AND is_adjustment = false AND (debt_role IS NULL OR debt_role = 'interest')`.
  - Roles are `lend`, `borrow`, `repayment`, `disbursement`, `interest` and `principal`.
  - Principal rows are `T` anyway.
  - The list/bulk filter hides the same non-counting rows whenever it hides adjustments: month or day set, with type `E`/`I`.
  - Every figure still equals its drill-down.
- **Net worth** (cross-cutting 2):
  - Includes:
    - active non-investing account balances, including `LOANAC` and `CREAC` as they are (negative = owed);
    - invest holdings at market value;
    - outstanding lent;
    - minus outstanding borrowed.
  - `INVAC` balances are never added; their holdings count instead.
- **Earmarking** (cross-cutting 8):
  - Retirement may overlap goals and the savings-target account, but never emergency or sinking accounts.
  - Retirement counts invest holdings at market value plus ticked non-investing accounts, and never `INVAC` balances.
  - `LOANAC` and `CREAC` can't be earmarked for anything.
- **Money:** cents in the DB, currency in API responses. Rates are stored as `Decimal(6,3)` percent per year.
- **Months:** IST months via `monthRangeIST`. #17 uses calendar IST months (a late salary counts in the month it landed), because net worth is a balance.
- **Backup/restore:**
  - every new table and column is included;
  - id maps are keyed by raw backup ids (never `BigInt()` lookups);
  - `restoreUserSchema` accepts the new keys;
  - old backups restore with defaults;
  - tests use JSON round-trips.
- **Tests and databases:**
  - Integration tests run only on `localhost:3308`, with `DATABASE_URL` inline on every vitest command.
  - Never connect to 3306 or 3307.
  - Run one vitest process at a time.
  - Web checks: `tsc`, `build`, and `myfin-web/node_modules/.bin/biome` (never `npx biome`). Also follow `myfin-web/docs/frontend-guidelines.md`.
- **schema.prisma:** hand-edit it, keep its existing line endings, never run `prisma format`. The diff for each task must show only the added lines.
- **Locales:** every directory under `myfin-web/public/locales` (en, fr, pt), with textual insertion and i18next `_one`/`_other` plurals.
- **Commits:** every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Marking a payment to a friend as a loan:** it disappears from Insights spending and its drill-down. Their repayment disappears from income. Net worth is unchanged by the pair. *(Tests in Tasks 1 and 3.)*
2. **Matching a ₹10,661.85 EMI debit:** it becomes interest ₹1,200 (counted as spending) plus a principal transfer of ₹9,461.85. The paying account's balance is unchanged, and the loan's outstanding principal drops. *(Test in Task 2.)*
3. **A loan already half-paid when added:** past EMIs can be marked paid manually. Outstanding principal is right, and the bank balance is untouched. *(Test in Task 2.)*
4. **#17's parts always sum to the net-worth change:** anything unexplained shows as "other", never hidden. *(Test in Task 3.)*
5. **Missing retirement inputs or a zero real return:** the page links to settings, or uses the limit formula. Never NaN/∞. *(Test in Task 4.)*

---

### Task 1: Debt foundations and people (lent / borrowed)

**Files:**
- **Schema** (migration `add_debts`):
  - `debts`:
    - `debt_id` PK; `users_user_id` FK cascade; `kind VarChar(10)` (`lent`|`borrowed`|`loan`);
    - `counterparty_name VarChar(255)`; `counterparty_key VarChar(255)?` (payee key);
    - `principal BigInt`; `rate Decimal(6,3) @default(0)`; `tenure_months Int?`; `emi BigInt?`; `emi_day Int?`;
    - `account_id BigInt?` (paying/receiving account); `loan_account_id BigInt?` (`LOANAC`);
    - `start_date BigInt`; `due_date BigInt?`; `note Text?`; `status VarChar(10) @default("open")`; `created_at BigInt`.
  - `debt_payments`:
    - `payment_id` PK; `debts_debt_id` FK cascade;
    - `date BigInt`; `amount BigInt`; `principal_part BigInt`; `interest_part BigInt @default(0)`;
    - `transaction_id BigInt?` (FK SetNull); `principal_transaction_id BigInt?` (FK SetNull);
    - `installment_no Int?`; `manual Boolean @default(false)`.
  - `transactions.debt_id BigInt?` (FK SetNull); `transactions.debt_role VarChar(12)?`.
- **Constants:** `MYFIN.ACCOUNT_TYPES.LOAN = 'LOANAC'`.
  - Web `AccountType` gets `LOANAC` with locale labels.
  - Freshness default for `LOANAC` = never (0).
  - The earmark validator rejects `LOANAC`/`CREAC`.
- **Modify:**
  - `countsForAnalyticsSql` and the list/bulk exclusion, per Global Constraints;
  - `backupManager` (debts, payments, the transaction columns);
  - the wipe.
- **Create** `myfin-api/src/services/debts/debtService.ts` (people part), plus routes under `/debts`:
  - `GET /` → `{debts, totals: {owed_to_you, you_owe}}`;
  - `POST /` (people: `kind`, name, amount, date, due, note, optional `transaction_id`);
  - `PUT /:id`, `DELETE /:id`;
  - `POST /:id/repayments {amount, date, transaction_id?}` (manual when there is no transaction);
  - `GET /:id/repayment-suggestions`;
  - `DELETE /:id/repayments/:paymentId`.
- **Web:**
  - a new page `myfin-web/src/features/debts/Debts.tsx` at `/debts`, in the sidebar. It has a People tab with:
    - totals "Owed to you ₹X · You owe ₹Y";
    - entries with outstanding, status (outstanding / settled ✓ / overdue) and repayments;
    - an add dialog;
    - repayment suggestions to confirm;
    - manual repayment.
  - A Transactions row action "Mark as loan to / from a person…" that creates an entry from that transaction.
  - Locale keys.
- **Test** `myfin-api/__tests__/integration/debtsPeople.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export type DebtRole = 'lend' | 'borrow' | 'repayment' | 'disbursement' | 'interest' | 'principal';
  export function outstandingCents(debt, payments): number;            // principal − Σ principal_part
  export function peopleTotals(userId: bigint, atEpoch?: number): Promise<{ owedToYouCents: number; youOweCents: number }>; // as of a time (Task 3 uses it for month ends)
  ```
- **Entry from a transaction:**
  - A lent entry needs an `E` row; a borrowed entry needs an `I` row.
  - The row gets `debt_id`, and `debt_role` `lend`/`borrow`. Its amount is the principal.
  - The counterparty key is the row's payee key.
- **Repayment:**
  - **Links:** a linked transaction must be an `I` row for lent, or an `E` row for borrowed. It gets `debt_role` `repayment`, and principal_part = amount.
  - **Settling:** status becomes `settled` when outstanding ≤ 0.
  - **Overdue:** shown when `due_date < now` and the entry is not settled. This is computed, not stored.
- **Suggestions:** unlinked rows of the right type after the start date whose payee key equals the counterparty key. Read-only; confirming links them.
- **Ownership:** another user's debt or transaction → 401. Unlinking or deleting clears `debt_id`/`debt_role` on the linked rows.

- [ ] **Step 1: Failing tests.**
  - **Lend:** "PAID TO RAHUL" E ₹5,000 is marked lent. October Insights spending drops by 5,000. The list with month + type E no longer contains it, and without a type it does.
  - **Repayments:** "RECEIVED FROM RAHUL" I ₹2,000 is suggested, then confirmed. Income excludes it and outstanding is 3,000. A manual cash repayment of ₹3,000 settles the entry.
  - **Borrowed:** a ₹10,000 entry gives `you_owe` 10,000.
  - **Overdue:** a past due date makes the entry overdue.
  - **Deletion:** deleting the entry restores the transaction to counting.
  - **Account type:** the `LOANAC` type exists, and earmarking it as an emergency fund → 400.
  - **Backup:** a JSON round-trip keeps entries, payments and the transaction links.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full integration and unit suites, plus api `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: debts — lent and borrowed with repayments (#1)`.

### Task 2: Formal loans and EMIs

**Files:**
- **Create** `myfin-api/src/services/debts/loanMath.ts` (pure) and `myfin-api/src/services/debts/loanService.ts`.
- **Routes** under `/debts/loans`:
  - `POST /` (lender, principal, rate, tenure, emi optional, emi_day, paying account, start date, optional `disbursement_transaction_id`);
  - `GET /:id` (schedule and status);
  - `POST /:id/installments/:n/match {transaction_id}`;
  - `POST /:id/installments/:n/mark-paid {date?}`;
  - `POST /:id/installments/:n/unpay`;
  - `GET /:id/match-suggestions`;
  - `GET /:id/prepayment?amount=&after_installment=`.
- **Web:** a Loans tab on `/debts`:
  - a list with outstanding principal, interest paid, EMIs left and end date;
  - a loan detail with the schedule, with each row showing paid (matched / manual) / due / missed and the actions match / mark paid / unpay;
  - "mark all past EMIs paid";
  - the prepayment what-if;
  - locale keys.
- **Test:**
  - `myfin-api/__tests__/unit/loanMath.test.ts`;
  - `myfin-api/__tests__/integration/loans.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export function emiFor(principalCents: number, annualRatePct: number, months: number): number; // cents, rounded; rate 0 → ceil(principal / months) to the cent
  export function schedule(principalCents: number, annualRatePct: number, months: number, emiCents: number, startDate: string /* YYYY-MM-DD first EMI */): { n: number; date: string; emi: number; interest: number; principal: number; balance: number }[];
  //   monthly rate = annual/12/100; interest = round(balance × r); principal = emi − interest; the last row's principal = remaining balance (emi adjusted), balance ends at 0
  export function prepaymentWhatIf(sched, afterInstallment: number, prepayCents: number): { months_saved: number; interest_saved: number; new_end_date: string };
  ```
- **Creating a loan:**
  - creates a `LOANAC` account named after the lender;
  - opens it with one `is_adjustment` `E` row of the principal, dated at the start ("Loan opening balance"), so the balance is −principal;
  - marks the optional disbursement transaction `debt_role` `disbursement`.
- **Matching an installment to a real `E` transaction** (amount within ±₹1 of the EMI):
  - The transaction's amount becomes the interest part. It keeps its description and gets `debt_role` `interest`, plus category "Loan interest" (auto-created per user, type E).
  - A new `T` of the principal part goes from the paying account to the loan account, dated the same day, with `debt_role` `principal`.
  - All of this happens in one DB transaction through `TransactionService` (balances recalculated).
  - The paying account's net change equals the original debit.
- **Mark paid manually:**
  - records the payment with `manual = true`;
  - creates an `is_adjustment` `I` row on the loan account for the principal part, so the bank balance is untouched;
  - interest is recorded in the payment but is not spending.
- **Unpay:** reverses whichever path was used.
- **Missed:** an installment is missed when its date is more than 5 days before now and it is unpaid.
- **Ruling R-D1:** an EMI only counts its interest as spending. The principal `T` and the opening adjustment never count.

- [ ] **Step 1: Failing tests.**
  - **Unit:**
    - `emiFor(12000000, 12, 12)` = 1066185.
    - In `schedule`, row 1 has interest 120000 and principal 946185, and the last balance is 0.
    - The principals sum to 12000000.
    - At 0 % over 10 months on 1,200,000 the EMI is 120000 with all interest 0.
    - `prepaymentWhatIf`: on the 0 % loan, 240000 after installment 2 gives `months_saved` 2 and `interest_saved` 0. On the 12 % loan, 2000000 after installment 3 gives `months_saved` ≥ 1 and `interest_saved` > 0.
  - **Integration:**
    - **Create:** creating the ₹1,20,000 / 12 % / 12-month loan gives a loan balance of −120,000. October Insights spending is unchanged.
    - **Match:** matching a ₹10,661.85 debit to installment 1 leaves the paying account balance unchanged. The loan balance becomes −110,538.15. October spending rises by exactly 1,200 compared with no EMI, i.e. the EMI debit (10,661.85) is replaced by 1,200. The drill-down sums still match.
    - **Mark paid:** marking installments 2–3 paid manually makes outstanding principal match the schedule's balance after row 3. The paying account is unchanged.
    - **Unpay:** reverting installment 1 restores the original debit and removes the principal `T`.
    - **Missed:** an installment 10 days overdue shows as missed.
    - **Ownership:** another user's loan → 401.
    - **Backup:** a JSON round-trip keeps the loan, payments, roles and the loan account.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: formal loans and EMIs with schedule and prepayment what-if (#1)`.

### Task 3: Net worth helper and #17 net worth change, explained

**Files:**
- **Create** `myfin-api/src/services/wealth/netWorthService.ts`, plus the route `GET /insights/net-worth?month=YYYY-MM`.
- **Web:** `NetWorthCard.tsx` on Insights. It has:
  - a headline;
  - the parts, each linked to its drill-down where one exists (saved → the month's income and spending lists; write-offs → the month's adjustments list);
  - a 12-month stacked bar chart (nivo);
  - a per-account change list;
  - locale keys.
- **Test** `myfin-api/__tests__/integration/netWorth.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export function netWorthAt(userId: bigint, atEpoch: number): Promise<{ totalCents: number; accounts: { account_id: string; name: string; type: string; cents: number }[]; investCents: number; owedToYouCents: number; youOweCents: number }>;
  export type NetWorthChange = { month: string; start: number; end: number; change: number;
    parts: { saved: number; investment_growth: number; write_offs: number; other: number }; debt_paid_down: number;   // parts sum exactly to change; debt_paid_down is informational
    accounts: { account_id: string; name: string; start: number; end: number; change: number }[];
    trend: { year: number; month: number; saved: number; investment_growth: number; write_offs: number; other: number; change: number }[] };
  export function netWorthChange(userId: bigint, ym: YearMonth): Promise<NetWorthChange>;
  ```
- **Balances at a time:** an account's balance at time t is computed from its transactions dated < t, with the same arithmetic as balance recalculation. `INVAC` is skipped.
- **Invest value at a month end:**
  - the `invest_asset_evo_snapshot.current_value` for that month, else the latest earlier one;
  - for the current month, the asset's latest value.
- **Owed amounts:** from `peopleTotals(userId, t)`.
- **Parts:**
  - **saved:** counted income − counted spending, by calendar IST month (not effective month).
  - **investment growth:** Σ assets (end value − start value − (buys − sells in the month)), using `invest_transactions`.
  - **write-offs:** Σ adjustment rows in the month (I positive, E negative), excluding loan opening and manual-principal adjustments (those are debt bookkeeping, and land in other).
  - **other:** the change minus the three parts above.
- **debt paid down** = Σ over `CREAC` + `LOANAC` of (end balance − start balance).

- [ ] **Step 1: Failing tests.** One October scenario:
  - **Opening balances:** bank 1,00,000; card −10,000; loan −50,000 (loan opening adjustment dated September); asset value 40,000; lent outstanding 5,000.
  - **October transactions:**
    - salary I 50,000; spending E 20,000 from the bank;
    - card payment T bank→card 10,000;
    - an EMI matched as interest E 500 + principal T 4,500;
    - an invest buy (T bank→INVAC 10,000 plus a buy of 10,000);
    - October asset value 52,000;
    - a write-off adjustment E 300 on the bank;
    - a lent repayment of 2,000.
  - **Assertions:**
    - `parts.saved` = 29,500, `investment_growth` = 2,000, `write_offs` = −300, `other` = 0;
    - change = 31,200 = end − start;
    - `debt_paid_down` = 14,500;
    - the per-account list includes the bank and card changes;
    - the trend has 12 entries;
    - a new user gets zeros.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: net worth change, explained (#17)`.

### Task 4: #5 Retirement / FIRE calculator

**Files:**
- **Schema** (migration `add_retirement_settings`):
  - `user_financial_profile` gains:
    - `date_of_birth VarChar(10)?`;
    - `retirement_age Int @default(60)`;
    - `expected_return_pct Decimal(5,2) @default(10)`;
    - `inflation_pct Decimal(5,2) @default(6)`;
    - `swr_pct Decimal(5,2) @default(3.5)`;
    - `retirement_spending_basis VarChar(8) @default("all")` (`all`|`fixed`);
    - `family_support_monthly BigInt @default(0)`;
    - `family_support_years Int @default(0)`.
  - `accounts.is_retirement Boolean @default(false)` and `invest_assets.is_retirement Boolean @default(false)`.
- **Create:**
  - `myfin-api/src/services/wealth/retirementMath.ts` (pure);
  - `myfin-api/src/services/wealth/retirementService.ts`;
  - routes:
    - `GET /retirement`;
    - `POST /retirement/what-if {overrides}`, which doesn't persist;
    - `POST /retirement/save-what-if`, which persists the overrides into the profile.
- **Modify:**
  - profile service, controller and form ("Financial profile" section: these fields plus a corpus picker of accounts and invest assets);
  - earmark rules (`is_retirement` never on emergency, sinking, `INVAC`, `LOANAC` or `CREAC` accounts);
  - backup and restore.
- **Web:** a page `myfin-web/src/features/retirement/Retirement.tsx` at `/retirement`, in the sidebar. It has:
  - the corpus needed (future and today's rupees), the on-track age and the extra monthly needed;
  - a yearly projection line chart against the target line;
  - what-if sliders (return, inflation, SWR, retirement age, monthly investment), debounced into `what-if`, plus "Save as my settings";
  - links to settings when a date of birth is missing;
  - locale keys.
- **Test:** `__tests__/unit/retirementMath.test.ts` and `__tests__/integration/retirement.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export type RetirementInputs = { age: number; retirementAge: number; annualSpendingToday: number; returnPct: number; inflationPct: number; swrPct: number;
    familySupportMonthly: number; familySupportYears: number; currentCorpus: number; monthlyInvestment: number };
  export function corpusNeeded(i: RetirementInputs, atAge?: number): { future: number; today: number };
  //   n = atAge − age; S = annualSpendingToday × (1+inf)^n; base = S ÷ swr;
  //   family PV at retirement = A × (1 − ((1+g)/(1+r))^N) ÷ (r − g), A = 12 × familySupportMonthly × (1+inf)^n, g = inf, r = return; when r == g, A × N ÷ (1+r)
  //   today = future ÷ (1+inf)^n
  export function projection(i: RetirementInputs): { age: number; corpus: number; needed: number }[];   // yearly from age to 90: corpus_{t+1} = corpus_t × (1+r) + 12 × monthlyInvestment
  export function onTrackAge(i): number | null;                 // first age ≥ current where corpus ≥ needed(atAge), null if never by 90
  export function extraMonthlyNeeded(i): number;                // ≥ 0: monthly PMT closing the gap at retirementAge
  ```
- **Service inputs:**
  - age from the date of birth (IST today);
  - annual spending = typical (all → `spendingCents`; fixed → `fixedCents`) × 12;
  - current corpus = Σ ticked non-investing account balances (negatives as 0) + Σ ticked invest assets' latest value;
  - monthly investment = the #2 savings target (amount, or percent × typical income).
- **Response:** `GET` returns `{inputs, missing: string[], corpus_needed, on_track_age, extra_monthly_needed, projection}`. With `missing` non-empty, the figures are null.

- [ ] **Step 1: Failing tests.**
  - **Unit (exact to ₹1):** age 30, retire at 60, annual spending 6,00,000, return 10, inflation 6, SWR 3.5, no family support.
    - `corpusNeeded.today` = 600000 ÷ 0.035 = 17,142,857.14.
    - `future` = today × 1.06^30.
  - **Unit, family support:** ₹10,000 a month for 10 years, with r=g=6 % taking the limit branch. No NaN/∞ for any input with SWR > 0.
  - **Unit, projection:** with corpus 0 and investment 0, `onTrackAge` is null and `extraMonthlyNeeded` > 0. A large corpus gives an `onTrackAge` equal to the current age.
  - **Integration:**
    - no date of birth → `missing` contains `date_of_birth`;
    - `what-if` overrides don't change the profile;
    - `save-what-if` persists them;
    - corpus counts a ticked asset at value and ignores the `INVAC` balance;
    - `is_retirement` on an emergency account → 400;
    - a JSON backup round-trip keeps the fields.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: retirement and FIRE calculator (#5)`.

### Task 5: #7 Goal-linked investments

**Files:**
- **Schema** (migration `add_goal_has_asset`): `goal_has_asset`, with `goals_goal_id`, `invest_assets_asset_id`, `match_type VarChar(45)`, `match_value Decimal(16,6)`, PK on both ids, and FKs mirroring `goal_has_account`.
- **Modify:**
  - `goalService.ts`: add assets to create/update/list and progress, reusing its funding types (`MYFIN.GOALS.MATCH_TYPE`) and its "unallocated" logic;
  - the goals controller schemas;
  - backup and restore;
  - the wipe.
- **Web:**
  - the goal dialog gets an "Investments" section mirroring the accounts funding UI, showing each asset's unallocated share;
  - the goals list shows "₹X of ₹Y · on track / behind for <due date> at your current SIP";
  - locale keys.
- **Test** `myfin-api/__tests__/integration/goalAssets.integration.test.ts`.

**Interfaces:**
- **Consumes:** the latest asset value (Task 3's invest value helper) and `expected_return_pct` (Task 4).
- **Produces:** goal list items gain:
  ```ts
  { assets: { asset_id: string; match_type: string; match_value: number; funded: number }[]; asset_funding: number; monthly_sip: number; on_track: boolean | null }
  ```
- **Funding:** relative = value × pct ÷ 100; absolute = min(value, amount).
- **Allocation limits:** Σ relative across goals ≤ 100 per asset, and Σ absolute ≤ value → else 400.
- **SIP:** the average monthly buys of the asset over the last 6 full months × its share (relative pct, or absolute ÷ value).
- **On track:** project (account funding + asset funding) plus SIP monthly at `expected_return_pct`/12 to the due date, and compare it with the amount. Null without a due date.

- [ ] **Step 1: Failing tests.**
  - **Funding:** an asset worth 1,00,000 is linked 60 % to goal A and 40 % to goal B. Goal A gets 60,000 of asset funding.
  - **Over-allocation:** another 10 % → 400.
  - **Absolute:** an absolute 30,000 on a third goal after A and B → 400. With B removed, it succeeds.
  - **SIP:** buys of 5,000 a month for 6 months make A's SIP 3,000.
  - **On track:** a due date in 12 months and an amount of 1,00,000 → `on_track` true. An amount of 5,00,000 → false.
  - **Ownership:** another user's asset → 401.
  - **Backup:** a JSON round-trip keeps the links.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: goal-linked investments (#7)`.

### Task 6: #18 "If something happens to me" file

**Files:**
- **Schema** (migration `add_legacy_entries`): `legacy_entries`:
  - `entry_id` PK; `users_user_id` FK cascade;
  - `kind VarChar(12)` (`account`|`policy`|`contact`|`instruction`);
  - `account_id BigInt?` (FK SetNull); `data Json`; `sort_order Int @default(0)`;
  - `created_at BigInt`; `updated_at BigInt`.
- **Create** `myfin-api/src/services/legacyService.ts`, plus routes under `/legacy`:
  - `GET /` → `{entries, accounts (live, with balance), debts (live from #1), suggestions}`;
  - `POST /`, `PUT /:id`, `DELETE /:id`.
- **Data is joi-validated per kind:**
  - **account:** `bank_branch`, `nominee`, `documents_location`;
  - **policy:** `insurer`, `policy_number`, `sum_assured`, `nominee`, `claim_helpline`, `documents_location`;
  - **contact:** `role`, `name`, `phone`, `email`;
  - **instruction:** `text` (≤ 5,000 characters).
- **No secrets:**
  - Unknown keys → 400.
  - Any field name, or any value that matches `/password|passcode|\bpin\b|otp|cvv/i`, → 400 with the message "Don't store passwords, PINs or OTPs here".
- **Policy suggestions:** payee keys or category names of E rows in the last 13 months matching insurer words (INSURANCE, LIFE, HEALTH, LIC, STARHEALTH, POLICY), not already a policy entry.
- **Web:**
  - a "If something happens to me" section in the Settings page (user decision), with:
    - the account details prefilled from MyFin accounts;
    - policies with suggestions;
    - live loans and people;
    - contacts;
    - instructions.
  - A visible banner: "Never store passwords, PINs or OTPs".
  - A print view at `/settings/legacy/print`, with print CSS: each page shows "Generated on <date>" and "Regenerate after changes", and a "Save as PDF" button calls `window.print()`.
  - Locale keys.
- **Modify:** backup and restore (remap `account_id`), and the wipe.
- **Test** `myfin-api/__tests__/integration/legacy.integration.test.ts`.

**Interfaces:**
- **Consumes:** `debtService` (Tasks 1 and 2) and the accounts list.

- [ ] **Step 1: Failing tests.**
  - **CRUD:** works for all four kinds.
  - **No secrets:**
    - `{insurer:'X', password:'y'}` → 400 (unknown key);
    - a value "my PIN is 1234" → 400.
  - **Suggestions:** a STARHEALTH payment suggests a policy; after adding a policy with insurer STARHEALTH, it no longer does.
  - **Live data:** `GET` includes the open loans and lent entries from Tasks 1 and 2.
  - **Ownership:** another user's entry → 401.
  - **Backup:** a JSON round-trip keeps the entries with remapped account ids.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: "if something happens to me" file (#18)`.
