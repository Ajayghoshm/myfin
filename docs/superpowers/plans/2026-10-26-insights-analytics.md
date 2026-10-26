# Insights (Analytics) Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monthly Insights page that shows where the money went (by category, merchant and person), how the month compares with a typical month, and a 12-month trend. Every figure drills down to the exact transactions behind it.

**Architecture:**
- **API:** one aggregation endpoint computes everything for a month with SQL, using IST epoch ranges and a shared SQL payee-key expression. A small table stores the user's person/merchant corrections.
- **Transactions list:** gains structured filters (date range, category, payee key, account) that share their predicates with the aggregation queries, so a drill-down always sums to the figure that was clicked.
- **Web:** a new Insights page built with `@nivo` charts, plus URL-driven filters with removable chips on the Transactions page.

**Tech Stack:** myfin-api: Express 5, Prisma 7 (client from `src/generated/prisma`), MySQL 8.4, joi, dayjs, vitest. myfin-web: React, MUI, react-query, i18next (en/pt/fr), `@nivo/bar` / `@nivo/line` / `@nivo/pie`.

**Spec:** `docs/superpowers/specs/2026-10-26-insights-analytics-design.md`. Its "Decisions" section overrides earlier wording.

## Global Constraints

- **Month boundaries:** months are Asia/Kolkata (fixed UTC+05:30, no DST) epoch-second ranges `[from, to)`, computed in code. Never group by `FROM_UNIXTIME` / MySQL session time zone.
- **Transaction types:**
  - Income = type `I`; spending = type `E`.
  - Type `T` is excluded from every insight figure, including the payment mix.
  - Expense source account = `accounts_account_from_id`; income account = `accounts_account_to_id`.
- **Money:** `transactions.amount` is integer cents. API responses carry decimal currency numbers (`amount / 100`).
- **Payee key:**
  - **Expression (SQL only):** upper-case, trim, collapse whitespace, then strip one leading `PAID TO ` / `RECEIVED FROM ` / `REQUESTED BY ` / `PAYMENT TO `. Built from `transactions.description` only; the entity is never used.
  - **Empty key:** shown as "Unknown payee". Counted in totals and categories, but never listed under merchants or people.
- **Person guess:**
  - **Business words:** if the key contains any business word, it's a merchant. Otherwise it's a person when it has ever (all history) had a description starting `Requested by ` / `Received from `, or ever had an `E` payment ≥ ₹1,000 that is a multiple of ₹100.
  - **User corrections:** a correction always beats the guess. `kind: null` deletes a correction.
- **Typical month:**
  - **Baseline:** the per-metric average over the 3 complete months before the selected month, using fewer when fewer have data. With none, `typical = null`.
  - **One-off:** a single `E` transaction ≥ ₹10,000 with a non-empty key that does not appear in ≥ 2 of the 3 baseline months.
  - **Where one-offs apply:** excluded from the baseline only; the selected month stays raw.
- **Biggest changes:** up to 5 categories or merchants, ranked by absolute rupee change against their baseline average. Baseline months with no spend count as 0, and one-offs are excluded. `change_pct = null` when the baseline is 0 (the UI shows "new").
- **Savings rate:** `(income − spending) / income`, or `null` when income is 0. Cards show "—"; the trend chart leaves a gap.
- **Filters:**
  - New list filters AND-combine with search and type.
  - `date_from` is inclusive and `date_to` exclusive, both epoch seconds.
  - `category_id` is a positive id or `none` (uncategorised).
  - `account_id` matches either side of a transaction.
  - The bulk-update `filter` accepts the same optional fields; `query` stays optional, defaulting to `''`.
