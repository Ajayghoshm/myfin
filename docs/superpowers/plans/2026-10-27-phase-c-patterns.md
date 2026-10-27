# Phase C (Spending Patterns) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three pattern views on the user's own spending:
- small-spend leakage (#9);
- a spending calendar heatmap (#4);
- a savings-rate headline (#10).

**Architecture:**
- **API:** each figure reads the same counted rows as Insights (`fetchRows` in `typicalMonth.ts`: counts rule, effective month). Two new list filters keep drill-downs equal to their figures: `amount_lt` and `day`.
- **#10:** needs no new API. It is computed on the web from the existing `getMonthInsights` response (`trend`, `typical`) plus the profile's savings target.

**Tech Stack:** myfin-api: Express 5, Prisma 7, MySQL 8.4, joi, vitest. myfin-web: React, MUI, react-query, i18next, `@nivo` (already used by Insights).

**Spec:** `docs/superpowers/specs/2026-10-27-shortlist-designs.md`. Sections #9, #4 and #10, and "Cross-cutting decisions" 1, 4 and 5, are binding.

## Global Constraints

- **Counted rows only:**
  - Expenses are `countsForAnalyticsSql` rows of type `E`. Transfers, #11 adjustments and #15 planned rows never count.
  - Months are effective months (a late salary shifts; expenses never do).
  - Days are IST calendar days: `[monthRangeIST(m).from + (d−1)·86400, +86400)`.
- **Drill-down:**
  - Every figure equals the sum of its Transactions drill-down.
  - New filters go through the shared `TransactionFilter` / `structuredFilterSql` / `toTransactionFilter`, so the list, count and bulk "select all matching" agree.
  - Adjustments are hidden only when the type is `E`/`I` and a month or day filter is set (extends ruling R3 from Phase A to `day`).
- **Money:** cents in the DB, currency in API responses. `amount_lt` is in cents over HTTP, as the spec says, and the web `below=` URL param is in cents too.
- **Inherited from Phase B:**
  - typical = the shared `typicalMonth` baseline (3 effective months before, months with data only);
  - services take an optional `now`;
  - backup/restore carries new profile fields with defaults for old backups;
  - restore uses raw-key id maps and a strict `restoreUserSchema`.
- **Tests and databases:** integration tests run only on `localhost:3308`, with `DATABASE_URL` inline on every vitest command. Never connect to 3306 or 3307. Web checks: `tsc`, `build`, and `myfin-web/node_modules/.bin/biome` (never `npx biome`).
- **Locales:** en/pt/fr keys are inserted textually.
- **Commits:** every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A payment of exactly the cut-off** (₹200 when the cut-off is ₹200) is not a small spend. The figure and the `below=` drill-down agree. *(Test in Task 1.)*
2. **A spend at 23:59 IST vs 00:00 IST:** each lands on its own calendar day in the heatmap and in its day drill-down. *(Test in Task 2.)*
3. **The "Flexible only" switch:** fixed and uncategorised spends disappear from the heatmap and its drill-down. *(Test in Task 2.)*
4. **A month with no income:** the savings rate shows "—", never NaN or −∞. An amount target then uses typical income, and the target is hidden when that is also missing. *(Checked in Task 3.)*
5. **A new user:** the small-spend and daily endpoints return zeros or empty arrays with a 200. *(Test in Tasks 1 and 2.)*

---

### Task 1: #9 Small-spend leakage

**Files:**
- **Schema** (migration `add_small_spend_cutoff`): `user_financial_profile.small_spend_cutoff BigInt @default(20000)` (cents).
- **Modify:**
  - `financialProfileService` and its controller: `small_spend_cutoff` in currency over the API, > 0, ≤ ₹100,000;
  - `backupManager` (`?? 20000`) and `restoreUserSchema`;
  - `TransactionFilter.amountLt?: number` (cents) → `transactions.amount < ${amountLt}`, with the HTTP param `amount_lt` (integer > 0) on list and bulk.
- **Create** `myfin-api/src/services/insights/smallSpendService.ts`, plus the route `GET /insights/small-spends?month=YYYY-MM`.
- **Web:**
  - a cut-off field in `FinancialProfileForm`;
  - `SmallSpendsCard.tsx` on Insights, for the selected month: headline, top places and a 12-month trend sparkline (nivo line or bar), each figure linking to its drill-down;
  - Transactions `below=<cents>` URL param, with a chip "Below ₹X" passed to list and bulk;
  - locale keys.
- **Test** `myfin-api/__tests__/integration/smallSpends.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export type SmallSpends = {
    month: string; cutoff: number; count: number; total: number;
    typical_total: number | null; typical_count: number | null;
    places: { payee_key: string; name: string; count: number; total: number; average: number }[]; // top 10 by total, then count
    trend: { year: number; month: number; count: number; total: number }[];                        // 12 entries, oldest first
  };
  export function smallSpends(userId: bigint, ym: YearMonth): Promise<SmallSpends>;
  ```
- **Small spend:** a counted `E` row with `cents < cutoff`.
- **Typical:** the average of the small-spend totals and counts over the `typicalMonth` baseline months that have data. Null with no baseline.
- **Places:** grouped by payee key (`payeeKeySql`). People are included. Rows with an empty key are grouped under "(no description)" with no drill link.
- **Drill-down links:**
  - headline → `month=<ym>&type=E&below=<cutoff cents>`;
  - place → that plus `payee=<key>`;
  - trend point → `month=<that month>&type=E&below=<cutoff cents>`.

- [ ] **Step 1: Failing tests.** The cut-off is ₹200. October holds:
  - TEA STALL ×5 at ₹20;
  - AUTO ×3 at ₹150;
  - SNACKS ×1 at ₹199.99;
  - one ₹200.00 payment;
  - one ₹5,000 payment;
  - one ₹50 transfer;
  - one ₹30 adjustment.

  Assert:
  - **Headline:** count 9, total 100 + 450 + 199.99 = 749.99.
  - **Top place:** AUTO, total 450, count 3, average 150. TEA STALL is second.
  - **Drill-down:** the list with `effectiveMonth`, type E and `amountLt` 20000 returns exactly 9 rows that sum to 749.99. The bulk filter matches the same rows.
  - **Cut-off change:** after the cut-off becomes ₹100, count 5, total 100.
  - **Typical:** Jul–Sep each have 2 small spends of ₹100. `typical_total` 200, `typical_count` 2.
  - **Trend:** 12 entries; October's entry equals the headline.
  - **New user:** zeros, empty `places`, `typical_*` null.
  - **Backup:** a JSON round-trip keeps `small_spend_cutoff`; an old backup gives ₹200.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full integration and unit suites, plus api `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: small-spend leakage (#9)`.

### Task 2: #4 Spending calendar heatmap

**Files:**
- **Create** `myfin-api/src/services/insights/dailySpendService.ts`, plus the route `GET /insights/daily?from=YYYY-MM-DD&to=YYYY-MM-DD&flexible_only=0|1`. `to` is inclusive, with a maximum range of 400 days; a longer range gives 400 Bad Request.
- **Modify:**
  - `TransactionFilter.day?: string` (`YYYY-MM-DD`) → that IST day's `[from, to)` range, with the HTTP param `day` on list and bulk.
  - `toTransactionFilter` sets `excludeAdjustments` when (`effective_month` or `day`) is set and type is `E`/`I`.
  - Web Transactions: `day=` URL param with a chip.
- **Web:** `SpendingCalendar.tsx` on Insights, following the Insights month picker:
  - **Month view:** a 7-column grid starting Monday. Cells are shaded by quantile, empty for zero, with today outlined. The tooltip reads "₹X · N payments".
  - **Weekday averages:** a row for Mon–Sun under the grid.
  - **Year toggle:** the last 12 months as a GitHub-style strip (columns are weeks, rows are weekdays) built from the same endpoint.
  - **Flexible only:** a switch, off by default.
  - **Click a day** → `/transactions?day=YYYY-MM-DD&type=E` (+ `cost=flexible` when the switch is on).
  - Locale keys.
- **Test** `myfin-api/__tests__/integration/dailySpend.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export type DailySpend = {
    from: string; to: string; flexible_only: boolean;
    days: { date: string; total: number; count: number }[];   // only days with spending, ascending
    weekday_avg: number[];                                     // index 0 = Monday … 6 = Sunday; total on that weekday ÷ number of such weekdays in [from, to]
    quantiles: number[];                                       // 4 cut points over non-zero day totals, for 5 shades
  };
  export function dailySpend(userId: bigint, from: string, to: string, flexibleOnly: boolean): Promise<DailySpend>;
  ```
- **Rows:** counted `E` rows only. Days are IST calendar days and are not shifted by the salary rule.
- **flexible_only:** applies the `cost_kind = flexible` predicate.
- **Quantiles:** taken over the non-zero day totals at 20/40/60/80 %, by linear interpolation. An empty array when there are no days.

- [ ] **Step 1: Failing tests.**
  - **Day boundary:** a ₹500 spend on 2026-10-04 at 23:59:59 IST lands on 10-04; ₹300 at 10-05 00:00:00 IST lands on 10-05.
  - **Excluded rows:** a transfer and an adjustment on 10-04 are excluded.
  - **Flexible only:** a ₹10,000 fixed rent on 10-01 is in the default response and absent with `flexible_only=1`.
  - **Weekday average:** for October 2026, Sunday's average = the total of October's Sunday spends ÷ 4 (October 2026 has 4 Sundays).
  - **Drill-down:** the list with `day: '2026-10-04'`, type E (via `toTransactionFilter`) returns exactly the ₹500 row. The adjustment on that day is listed without a type and hidden with type E.
  - **Range limit:** more than 400 days → 400.
  - **New user:** empty days, `weekday_avg` all 0, empty quantiles.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: spending calendar heatmap (#4)`.

### Task 3: #10 Savings rate headline

**Files:**
- **Create** `myfin-web/src/features/dashboard/SavingsRateCard.tsx`, shown at the top of `Dashboard.tsx`.
- **Create** `myfin-web/src/features/insights/savingsRate.ts`: pure helpers.
- Locale keys.

**Interfaces:**
- **Consumes:** `useGetMonthInsights(currentYM)` (the existing hook; `trend` has 12 entries with `income`, `spending` and `savings_rate`; `typical` has `income`), and `useGetFinancialProfile` (`savings_target_mode`, `savings_target_value`).
- **Produces:**
  ```ts
  export function targetPercent(mode: 'amount' | 'percent', value: number, monthIncome: number, typicalIncome: number | null): number | null;
  //   percent → value (0 → null); amount → value ÷ (monthIncome > 0 ? monthIncome : typicalIncome) × 100, null when value is 0 or the base is missing/0
  export function twelveMonthAverage(trend: { income: number; spending: number }[]): number | null;
  //   (Σincome − Σspending) ÷ Σincome × 100 over the 12 entries; null when Σincome is 0
  ```
- **Card copy:** "Savings rate: N% (target T% ✓/✗) · 12-month average A% · ▲/▼ X pts vs last month", with a 12-month sparkline of `savings_rate`. Null points are gaps.
- **Colour:** green when the rate is at or above target, red below, neutral with no target.
- **Missing values:** a rate of "—" when income is 0. The arrow is hidden when either month's rate is null.

- [ ] **Step 1:** There is no web test runner. Write the helpers as pure functions in `savingsRate.ts`, and verify them with a one-off `npx tsx` script in the scratchpad (not committed) for these cases:
  - percent 20 → 20;
  - amount ₹20,000 with income ₹1,00,000 → 20;
  - amount with income 0 and typical ₹80,000 → 25;
  - amount with both 0 → null;
  - average over trend [{100,60},{100,90},{0,10}] → (200 − 160) ÷ 200 = 20;
  - an all-zero trend → null.
- [ ] **Step 2:** Implement the card. Link the headline to `/insights?month=<current>`.
- [ ] **Step 3:** `tsc`, `build`, `biome`.
- [ ] **Step 4: Commit** `feat: savings rate headline (#10)`.
