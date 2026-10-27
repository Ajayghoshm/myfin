# Phase B (Planning) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the money-planning features on top of Phase A:
- one shared "typical month" helper;
- planning settings and earmarked accounts;
- emergency fund meter (#3);
- yearly costs and a sinking fund (#13);
- safe-to-spend (#2);
- planned transactions and the salary-day plan (#15);
- next month's forecast turned into a budget (#19).

**Architecture:**
- **API:** every new figure reads "typical" from one helper, `typicalMonth`, which Insights also uses, so the numbers always agree.
- **Settings:** planning settings extend `user_financial_profile`. Accounts get `is_emergency_fund`. One earmark validator stops an account from having two roles.
- **New tables:** `yearly_costs`, `yearly_cost_dismissals`, `planned_transactions`, `salary_plans`, plus a nullable `transactions.yearly_cost_id`.
- **Planned rows** live only in `planned_transactions`. They are never in `transactions` until marked done or matched, so balances and every existing query are untouched.
- **#19** writes through the existing budget services.
- **Web:** cards on the Dashboard and Insights, a Yearly costs page, a salary-plan dialog and view, and a Planned chip on Transactions.

**Tech Stack:** myfin-api: Express 5, Prisma 7 (client at `src/generated/prisma`), MySQL 8.4, joi, vitest. myfin-web: React, MUI, react-query, i18next (en/pt/fr).

**Spec:** `docs/superpowers/specs/2026-10-27-shortlist-designs.md`. Sections #2, #3, #13, #15 and #19, and "Cross-cutting decisions" 1, 4, 5, 6, 7, 8 and 10, are binding.

## Global Constraints

- **Inherited from Phase A:**
  - IST months via `monthRangeIST`; effective month via `analyticsRules.ts`.
  - "Counts" = `countsForAnalyticsSql`.
  - Money is integer cents in the DB and decimal in API responses.
  - Every Insights-style figure equals the sum of its drill-down list.
- **Typical month** (one helper, `typicalMonth`):
  - **Baseline:** the 3 effective months before the given month. Only months that have data count towards the average. Zero baseline months → `null` figures, never NaN.
  - **Expense one-off:** the existing Insights rule (≥ ₹10,000, payee seen in fewer than 2 baseline months).
  - **Income one-off (new):** an `I` row ≥ 1.5 × the median of the baseline months' income totals is excluded.
  - **Yearly costs:** rows with `yearly_cost_id` set are excluded (from Task 4 on).
- **Earmarking:**
  - An account can be at most one of: emergency fund (`is_emergency_fund`), the sinking-fund account, the savings-target account.
  - None of these may be `INVAC`.
  - A violation → 400.
- **Set-asides this month** = max(0, target − sum of `T` transactions dated in the current IST calendar month into that role's account(s)). This applies to the savings target, the yearly set-aside and the emergency top-up.
- **Planned rows:**
  - They live only in `planned_transactions` and never touch balances, Insights, safe-to-spend, the emergency fund or budgets.
  - "Mark done" creates a real transaction through `TransactionService.createTransaction`.
  - A match never happens without the user confirming it.
- **Rounding:** forecast amounts are rounded to the nearest ₹100. Other figures are exact to the cent.
- **Backup/restore:** every new column and table is included with id remaps. Older backups restore with defaults.
  - Restore drops `salary_plans` / `planned_transactions` rows whose accounts are missing.
  - The restore joi schema (`restoreUserSchema`) accepts the new keys.
  - Tests use JSON round-tripped backups.
- **Tests and databases:**
  - Integration tests run only on the throwaway `mysql:8.4` at localhost:3308.
  - Every vitest command carries `DATABASE_URL="mysql://prisma:prisma@localhost:3308/myfin_tests"` inline on the same command line.
  - Never connect to 3306 or 3307.
  - `myfin-web` has no test runner; verify it with `tsc`, `build` and `myfin-web/node_modules/.bin/biome` (never `npx biome`).
- **Testable "now":** every service that depends on today takes an optional `now: number` (epoch seconds) parameter.
- **Locales:** en/pt/fr keys are inserted textually, and the JSON must stay valid.
- **Commits:** every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.env` files.

## Review Focus

1. **Salary credited on the 26th:** the salary plan is for the next month. A second salary-category income in that same effective month does not offer a second plan. *(Test in Task 7.)*
2. **Two roles for one account:** marking the sinking-fund account as an emergency fund, or picking an emergency account as the savings-target account, → 400. The web shows the error. *(Test in Task 2.)*
3. **Planned rows:** with planned rows present, balances, Insights, safe-to-spend and the emergency fund are byte-identical to the same data without them. *(Test in Task 6.)*
4. **Budget from a forecast when one exists:**
   - never overwritten silently;
   - "fill only empty" keeps non-zero planned amounts;
   - categories that have breakdown items are skipped and reported.

   *(Test in Task 8.)*
5. **A brand-new user with no history:** every new endpoint returns its empty state (`null` typical, explanatory status), never a 500 or NaN. *(Test in each task.)*

---

### Task 1: Shared typical-month helper

**Files:**
- **Create** `myfin-api/src/services/insights/typicalMonth.ts`.
- **Modify** `myfin-api/src/services/insights/insightsService.ts`: its typical, `typical_cost_split` and one-off figures come from the helper.
- **Test** `myfin-api/__tests__/integration/typicalMonth.integration.test.ts`. The existing `insights.integration.test.ts` and `fixedCosts.integration.test.ts` must still pass unchanged, except for income one-off cases that are new.

**Interfaces:**
- **Consumes:** `salaryRuleFor`, `effectiveMonthOf`, `countsForAnalyticsSql` and `monthRangeIST` (Phase A).
- **Produces:**
  ```ts
  export type TypicalMonth = {
    baselineMonths: number;                       // 0..3
    incomeCents: number | null; spendingCents: number | null;
    fixedCents: number | null; flexibleCents: number | null; unsortedCents: number | null;
    byCategory: Map<string, { kind: 'fixed' | 'flexible' | 'income'; avgCents: number; monthly: number[] }>; // key = category id string; monthly = per baseline month totals (length baselineMonths)
    oneOffIds: Set<string>;                       // excluded row ids (expense + income one-offs)
  };
  export function typicalMonth(userId: bigint, ym: YearMonth): Promise<TypicalMonth>;
  ```

- [ ] **Step 1: Failing tests.**
  - Baseline Aug–Oct with salary 100,000 each month and a bonus of 200,000 in September. Typical income for November is 100,000; the bonus is in `oneOffIds`.
  - Rent (fixed) 30,000 each month and Groceries 9,000 / 10,000 / 11,000. `fixedCents` = 3,000,000 and `byCategory` Groceries is `avgCents` 1,000,000 with `monthly` [900000, 1000000, 1100000].
  - With only 1 baseline month, the average is over 1 month.
  - A new user gets `baselineMonths` 0 and all figures null.
  - `getMonthInsights(Nov).typical.income` = 100,000, the same figure as the helper.
- [ ] **Step 2:** Run them. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the helper by moving the logic out of `getMonthInsights`. Insights then calls it.
- [ ] **Step 4:** Run the full integration and unit suites, plus api `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor: shared typical-month helper; income one-offs excluded from typical`.

### Task 2: Planning settings and earmarked accounts

**Files:**
- **Schema** (migration `add_planning_settings`):
  - `user_financial_profile` gains:
    - `savings_target_mode String @db.VarChar(8) @default("amount")` (`amount`|`percent`);
    - `savings_target_value BigInt @default(0)`: cents in amount mode, whole percent 0–100 in percent mode;
    - `savings_target_account_id BigInt?`;
    - `sinking_fund_account_id BigInt?`;
    - `emergency_fund_target_months Int @default(6)` (1–24);
    - `emergency_topup_percent Int @default(10)` (0–100).
  - `accounts.is_emergency_fund Boolean @default(false)`.
- **Create** `myfin-api/src/services/earmarkService.ts`.
- **Modify:** `financialProfileService.ts` and its controller, `accountService.ts` and the account controller (create/update accept `is_emergency_fund` / `new_is_emergency_fund`), and `backupManager.ts` (remap the account ids; `?? default` for old backups).
- **Web:**
  - `FinancialProfileForm.tsx` gains:
    - a savings target with an amount/percent toggle and an account picker;
    - a sinking-fund account picker;
    - the emergency target in months;
    - the top-up %.

    Account pickers exclude `INVAC`.
  - The account dialog gets an "Emergency fund" switch, hidden for `INVAC`.
  - Locale keys.
- **Test** `myfin-api/__tests__/integration/earmark.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export type AccountRole = 'emergency' | 'sinking' | 'savings_target';
  export function assertEarmarkAllowed(userId: bigint, accountId: bigint, role: AccountRole, dbClient?): Promise<void>; // throws APIError 400
  export function emergencyAccountIds(userId: bigint): Promise<bigint[]>;  // active, is_emergency_fund
  ```
  `FinancialProfile` gains the six fields above. The API reports `savings_target_value` as currency in amount mode and as a percent number in percent mode.

- [ ] **Step 1: Failing tests.** Each of these gives 400:
  - setting the sinking account to an emergency account;
  - setting the savings-target account equal to the sinking account;
  - ticking `is_emergency_fund` on the sinking account;
  - ticking it on an `INVAC`;
  - another user's account, as the sinking or savings-target account.

  Valid settings round-trip. A JSON round-tripped backup restores the six fields and `is_emergency_fund` with remapped account ids. A pre-Phase-B backup restores the defaults.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: planning settings and earmarked accounts`.

### Task 3: #3 Emergency fund meter

**Files:**
- **Create** `myfin-api/src/services/planning/emergencyFundService.ts`, plus the route `GET /insights/emergency-fund`.
- **Web:** `EmergencyFundCard.tsx` on the Dashboard and Insights, with locale keys.
- **Test** `myfin-api/__tests__/integration/emergencyFund.integration.test.ts`.

**Interfaces:**
- **Consumes:** `typicalMonth`, `emergencyAccountIds` and the profile.
- **Produces:**
  ```ts
  export type EmergencyFund = {
    fund: number; monthly_fixed: number | null; months_covered: number | null; target_months: number;
    more_needed: number; status: 'red' | 'amber' | 'green' | 'no_accounts' | 'no_fixed';
    accounts: { account_id: string; name: string; balance: number }[];
  };
  export function emergencyFund(userId: bigint, now?: number): Promise<EmergencyFund>;
  export function emergencyTopupGapCents(userId: bigint, now?: number): Promise<number>; // max(0, target*monthly_fixed - fund), 0 when status is no_accounts/no_fixed
  ```
  - `months_covered` is rounded to 1 decimal.
  - The status is red below 3, amber from 3 up to the target, and green at or above the target.
  - Negative balances count as 0, and only active accounts count.

- [ ] **Step 1: Failing tests.** Typical fixed is 10,000 a month (rent, as in Task 1 but with 10,000). Ticked accounts are A 30,000, B 20,000 and C −5,000.
  - **Fund and meter:** fund 50,000, `months_covered` 5.0, amber, `more_needed` 10,000 against a target of 6.
  - **Green:** a target of 4 gives green.
  - **No accounts:** no ticked accounts gives `no_accounts`.
  - **No fixed:** no fixed categories gives `no_fixed` with `months_covered` null.
  - **Inactive:** an inactive ticked account isn't counted.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web: the meter (a LinearProgress against the target), the text "N months covered · ₹X more to reach T months", and empty-state messages. `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: emergency fund meter (#3)`.

### Task 4: #13 Yearly costs and sinking fund

**Files:**
- **Schema** (migration `add_yearly_costs`):
  - `yearly_costs`: `yearly_cost_id` PK, `users_user_id` FK cascade, `name VarChar(255)`, `amount BigInt` (cents), `due_month Int` (1–12), `category_id BigInt?`, `active Boolean @default(true)`, `created_at BigInt`.
  - `yearly_cost_dismissals`: `users_user_id`, `payee_key VarChar(255)`, PK on both, FK cascade.
  - `transactions.yearly_cost_id BigInt?`, FK to yearly_costs with `onDelete: SetNull`.
- **Create** `myfin-api/src/services/planning/yearlyCostService.ts`, plus a controller and routes under `/yearly-costs`:
  - `GET /` → `{ costs, status }`;
  - `POST /`, `PUT /:id`, `DELETE /:id`;
  - `GET /suggestions`;
  - `POST /suggestions/dismiss {payee_key}`;
  - `POST /link {transaction_id, yearly_cost_id|null}`;
  - `GET /:id/candidates`: unlinked `E` rows from the last 13 months with the same category as the cost, or a payee key equal to that of a row already linked to it.
- **Modify:**
  - `typicalMonth`: exclude rows with `yearly_cost_id`.
  - `TransactionFilter` gains `yearlyCost?: 'linked' | 'unlinked'`, with HTTP param `yearly_cost` on list and bulk.
  - The list response rows gain `yearly_cost_id`.
  - `backupManager`: restore yearly costs and dismissals, and remap `transactions.yearly_cost_id`.
- **Web:**
  - a new page `myfin-web/src/features/yearlyCosts/YearlyCosts.tsx` at `/yearly-costs`, linked from the sidebar under Insights. It has:
    - a list with add/edit/delete;
    - suggestions with Accept (prefills the add dialog) or Ignore;
    - a candidates dialog per cost to link transactions;
    - a status panel.
  - A "Yearly cost" chip on linked Transactions rows.
  - Locale keys.
- **Test** `myfin-api/__tests__/integration/yearlyCosts.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export type SinkingStatus = {
    account: { account_id: string; name: string; balance: number } | null;
    monthly_total: number; should_have: number; behind_by: number; catch_up_this_month: number;
    on_track: boolean; upcoming: { yearly_cost_id: string; name: string; amount: number; due_month: number }[];
  };
  export function sinkingStatus(userId: bigint, now?: number): Promise<SinkingStatus>;
  export function yearlySetasideMonthlyCents(userId: bigint): Promise<number>; // Σ active amount/12, rounded to cents
  ```
  - `months_since(cost) = (currentMonth − due_month + 12) % 12` (IST).
  - `should_have = Σ amount × months_since / 12`.
  - `behind_by = max(0, should_have − balance)`.
  - `catch_up_this_month = behind_by + monthly_total`.
  - `upcoming` = costs due in the current or the next 2 months.
  - `account` is null when no sinking account is set, and then `on_track` is false.
- **Suggestions:**
  - An `E` row in the last 13 months, ≥ ₹5,000.
  - Its payee key has no other `E` row in the 10 months before it.
  - It isn't linked, and its payee key isn't dismissed.
  - Output: `{payee_key, description, amount, date, category_id, suggested_due_month}`.

- [ ] **Step 1: Failing tests.** "Now" is 2026-11-20 IST. Costs: Insurance 24,000 due March and Course 12,000 due November. The sinking account has a balance of 10,000.
  - **Status:** `monthly_total` 3,000; `should_have` 16,000; `behind_by` 6,000; `catch_up_this_month` 9,000; `on_track` false; `upcoming` contains Course.
  - **Linking:** linking a 24,000 transaction in September takes it out of `typicalMonth(Nov).spendingCents`. The list with `yearly_cost: 'linked'` returns exactly that row.
  - **Suggestions:**
    - A one-time 18,000 payee becomes a suggestion; after dismissing, it doesn't.
    - A monthly 6,000 payee is never suggested.
  - **Delete:** deleting a cost unlinks its transactions (`yearly_cost_id` becomes null).
  - **Ownership:** another user's cost gives 401.
  - **Backup:** a JSON round-trip keeps the costs, links and dismissals.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: yearly costs and sinking fund (#13)`.

### Task 5: #2 Safe-to-spend

**Files:**
- **Create** `myfin-api/src/services/planning/safeToSpendService.ts`, plus the route `GET /insights/safe-to-spend`.
- **Web:**
  - `SafeToSpendCard.tsx` on the Dashboard and Insights. It shows "Safe to spend: ₹X for the rest of <month> · ₹Y/day for N days", turns red with "₹Z over" when negative, and opens a breakdown dialog.
  - The breakdown's "spent so far" links to `month=<cur>&type=E&yearly_cost=unlinked`.
  - Locale keys.
- **Test** `myfin-api/__tests__/integration/safeToSpend.integration.test.ts`.

**Interfaces:**
- **Consumes:** `typicalMonth`, `yearlySetasideMonthlyCents`, `emergencyTopupGapCents`, `emergencyAccountIds` and the profile.
- **Produces:**
  ```ts
  export type SafeToSpend = {
    month: string; days_left: number; per_day: number; safe_to_spend: number;
    expected_income: number; income_so_far: number; typical_income: number | null; spent_so_far: number;
    fixed_still_to_come: number; fixed_lines: { category_id: string; name: string; typical: number; spent: number; remaining: number }[];
    savings_target: number; yearly_setaside: number; emergency_topup: number; has_fixed_categories: boolean;
  };
  export function safeToSpend(userId: bigint, now?: number): Promise<SafeToSpend>;
  ```
  - **Month:** the effective month containing `now`.
  - **Income and spending:** `expected_income` = max(`income_so_far`, `typical_income ?? 0`). `spent_so_far` = current-month counted `E` rows not linked to a yearly cost.
  - **Savings target:** the target amount, or that percent of `expected_income`, minus `T` this month into the savings account. With no account set, the full target applies.
  - **Yearly set-aside:** the monthly total minus `T` this month into the sinking account.
  - **Emergency top-up:** min(gap, `emergency_topup_percent`% × `expected_income`) minus `T` this month into emergency accounts. It is 0 when the gap is 0.
  - **Days left:** IST days from today to month end, inclusive.

- [ ] **Step 1: Failing tests.**
  - **Setup:** "now" is 2026-11-20 10:00 IST. The Aug–Oct baseline has salary 100,000, Rent (fixed) 30,000 and Groceries 10,000 each month. November so far: salary 100,000 and groceries 6,000. The savings target is 20 % into account S, with a 5,000 transfer into S on Nov 3. One yearly cost of 12,000. No emergency accounts.
  - **Result:** `days_left` 11; `fixed_still_to_come` 30,000; `savings_target` 15,000; `yearly_setaside` 1,000; `emergency_topup` 0; `safe_to_spend` 48,000; `per_day` 4,363.64.
  - **After rent:** after paying rent of 31,000, `fixed_still_to_come` is 0, `spent_so_far` 37,000 and `safe_to_spend` 47,000.
  - **Emergency top-up:** adding an emergency account at 0 with typical fixed 30,000 and a target of 6 gives a top-up of min(180,000, 10 % × 100,000) = 10,000.
  - **New user:** the response has `typical_income` null and `has_fixed_categories` false, with no NaN.
  - **Drill-down:** the `spent_so_far` drill-down sum equals the figure.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: safe-to-spend forecast (#2)`.

### Task 6: #15a Planned transactions

**Files:**
- **Schema** (migration `add_planned_transactions`): `planned_transactions`:
  - `planned_id` PK; `users_user_id` FK cascade;
  - `date_timestamp BigInt`; `amount BigInt` (cents); `type String @db.Char(1)` (`T`|`E`|`I`);
  - `accounts_account_from_id BigInt?`; `accounts_account_to_id BigInt?` (both FK cascade);
  - `categories_category_id BigInt?`; `description String @db.VarChar(255)`;
  - `salary_plan_id BigInt?`; `bucket String? @db.VarChar(16)`; `created_at BigInt`.
- **Create** `myfin-api/src/services/planning/plannedTransactionService.ts`, plus a controller and routes under `/planned-transactions`:
  - `GET /`;
  - `POST /:id/done`;
  - `POST /:id/skip`;
  - `GET /matches?transaction_ids=1,2`;
  - `POST /:id/match {transaction_id}`.
- **Web:**
  - a "Planned" filter chip on Transactions that switches the grid to planned rows: greyed out, with a "Planned" chip and the actions Mark done / Skip / Match…;
  - after a manual add and after a PhonePe import, call `matches` for the new transaction ids and offer a confirm dialog per match;
  - locale keys.
- **Modify:**
  - `createTransaction` and `createTransactionsInBulk` callers must be able to get the new ids. Return them if they don't already.
  - `backupManager`: restore planned rows with remapped account, category and plan ids.
- **Test** `myfin-api/__tests__/integration/plannedTransactions.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export function createPlanned(userId: bigint, rows: PlannedInput[], prismaTx): Promise<bigint[]>; // used by Task 7
  export function listPlanned(userId: bigint): Promise<PlannedRow[]>;
  export function markDone(userId: bigint, plannedId: bigint): Promise<bigint>;            // new transaction id
  export function skip(userId: bigint, plannedId: bigint): Promise<void>;
  export function findMatches(userId: bigint, transactionIds: bigint[]): Promise<{ transaction_id: string; planned: PlannedRow }[]>;
  export function confirmMatch(userId: bigint, plannedId: bigint, transactionId: bigint): Promise<void>;
  export const onPlannedResolved: (plannedId: bigint, outcome: 'done' | 'skipped', transactionId: bigint | null, prismaTx) => Promise<void>; // hook Task 7 fills; no-op until then
  ```
  - **A match** has the same type, the same from and to accounts, an amount within ±100 cents, and a date within 7 days.
  - **Done / skip / match** delete the planned row inside the same DB transaction that calls `onPlannedResolved`.

- [ ] **Step 1: Failing tests.**
  - **Isolation:** with two planned transfers of 15,000 present, account balances, `getMonthInsights`, `safeToSpend` and `emergencyFund` all deep-equal the results without them.
  - **Mark done:** creates a real `T` row, updates balances and removes the planned row.
  - **Skip:** removes it, with no transaction created.
  - **Matching:** a real transfer of 15,050 three days later matches; one of 15,200 or ten days later doesn't. `confirmMatch` keeps the real row and removes the planned one. A `findMatches` call never changes data.
  - **Ownership:** another user's planned id gives 401.
  - **Backup:** a JSON round-trip restores the planned rows.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: planned transactions with done, skip and match (#15)`.

### Task 7: #15b Salary-day plan

**Files:**
- **Schema** (migration `add_salary_plans`): `salary_plans`:
  - `salary_plan_id` PK; `users_user_id` FK cascade; `month Int` (YYYYMM, effective month);
  - `salary_transaction_id BigInt?` (FK `onDelete: SetNull`); `salary_amount BigInt`;
  - `buckets Json`; `created_at BigInt`;
  - `@@unique([users_user_id, month])`.
- **Create** `myfin-api/src/services/planning/salaryPlanService.ts`, plus routes:
  - `GET /salary-plan/current`;
  - `POST /salary-plan`;
  - `GET /salary-plan/:month`.

  It fills the `onPlannedResolved` hook to update the bucket state.
- **Web:**
  - `SalaryPlanCard.tsx` on the Dashboard ("Plan this salary"). It opens a dialog with an editable amount per bucket, account pickers for the transfer buckets, and a live "Free to spend".
  - A plan view page at `/salary-plan/:month` with bucket states, "2 of 3 transfers done", and an overdue flag on planned rows more than 15 days past their date.
  - Locale keys.
- **Test** `myfin-api/__tests__/integration/salaryPlan.integration.test.ts`.

**Interfaces:**
- **Consumes:**
  - the profile (salary category, accounts, %s);
  - `typicalMonth` for fixed costs;
  - `yearlySetasideMonthlyCents`;
  - `emergencyTopupGapCents`;
  - `createPlanned`;
  - `effectiveMonthOf`.
- **Produces:**
  ```ts
  type Bucket = { bucket: 'fixed' | 'yearly' | 'emergency' | 'savings' | 'free'; amount: number; account_to_id: string | null;
                  planned_id: string | null; state: 'none' | 'planned' | 'done' | 'skipped'; transaction_id: string | null; overdue: boolean };
  export function currentSalaryPlan(userId: bigint, now?: number): Promise<{ state: 'none' | 'proposal' | 'confirmed'; month: string | null; salary: { transaction_id: string; amount: number; date: number } | null; buckets: Bucket[] }>;
  export function confirmSalaryPlan(userId: bigint, input: { month: string; salary_transaction_id: bigint; buckets: { bucket: Bucket['bucket']; amount: number; account_to_id: bigint | null }[] }): Promise<bigint>;
  ```
- **Trigger:** the earliest salary-category income in the last 40 days whose effective month M has no plan. Bonuses are irrelevant, because only one plan is allowed per M.
- **Proposal:**
  - fixed = typical fixed, with no transfer;
  - yearly = the monthly set-aside, to the sinking account;
  - emergency = min(gap, `emergency_topup_percent`% × salary), 0 when not below target, to the first emergency account;
  - savings = the savings target (amount, or % × salary), to the savings-target account;
  - free = salary − the others.
- **Confirm:**
  - creates planned `T` rows for the yearly, emergency and savings buckets with amount > 0 and an account, from the salary's account and dated on the salary date;
  - a bucket without an account gets the state `none`.
- **Free to spend:** ruling for this plan: free = salary − the other buckets. It equals #2 when no spending has happened yet in M and the salary ≥ typical income. Note this in the UI copy as "based on this salary".

- [ ] **Step 1: Failing tests.**
  - **Proposal:** a salary of 100,000 on 2026-10-26 with a cut-off of 25 gives a proposal for 2026-11. It has fixed 30,000, yearly 1,000, emergency 10,000 (gap large, 10 %), savings 20,000 at 20 %, and free 39,000.
  - **No second plan:** a second salary-category income on Nov 5 still has `state` `confirmed` after a confirm. No new proposal.
  - **Confirm:** creates three planned rows, and the plan reads `planned` ×3.
  - **Bucket states:** `markDone` on one makes it `done`, `skip` on another makes it `skipped`, and the view shows 1 of 3 done.
  - **Overdue:** a planned row dated 16 days before "now" has `overdue: true`.
  - **Duplicate:** confirming twice for one month gives 409.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: salary-day plan (#15)`.

### Task 8: #19 Next month's forecast → budget

**Files:**
- **Create** `myfin-api/src/services/planning/forecastService.ts`, plus routes:
  - `GET /insights/forecast?month=YYYY-MM`;
  - `GET /insights/forecast/budget-compare?month=YYYY-MM`;
  - `POST /insights/forecast/budget {month, mode: 'create'|'replace'|'fill_empty'}`.
- **Web:**
  - `ForecastCard.tsx` on Insights:
    - a month picker that defaults to next month in the last 7 days of a month, otherwise the next month too, with any upcoming month selectable;
    - per-category lines, a separate "Not yet sorted" line, and the total with its range;
    - "Create <Month> budget from this forecast". When a budget exists, it opens a compare dialog with Replace all / Fill only empty / Cancel. Afterwards it navigates to the budget page.
  - Locale keys.
- **Test** `myfin-api/__tests__/integration/forecast.integration.test.ts`.

**Interfaces:**
- **Consumes:** `typicalMonth`; yearly costs; `BudgetService.createBudget`; `BudgetService.updateBudgetCategoryPlannedValues`.
- **Produces:**
  ```ts
  export type Forecast = { month: string; income: number; total: number; low: number; high: number; unsorted: number;
    categories: { category_id: string; name: string; kind: 'fixed' | 'flexible' | 'income'; amount: number; yearly_costs: number; seasonal_factor: number | null }[] };
  export function forecast(userId: bigint, month: YearMonth, now?: number): Promise<Forecast>;
  export function forecastToBudget(userId: bigint, month: YearMonth, mode: 'create' | 'replace' | 'fill_empty', now?: number): Promise<{ budget_id: string; skipped_category_ids: string[] }>;
  ```
- **Baseline:** `typicalMonth(current month)`, which is the 3 months before the current month.
- **Seasonal factor:** for a flexible category, when last year has data for T−12 and for the 3 months before it, the factor is (T−12 total ÷ that 3-month average), clamped to [0.5, 1.5].
- **Lines and totals:** yearly costs due in T are added to their category, or to a "Yearly costs" line when they have none. Each line is rounded to ₹100, and the total is the sum of the lines (excluding unsorted).
- **Range:** ±√Σ sd² over the categories' population standard deviations, rounded to ₹100.
- **Income:** income lines are the typical per income category. They go to the budget as planned credit; expense lines go as planned debit.
- **Budget modes:**
  - **create:** when a budget exists → 409.
  - **replace:** overwrite every forecast category.
  - **fill_empty:** only categories whose current planned debit and credit are both 0.
  - **Breakdown items:** categories with `budget_category_items` are never touched in either mode. They are returned in `skipped_category_ids`.

- [ ] **Step 1: Failing tests.**
  - **Setup:** "now" is 2026-11-26 and the target is 2026-12. The Aug–Oct 2026 baseline has Rent (fixed) 30,000 and Groceries 9,000 / 10,000 / 11,000. Last year: groceries Dec 2025 15,000, with Sep–Nov 2025 averaging 10,000. Course 12,000 is due in December in category Education. Unsorted averages 300. Typical salary is 100,000.
  - **Forecast:** Rent 30,000; Groceries 15,000 (factor 1.5); Education 12,000; total 57,000; low 56,200; high 57,800; unsorted 300; income 100,000.
  - **Clamp:** a factor of 2.0 is clamped to 1.5.
  - **No last-year data:** no factor, and `seasonal_factor` is null.
  - **Create:** makes a Dec 2026 budget with exactly those planned values, Salary credit 100,000.
  - **Fill empty:** after Groceries is set to 9,000 by hand, `fill_empty` keeps 9,000; `replace` sets 15,000.
  - **Breakdown items:** a category with breakdown items is unchanged and is listed as skipped.
  - **Existing budget:** `create` gives 409.
  - **New user:** zeros and an empty `categories`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: next month's forecast to budget (#19)`.