- **Web URL params** on `/transactions` are the source of truth: `month=YYYY-MM`, `type=E|I|T`, `category=<id|none>`, `payee=<key>`, `account=<id>`. Each shows as a removable chip.
- **Tests and databases:** tests never touch localhost:3306 or localhost:3307. Integration tests run against a throwaway `mysql:8.4` container (e.g. port 3308), with `DATABASE_URL=mysql://prisma:prisma@localhost:3308/myfin_tests` exported.
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.env` files.

## Review Focus

1. **A month with no transactions** (or a brand-new user): the page renders zeros and empty states, `typical` is `null`, and nothing crashes. *(Test in Task 3.)*
2. **Payee spelling variants** ("Paid to VEG BASKET ", "Paid to Veg  Basket"): these group into one merchant, and its drill-down returns all of them. *(Test in Task 3.)*
3. **A payment at 00:30 IST on the 1st** counts in the new month, both in the aggregate and in the drill-down. *(Tests in Tasks 1 and 3.)*
4. **Rows with an empty description:** they appear in the totals and categories, but never as a merchant or person row. *(Test in Task 3.)*
5. **An `account_id` filter naming another user's account:** returns no rows and no totals, without leaking data. *(Test in Task 2.)*

---

### Task 1: IST month ranges, payee-key SQL, and the person guess

**Files:**
- Create: `myfin-api/src/services/insights/insightsPrimitives.ts`
- Test: `myfin-api/__tests__/unit/insightsPrimitives.test.ts`

**Interfaces:**
- **Produces:**
  ```ts
  export type YearMonth = { year: number; month: number }; // month 1-12
  export function monthRangeIST(ym: YearMonth): { from: number; to: number }; // epoch seconds, [from, to)
  export function shiftMonth(ym: YearMonth, delta: number): YearMonth;
  export const payeeKeySql: Prisma.Sql; // SQL expression over transactions.description, see Global Constraints
  export const PERSON_PREFIX_SQL: Prisma.Sql; // boolean SQL: description starts with 'Requested by ' or 'Received from ' (case-insensitive)
  export const BUSINESS_WORDS: readonly string[];
  export function guessIsPerson(payeeKey: string, signals: { hasPersonPrefix: boolean; hasRoundPaymentOver1000: boolean }): boolean;
  ```
- `Prisma` is imported from `../../generated/prisma/client.js`, as `transactionService.ts` does.

- [ ] **Step 1: Write failing unit tests:**
  - `monthRangeIST({year:2026, month:10})` returns `from === Date.UTC(2026,9,1)/1000 - 19800` and `to === Date.UTC(2026,10,1)/1000 - 19800`.
  - An epoch for 2026-11-01 00:30 IST is `>= monthRangeIST({2026,11}).from`.
  - `shiftMonth({2026,1}, -1)` deep-equals `{2025,12}`; `shiftMonth({2026,10}, -12)` deep-equals `{2025,10}`.
  - `guessIsPerson('ACHAN', {hasPersonPrefix:false, hasRoundPaymentOver1000:true})` is `true`.
  - `guessIsPerson('SWIGGY', {true, true})` is `false`.
  - `guessIsPerson('MEMORIES HOSPITALITY SERVICES', {false, true})` is `false`.
  - `guessIsPerson('ABDESH KUMAR', {false, false})` is `false`.
  - `guessIsPerson('UTTHARA M', {true, false})` is `true`.
  - `guessIsPerson('', {true, true})` is `false`.
  - `BUSINESS_WORDS` includes `'PVT'`, `'LTD'`, `'CAFE'`, `'SWIGGY'`, `'ZOMATO'`, `'NETFLIX'`. Matching is on whole words of the key.
- [ ] **Step 2:** `cd myfin-api && npm run test:unit:run -- insightsPrimitives`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** `payeeKeySql` uses `REGEXP_REPLACE(UPPER(TRIM(REGEXP_REPLACE(COALESCE(transactions.description,''), '[[:space:]]+', ' '))), '^(PAID TO|RECEIVED FROM|REQUESTED BY|PAYMENT TO) ', '')`. `BUSINESS_WORDS` follows the spec's list, extended at your discretion.
- [ ] **Step 4:** Run again. Expected: PASS. The SQL fragments are exercised in Tasks 2 and 3.
- [ ] **Step 5: Commit:** `feat(api): insights primitives — IST months, payee key, person guess`.

### Task 2: Structured transaction filters (list, count, bulk update)

**Files:**
- Modify: `myfin-api/src/services/transactionService.ts`:
  - `TransactionListOptions` (~105);
  - `filteredTransactionsFrom` (~115);
  - `getFilteredTransactionsByForUser`;
  - `BulkUpdateSelection` / `bulkUpdateTransactions` (~918).
- Modify: `myfin-api/src/controllers/transactionController.ts`: the `getFilteredTrxByPageSchema` and `bulkUpdateTransactionsSchema` `filter` objects.
- Test: `myfin-api/__tests__/integration/transactionFilters.integration.test.ts`

**Interfaces:**
- **Consumes:** `payeeKeySql` (Task 1).
- **Produces:**
  ```ts
  export type TransactionFilter = {
    query?: string; type?: string | null;
    dateFrom?: number; dateTo?: number;
    categoryId?: bigint | 'none'; payeeKey?: string; accountId?: bigint;
  };
  export function structuredFilterSql(filter: TransactionFilter): Prisma.Sql; // "AND …" predicates except search/ownership; no joins needed beyond `transactions`
  // filteredTransactionsFrom(userId, filter: TransactionFilter) — signature changes from (userId, searchQuery, typeFilter)
  // TransactionListOptions gains the TransactionFilter fields (sortBy/sortDir stay)
  // BulkUpdateSelection filter variant becomes { filter: TransactionFilter }
  ```
- **HTTP:** `GET /trxs/filteredByPage/:page` and the `filter` of `PUT /trxs/bulk` accept `date_from`, `date_to` (integers), `category_id` (positive integer or `'none'`), `payee_key` (string ≤ 255), `account_id` (positive integer). All optional.

- [ ] **Step 1: Write failing integration tests.** Seed one user with accounts bank and card, a category Food, and these expenses (amounts in ₹):
  - "Paid to SWIGGY" 121, Food, 2026-10-05;
  - "Paid to Swiggy  " 200, no category, 2026-10-20;
  - "Paid to VEG BASKET" 28, no category, 2026-09-30 23:50 IST;
  - "Paid to VEG BASKET" 30, card, 2026-11-01 00:30 IST.

  Plus a second user with an account. Then assert:
  - `payeeKey:'SWIGGY'` returns both Swiggy rows;
  - `categoryId:'none'` with October's range returns only the 200 row;
  - `dateFrom/dateTo = monthRangeIST(2026-10)` excludes both VEG BASKET rows;
  - `monthRangeIST(2026-11)` includes the 00:30 row;
  - `accountId: card` returns only the 00:30 row;
  - `accountId` = the other user's account returns 0 rows and a filtered count of 0;
  - `bulkUpdateTransactions` with `{filter:{payeeKey:'SWIGGY'}}` updates exactly 2;
  - existing callers with only `query`/`type` behave as before (the existing sort and bulk tests keep passing).
- [ ] **Step 2:** Start the throwaway DB, `npx prisma migrate deploy`, run `npx vitest --run --config vitest.config.integration.ts __tests__/integration/transactionFilters.integration.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `filteredTransactionsFrom` keeps its joins and search, and appends `structuredFilterSql(filter)`. `structuredFilterSql` references only `transactions.*` columns plus `payeeKeySql`. `categoryId:'none'` maps to `categories_category_id IS NULL`. `accountId` maps to `(accounts_account_from_id = ? OR accounts_account_to_id = ?)`. Update both controller schemas and map snake_case to `TransactionFilter` (bigint conversion, `'none'` passthrough).
- [ ] **Step 4:** Run the new file, then the whole integration suite. Expected: all PASS.
- [ ] **Step 5: Commit:** `feat(api): date, category, payee and account filters for transactions`.

