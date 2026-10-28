# Phase E (Routines and Motivation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop on the shortlist:
- a financial health score (#16);
- a month-end review routine (#12);
- event reminders with an "Upcoming" list (#6);
- milestones (#21).

**Architecture:**
- **Monthly records:** one shared `monthly_records` table stores per-month results (#16 score, #12 completion). Past months are frozen on the first read after the month ends (cross-cutting 9); the current month is always live.
- **Read-only checks:** #16 and #12 compose existing services (savings rate, emergency fund, sinking status, typical month, freshness, balance checks, planned rows, budgets, loans) and add no new figures of their own.
- **#6:** events are expanded into occurrences on read.
- **#21:** milestones are evaluated when the Dashboard loads, against a unique (user, kind, key), so each fires once.

**Tech Stack:** myfin-api: Express 5, Prisma 7, MySQL 8.4, joi, vitest. myfin-web: React 19, MUI, react-query, i18next.

**Spec:** `docs/superpowers/specs/2026-10-27-shortlist-designs.md`. Sections #16, #12, #6 and #21, and "Cross-cutting decisions" 1, 4, 5 and 9, plus #1's "EMIs appear automatically in #6 Upcoming", are binding.

## Global Constraints

- **Reuse, don't re-derive.** Every check reads the existing service that owns the figure:
  - savings rate: Insights summary (effective month);
  - emergency fund: `emergencyFund`;
  - sinking fund: `sinkingStatus`;
  - typical: `typicalMonth`;
  - freshness: `listAccountsWithFreshness`;
  - balance checks: `balance_checks`;
  - planned rows: `planned_transactions` / `salary_plans`;
  - budgets: the `budgets` table;
  - loans: `loanService`;
  - net worth: `netWorthAt`;
  - goals: the `goalService` list.
- **"Balances checked" for month M** (cross-cutting 9): every active account with freshness enabled (effective limit not null) has a `balance_checks` row with `checked_at` in M, or within the first 10 days of M+1.
- **Monthly records:**
  - `monthly_records (users_user_id, month Int YYYYMM, kind VarChar(12) 'health'|'review', data Json, frozen_at BigInt?)`, PK (user, month, kind).
  - The current month is always computed live; a stored row for it may hold manual inputs (#12 step 5) but is never frozen.
  - A past month's row is computed once and frozen on the first read after the month ends (IST). A frozen row is returned as is, forever.
- **Not set up:** a check or step whose inputs aren't set up shows `not_set_up` (#16, excluded from M) or `nothing_to_do` (#12, auto-pass), with a link to set it up.
- **IST everywhere;** services take an optional `now`.
- **Backup/restore:** every new table (`monthly_records`, `events`, `event_occurrences`, `event_occurrence_transactions`, `event_suggestion_dismissals`, `milestones`) is included.
  - Restore validates them before the wipe (406, not 500).
  - id maps are keyed by raw backup ids.
  - `restoreUserSchema` accepts the new keys.
  - The wipe and `resetDb` clear them.
  - Tests use a JSON round-trip.
- **Tests and databases:**
  - Integration tests run only on `localhost:3308`, with `DATABASE_URL` inline on every vitest command, one vitest process at a time.
  - Never connect to 3306 or 3307.
  - Web checks: `tsc`, `build`, and `myfin-web/node_modules/.bin/biome` (never `npx biome`). Also follow `myfin-web/docs/frontend-guidelines.md`.
- **schema.prisma:** hand-edit it, keep its line endings; the diff must show only added lines.
- **Logging and locales:** new controllers log with `Logger.addErrorLog`. Locales: en/fr/pt, inserted textually, with `_one`/`_other` plurals.
- **Commits:** every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A past month frozen on first visit:** later edits to that month's data do not change its stored score or review. The current month keeps updating. *(Tests in Tasks 1 and 2.)*
2. **A brand-new user:** the health score shows "0 of 0" (every check not set up, with links), never "0 of 7". The review auto-passes the steps with nothing to do. *(Tests in Tasks 1 and 2.)*
3. **A yearly birthday on 29 Feb, and a monthly rent on the 31st:** occurrences clamp to the month's last day and never skip a month. *(Test in Task 3.)*
4. **The same payment auto-matching two events:** it is not allowed; a transaction marks at most one occurrence paid. *(Test in Task 3.)*
5. **Milestones never re-fire.** A net-worth dip and recovery doesn't repeat the ₹1L banner. On a user's first-ever evaluation, only the highest milestone per kind is shown and the rest go silently to the timeline. *(Test in Task 4.)*

---

### Task 1: Monthly records and #16 financial health score

**Files:**
- **Schema** (migration `add_monthly_records`): `monthly_records`, as specified in Global Constraints.
- **Create:**
  - `myfin-api/src/services/routines/monthlyRecordService.ts` (`getOrFreeze`);
  - `myfin-api/src/services/routines/healthScoreService.ts`.
- **Routes:** `GET /insights/health?month=YYYY-MM` (default: the current month) and `GET /insights/health/history` (the last 12 months).
- **Web:**
  - `HealthScoreCard.tsx` on the Dashboard: "Health N of M", with failing checks and their hints;
  - a page `/health` in the sidebar, showing the checklist for the selected month and a 12-month history (score bars);
  - locale keys.
- **Test** `myfin-api/__tests__/integration/healthScore.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export function getOrFreeze<T>(userId: bigint, ym: YearMonth, kind: 'health' | 'review', compute: () => Promise<T>, now?: number): Promise<{ data: T; frozen: boolean }>;
  export type CheckStatus = 'pass' | 'fail' | 'not_set_up';
  export type HealthScore = { month: string; passed: number; total: number;   // total excludes not_set_up
    checks: { key: 'savings_rate' | 'emergency_fund' | 'yearly_costs' | 'fixed_costs' | 'credit_cards' | 'debt_emis' | 'data'; status: CheckStatus; value: string | null; hint: string; link: string }[] };
  export function healthScore(userId: bigint, ym: YearMonth, now?: number): Promise<HealthScore>;
  export const FIXED_SHARE_MAX = 0.5; export const EMI_SHARE_MAX = 0.4;
  ```
- **Checks for month M:**
  - **savings_rate:**
    - **Pass:** M's Insights savings rate is at or above the target (`targetPercent` rules: an amount target ÷ M's income, or ÷ typical income when income is 0).
    - **Not set up:** no target, or no income and no typical.
  - **emergency_fund:** pass when `months_covered ≥ target_months`. Not set up when `no_accounts`/`no_fixed`.
  - **yearly_costs:** pass when `sinkingStatus.on_track`. Not set up when there are no active yearly costs or no sinking account.
  - **fixed_costs:**
    - **Pass:** typical fixed ≤ 50 % × typical income.
    - **Not set up:** no fixed categories, or no typical income.
  - **credit_cards:**
    - **Reference balance:** for each active `CREAC` account, its balance at its latest balance check dated in M, else its balance at the end of M−1 (`balancesAt`).
    - **Cleared:** when the reference balance is < 0, it counts as cleared if `T` rows into the card within 35 days after the reference time sum to ≥ |balance| − ₹1.
    - **Status:**
      - pass when every card is cleared, or owes nothing at the reference time;
      - fail when any card isn't cleared after the 35 days have elapsed;
      - not set up when there are no cards, or every card's 35-day window is still running.
  - **debt_emis:**
    - **Pass:** Σ EMI of open loans ≤ 40 % × typical income.
    - **Not set up:** no open loans, or no typical income.
  - **data:**
    - **Pass:** no active account is stale now, and balances are checked for M.
    - **Not set up:** no account has freshness enabled.
    - **Current month:** the balance check part is pending (counts as fail) only after day 10 of M+1. For the current month, use "a check since the 1st of M".
- **Hints:** each hint names the threshold, e.g. "Fixed costs are 62 % of income (aim ≤ 50 %)". Each link points at the setup or fix page.
- **History:** every past month goes through `getOrFreeze`; the current month is live.

- [ ] **Step 1: Failing tests.**
  - **New user:** `total` 0, `passed` 0, and every check `not_set_up`.
  - **Scenario in October:**
    - typical income 1,00,000; typical fixed 40,000 → fixed_costs pass;
    - savings target 20 %, with October rate 25 % → pass;
    - an emergency fund of 2 months against a target of 6 → fail;
    - one loan with an EMI of 45,000 → debt_emis fail (45 % > 40 %);
    - a card at −10,000 at the end of September, cleared by a 10,000 `T` on Oct 5 → credit_cards pass;
    - no yearly costs → not set up;
    - data: one stale account → fail.

    Total 6, passed 3.
  - **Freezing:** reading September (a past month) stores it frozen. Changing the data afterwards and reading September again returns the same stored result; reading October still changes.
  - **History:** 12 entries.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full integration and unit suites, plus api `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: financial health score with monthly records (#16)`.

### Task 2: #12 Month-end review

**Files:**
- **Create** `myfin-api/src/services/routines/monthReviewService.ts`.
- **Routes:**
  - `GET /review?month=YYYY-MM` (default: the previous month);
  - `POST /review/:month/reviewed {reviewed: boolean}` (step 5);
  - `GET /review/history` (the last 12 months' completion).
- **Web:**
  - `MonthReviewCard.tsx` on the Dashboard, shown from the 1st to the 10th of each month for the previous month: "<Month> review: N of 6 done";
  - a page `/review` in the menu, with the six steps, each showing done ✓ or what's left, with links;
  - locale keys.
- **Test** `myfin-api/__tests__/integration/monthReview.integration.test.ts`.

**Interfaces:**
- **Consumes:** `getOrFreeze` (Task 1).
- **Produces:**
  ```ts
  export type ReviewStep = { key: 'import' | 'sort' | 'reconcile' | 'planned' | 'review' | 'plan'; status: 'done' | 'todo' | 'nothing_to_do'; detail: string; link: string; items?: { id: string; label: string; link: string }[] };
  export function monthReview(userId: bigint, ym: YearMonth, now?: number): Promise<{ month: string; done: number; total: 6; complete: boolean; steps: ReviewStep[]; frozen: boolean }>;
  export function setReviewed(userId: bigint, ym: YearMonth, reviewed: boolean): Promise<void>;
  ```
- **Steps for month M:**
  1. **import:** done when no active account is stale now. The items are the stale accounts, each linked to `/transactions/import`.
  2. **sort:** done when M has no counted uncategorised `E` rows (effective month). The link goes to `/transactions?month=M&type=E&category=none`.
  3. **reconcile:** done when balances are checked for M, per the Global Constraints definition. Nothing to do when no account has freshness enabled.
  4. **planned:** done when M has no planned rows dated in M (they are deleted when matched, done or skipped). Nothing to do when M had no salary plan.
  5. **review:** done when the stored `reviewed` flag for M is true. The link goes to `/insights?month=M`.
  6. **plan:** done when a budget exists for M+1. The link goes to the Insights forecast card.
- **complete:** all six steps are done or nothing_to_do.
- **Freezing:**
  - Freeze M once it is complete, or on the first read after day 10 of M+1, whichever comes first.
  - `setReviewed` on a frozen month → 409.
  - The stored data keeps `reviewed` even before freezing.

- [ ] **Step 1: Failing tests.**
  - **New user:** steps import, reconcile and planned are nothing_to_do; review and plan are todo; `complete` is false.
  - **September with gaps:** two uncategorised spends, no balance check and no October budget gives sort, reconcile and plan todo. After categorising, checking balances, creating the budget and ticking reviewed, the month is complete and frozen.
  - **Frozen month:** ticking reviewed again → 409.
  - **History:** 12 entries with the completion flags.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: month-end review (#12)`.

### Task 3: #6 Event reminders and Upcoming

**Files:**
- **Schema** (migration `add_events`):
  - `events`:
    - `event_id` PK; `users_user_id` FK cascade; `name VarChar(255)`;
    - `kind VarChar(16)` (`birthday`|`anniversary`|`wedding`|`rent`|`card_due`|`renewal`|`sip`|`other`); `date VarChar(10)` (first occurrence, YYYY-MM-DD); `repeat VarChar(8)` (`once`|`monthly`|`yearly`);
    - `amount BigInt?`; `gift_budget BigInt?`;
    - `account_id BigInt?` (FK SetNull); `category_id BigInt?`; `payee_key VarChar(255)?`; `tag_id BigInt?`;
    - `active Boolean @default(true)`; `created_at BigInt`.
  - `event_occurrences`: `occurrence_id` PK; `events_event_id` FK cascade; `date VarChar(10)`; `status VarChar(8) @default("pending")` (`pending`|`done`); `done_at BigInt?`; `@@unique([events_event_id, date])`.
  - `event_occurrence_transactions`: `occurrence_id` FK cascade; `transaction_id` FK cascade; PK on both; `@@unique([transaction_id])` (a transaction marks at most one occurrence).
  - `event_suggestion_dismissals`: `users_user_id`, `key VarChar(255)`, PK on both.
- **Create** `myfin-api/src/services/routines/eventService.ts`.
- **Routes under `/events`:**
  - `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`;
  - `GET /upcoming?days=30`;
  - `POST /occurrences/:eventId/:date/done {done}`;
  - `POST /occurrences/:eventId/:date/link {transaction_id}` and `DELETE …/link/:transactionId`;
  - `GET /suggestions`;
  - `POST /suggestions/dismiss {key}`.
- **Web:**
  - an Events page at `/events`: a list, an add/edit dialog, suggestions to accept or ignore, and a per-occurrence history with linked transactions;
  - an `UpcomingCard.tsx` on the Dashboard showing the next 30 days, e.g. "Amma's birthday in 5 days · budget ₹3,000 · spent ₹1,200" and "HDFC loan EMI in 2 days · ₹10,661.85";
  - a Transactions row action "Link to event…";
  - locale keys.
- **Test** `myfin-api/__tests__/integration/events.integration.test.ts`.

**Interfaces:**
- **Produces:**
  ```ts
  export function occurrencesBetween(event, fromDate: string, toDate: string): string[];   // pure; monthly/yearly clamp to month end (29 Feb → 28 Feb in non-leap years; 31st → last day)
  export type UpcomingItem = { source: 'event' | 'emi'; id: string; name: string; kind: string; date: string; days_until: number; amount: number | null;
    status: 'pending' | 'done'; gift_budget: number | null; gift_spent: number | null; transactions: string[] };
  export function upcoming(userId: bigint, days: number, now?: number): Promise<UpcomingItem[]>;   // events + unpaid loan installments due in the window, sorted by date
  ```
- **Tags:** each event gets a tag `event:<name>`, auto-created through the existing tags model and renamed with the event.
- **Gift spend for a people occurrence:** Σ counted `E` rows tagged with the event's tag and dated within [occurrence − 60 days, occurrence + 7 days], plus linked transactions (each counted once).
- **Next year's suggested budget:** the last occurrence's actual spend.
- **Auto-match** (money kinds only, on read):
  - **Candidate:** a pending occurrence matches an unlinked counted `E` or `T` row dated within ±5 days. The row must match the event's `payee_key` or `category_id` (or its account, for `card_due`: a `T` into that account), and be within ±10 % of the amount when the event has one.
  - **Result:** the closest by date links it and sets `done`.
  - **Uniqueness:** a transaction is never linked to two occurrences (the unique constraint plus a check).
- **Manual linking and done:** manual link → done for money events. Manual done or undone works for any event.
- **Suggestions:**
  - each active yearly cost at its due month (day 1), with key `yearly:<id>`;
  - payees with counted `E` rows in ≥ 3 of the last 4 months whose day-of-month varies by ≤ 3, giving a monthly event on the median day, with key `recurring:<payee_key>`;
  - for each `CREAC` account, the median day-of-month of `T` rows into it over the last 4 months (≥ 2 rows), giving a `card_due` monthly event, with key `card:<account_id>`.

  Suggestions exclude dismissed keys and existing events with the same key.
- **EMIs in Upcoming:** read live from `loanService`, never stored as events.

- [ ] **Step 1: Failing tests.**
  - **Clamping:** a yearly event on 2024-02-29 has its 2026 occurrence on 2026-02-28. A monthly event on the 31st falls on 2026-11-30 and 2026-12-31.
  - **Upcoming:** with "now" at 2026-10-28, upcoming over 30 days includes a birthday on 11-02 (`days_until` 5) and an unpaid EMI due 11-05, sorted by date.
  - **Gift budget:** ₹3,000 budget; a ₹1,200 spend tagged `event:Amma birthday` on 10-30 shows `gift_spent` 1,200.
  - **Auto-match:** a rent event of ₹15,000 on the 1st, with payee RENT CO, auto-matches a ₹15,200 payment on 11-03 → done. A second rent event with the same payee does not claim the same transaction.
  - **Manual link:** linking a transaction marks a money occurrence done, and unlinking reverts it.
  - **Suggestions:** a payee paid on the 5th, 6th and 4th over three months suggests a monthly event on the 5th; after dismissing, it doesn't.
  - **Ownership:** another user's event → 401.
  - **Backup:** a JSON round-trip keeps events, occurrences, links and dismissals.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: event reminders and upcoming (#6)`.

### Task 4: #21 Milestones

**Files:**
- **Schema** (migration `add_milestones`): `milestones`, with `milestone_id` PK, `users_user_id` FK cascade, `kind VarChar(24)`, `key VarChar(64)`, `achieved_at BigInt`, `dismissed Boolean @default(false)`, `data Json?`, and `@@unique([users_user_id, kind, key])`.
- **Create** `myfin-api/src/services/routines/milestoneService.ts`.
- **Routes:**
  - `POST /milestones/evaluate`, which returns the undismissed new ones;
  - `GET /milestones` (the timeline);
  - `POST /milestones/:id/dismiss`.
- **Web:**
  - `MilestoneBanner.tsx` at the top of the Dashboard. It calls `evaluate` on load and shows each undismissed milestone as a celebratory, dismissible banner.
  - A timeline page `/milestones`.
  - Locale keys.
- **Test** `myfin-api/__tests__/integration/milestones.integration.test.ts`.

**Interfaces:**
- **Consumes:** `netWorthAt`, `emergencyFund`, the goals list, the Insights trend and the savings target (`targetPercent`), `healthScore` and `monthReview` (frozen months only, via the stored `monthly_records`), and debts/loans status.
- **Produces:** `evaluateMilestones(userId: bigint, now?: number): Promise<Milestone[]>` (the newly inserted, undismissed ones).
- **Kinds and keys:**

  | Kind | Key |
  |---|---|
  | `net_worth` | threshold in rupees: 100000, 500000, 1000000, 2500000, 5000000, 10000000 |
  | `emergency_3m` | `"3"` |
  | `emergency_target` | target months |
  | `goal_funded` | goal id |
  | `best_savings_month` | YYYY-MM |
  | `savings_streak` | YYYY-MM of the 3rd month |
  | `health_all_pass` | YYYY-MM (frozen month with total > 0 and passed == total) |
  | `review_streak` | YYYY-MM of the 3rd consecutive complete frozen review |
  | `debt_cleared` | debt id (settled people entry or loan) |

- **Rules:**
  - **Net worth:** a threshold is inserted when the current net worth ≥ it. The unique key means a dip and recovery never re-fires.
  - **Best savings month:** among complete past months (frozen or Insights trend months before the current one) with income > 0, the latest month whose rate is strictly greater than every earlier month's, evaluated once the month has ended.
  - **Savings streak:** 3 consecutive ended months with rate ≥ target.
  - **Streaks use only ended months.** Health and review use only frozen records.
- **First-ever evaluation** (the user has no `milestones` rows): insert everything already achieved. Keep only the highest net-worth threshold, the latest of each other kind, and every `goal_funded`/`debt_cleared` from the last 30 days undismissed; insert the rest `dismissed = true`, so they appear on the timeline without a banner flood.

- [ ] **Step 1: Failing tests.**
  - **First evaluation:** with net worth 6,00,000, the first evaluation inserts ₹1L and ₹5L, with only ₹5L undismissed.
  - **Re-fire:** a dip to 4,00,000 and back to 6,00,000 inserts nothing new. Reaching 10,00,000 inserts ₹10L.
  - **Goals and debts:** a goal reaching full funding inserts `goal_funded`; settling a lent entry inserts `debt_cleared`.
  - **Health:** a frozen health month with all checks passing inserts `health_all_pass`.
  - **Review streak:** three consecutive complete frozen reviews insert `review_streak`.
  - **Dismiss:** dismissing hides the banner; the timeline still lists it.
  - **Ownership:** another user's milestone → 401.
  - **Backup:** a JSON round-trip keeps the milestones.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: milestones and progress moments (#21)`.