### Task 3: Insights endpoint and payee classifications

**Files:**
- Modify: `myfin-api/prisma/schema.prisma`: add `payee_classifications` (`classification_id` BigInt PK autoincrement, `users_user_id` BigInt FK to users with cascade delete, `payee_key` VarChar(255), `kind` VarChar(16), `@@unique([users_user_id, payee_key])`), and the back-relation on `users`.
- Create: migration via `npx prisma migrate dev --name add_payee_classifications`, against the throwaway DB as root.
- Modify: `myfin-api/__tests__/integration/utils/resetDb.ts`: delete `payee_classifications` before `users`.
- Modify: `myfin-api/src/services/userService.ts`: the user-data wipe deletes the user's classifications.
- Create: `myfin-api/src/services/insights/insightsService.ts`.
- Create: `myfin-api/src/controllers/insightsController.ts`.
- Modify: `myfin-api/src/routes/routeDefinitions.ts`: new group `{ tag:'Insights', basePath:'/insights', routes: [ {get '/month' → getMonthInsights}, {put '/payee-classification' → setPayeeClassification} ] }`.
- Test: `myfin-api/__tests__/integration/insights.integration.test.ts`

**Interfaces:**
- **Consumes:** Task 1 (`monthRangeIST`, `shiftMonth`, `payeeKeySql`, `PERSON_PREFIX_SQL`, `guessIsPerson`) and Task 2 (`structuredFilterSql`, `TransactionFilter`).
- **Produces:**
  ```ts
  export type MonthInsights = {
    month: YearMonth; range: { from: number; to: number };
    summary: { income: number; spending: number; savings: number; savings_rate: number | null };
    typical: { income: number; spending: number; savings: number; savings_rate: number | null } | null;
    by_category: Array<{ category_id: string | null; name: string | null; amount: number }>; // desc by amount
    merchants: { top: Array<{ payee_key: string; amount: number; count: number; average: number }>; other_amount: number };
    people: Array<{ payee_key: string; sent: number; received: number; net: number; source: 'guess' | 'user' }>;
    biggest_changes: Array<{ kind: 'category' | 'merchant'; key: string; label: string; amount: number; typical: number; change_pct: number | null }>;
    payment_mix: Array<{ account_id: string; name: string; amount: number }>;
    trend: Array<{ year: number; month: number; income: number; spending: number; savings_rate: number | null }>; // 12 entries, oldest first, ends at selected month
    one_offs: Array<{ transaction_id: string; payee_key: string; amount: number; date_timestamp: number }>;
  };
  export function getMonthInsights(userId: bigint, ym: YearMonth): Promise<MonthInsights>;
  export function setPayeeClassification(userId: bigint, payeeKey: string, kind: 'person' | 'merchant' | null): Promise<void>;
  ```
  Ids are serialised as strings; bigint never appears in the JSON.
- **HTTP:**
  - `GET /insights/month?year=2026&month=10` → `MonthInsights`. Joi: year 2000–2100, month 1–12; a bad value gives 400.
  - `PUT /insights/payee-classification` with body `{ payee_key: string(1..255), kind: 'person'|'merchant'|null }` → `{ ok: true }`.
- **Aggregation queries:**
  - Join only the `accounts` needed for ownership plus `categories` for names. No tags join (this avoids double counting).
  - Ownership: `(acc_from.users_user_id = ? OR acc_to.users_user_id = ?)`.
  - Month predicates come from `structuredFilterSql({dateFrom, dateTo})`.
  - Merchants and people are both grouped by `payeeKeySql`. Each key is classified with the user's correction if one exists, otherwise `guessIsPerson`, with signals computed over all history for the keys in this month.
  - Empty keys are excluded from the merchant and person lists.

- [ ] **Step 1: Write failing integration tests.** Seed one user (helper `seed()` in the test file) across Jul–Oct 2026, with:
  - a salary of 50,000 each month;
  - Swiggy food expenses each month, with a spelling variant in October;
  - "Paid to Achan" 10,000 each month;
  - "Requested by Utthara M" 500 in October;
  - a STARHEALTH 18,555 in August only (one-off);
  - a transfer bank → UPI Lite;
  - an October row with an empty description;
  - one October row at 2026-10-01 00:30 IST.

  Assert for October:
  - `summary.income === 50000`;
  - `summary.spending` equals the sum of the October `E` rows, with the transfer excluded;
  - `savings_rate` is correct to 4 decimals;
  - `typical.spending` equals the Jul–Sep average without the 18,555;
  - `one_offs` lists the STARHEALTH row;
  - the merchants list contains a single `SWIGGY` entry covering both spellings, with `count === 2` in October;
  - `people` contains `ACHAN` and `UTTHARA M` and not `SWIGGY`;
  - no entry has `payee_key === ''`, yet the empty-description amount is in `summary.spending` and `by_category` (uncategorised);
  - `trend.length === 12` and its last entry is October;
  - a month with no data returns zeros, `typical === null` and empty arrays;
  - **drill-down equality**: for `SWIGGY` and for the uncategorised bar, the sum of `getFilteredTransactionsByForUser` amounts with the same `TransactionFilter` equals the aggregated figure;
  - `setPayeeClassification(user,'ACHAN','merchant')` moves ACHAN from `people` into `merchants`; then `kind:null` puts it back in `people` with `source === 'guess'`;
  - `GET /insights/month?month=13` gives 400 (via the controller schema, or by calling the joi schema directly).
- [ ] **Step 2:** Create the migration, run the test file. Expected: FAIL.
- [ ] **Step 3: Implement** the service, controller, route group and wipe and reset changes as specified.
- [ ] **Step 4:** Run the new file, the full integration suite, `npm run test:unit:run` and `npx tsc --noEmit`. Expected: all clean.
- [ ] **Step 5: Commit:** `feat(api): monthly insights endpoint and payee classifications`.

### Task 4: Insights page (web)

**Files:**
- Create: `myfin-web/src/services/insights/insightsServices.ts`: types mirroring `MonthInsights` (ids as strings), `getMonthInsights(year, month)`, `setPayeeClassification(payee_key, kind)`.
- Create: `myfin-web/src/services/insights/insightsHooks.ts`: `useGetMonthInsights(ym)` (query key includes `ym`) and `useSetPayeeClassification()` (invalidates the insights query).
- Create: `myfin-web/src/utils/istMonth.ts`: `istMonthRange(ym: string /* 'YYYY-MM' */): { from: number; to: number }` and `currentYearMonth(): string`. Same arithmetic as Task 1 (UTC minus 19,800 seconds).
- Create: `myfin-web/src/features/insights/Insights.tsx`, plus one component per card: `SummaryCards.tsx`, `WhereMoneyWent.tsx`, `BiggestChanges.tsx`, `TrendChart.tsx`, `PaymentMix.tsx`.
- Modify: `myfin-web/src/providers/RoutesProvider.tsx`: `export const ROUTE_INSIGHTS = '/insights'` and its route.
- Modify: `myfin-web/src/components/MyFinSidebar.tsx`: an Insights entry next to Stats.
- Modify: `myfin-web/public/locales/{en,pt,fr}/translation.json`: an `insights` section. Edit textually (insert keys); do not reformat the files.

**Interfaces:**
- **Consumes:** the Task 3 HTTP contract.
- **Produces:** `buildTransactionsLink(params: { month: string; type?: 'E'|'I'|'T'; category?: string /* id | 'none' */; payee?: string; account?: string }): string`, in `myfin-web/src/features/insights/drillDown.ts`. It returns `/transactions?…`. Task 5 reads exactly these param names.

- [ ] **Step 1: Build the page.** Follow the spec's "The page" section, using Stats-page patterns and `@nivo` charts:
  - a month picker (default `currentYearMonth()`);
  - every figure wrapped in a link from `buildTransactionsLink`, except "Other merchants";
  - in the person and merchant rows, a "not a person" / "this is a person" action calling `useSetPayeeClassification`;
  - `change_pct === null` shown as "new", `savings_rate === null` as "—";
  - empty states when there's no data.
- [ ] **Step 2: Verify** `cd myfin-web && npx tsc --noEmit && npm run build && npx biome lint src/features/insights src/services/insights`. Expected: success, with no new lint errors. Also confirm all three locale files parse as JSON.
- [ ] **Step 3: Commit:** `feat(web): insights page`.

### Task 5: Transactions page URL filters and chips

**Files:**
- Modify: `myfin-web/src/features/transactions/Transactions.tsx`.
- Modify: `myfin-web/src/services/trx/trxServices.ts` and `trxHooks.ts`: `TransactionListOptions` gains `dateFrom?`, `dateTo?`, `categoryId?: string`, `payeeKey?`, `accountId?: string`. These are sent as `date_from`, `date_to`, `category_id`, `payee_key` and `account_id`, and are included in the react-query key. `BulkUpdateTransactionsRequest.filter` gains the same fields.
- Modify: `myfin-web/public/locales/{en,pt,fr}/translation.json`: chip labels.

**Interfaces:**
- **Consumes:** the URL params from Task 4's `buildTransactionsLink`, `istMonthRange` (Task 4), and the Task 2 HTTP filters.
- **Behaviour:**
  - `useSearchParams` is the single source of truth for `month`, `type`, `category`, `payee` and `account`.
  - The existing ALL / DEBIT / CREDIT / TRANSFER toggle reads and writes `type`.
  - Each other active param shows as a removable MUI `Chip` above the table. Labels: month name, the category name or "Uncategorised", the payee key, and the account name. Removing a chip deletes its param.
  - "Select all matching" bulk edit passes the same filters.
  - Changing filters resets to page 0 and clears the selection (existing behaviour).

- [ ] **Step 1: Implement** as specified.
- [ ] **Step 2: Verify:** `npx tsc --noEmit && npm run build`. Then, with the local API running, open `/transactions?month=2026-10&payee=SWIGGY` and confirm the list shows only October's Swiggy rows and that removing the chip clears the filter. Then click through from Insights, a merchant bar and the uncategorised bar, and check the counts match.
- [ ] **Step 3: Commit:** `feat(web): URL-driven transaction filters with chips for insights drill-down`.
