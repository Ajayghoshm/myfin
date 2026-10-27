# Shortlist feature designs

Date started: 2026-10-27
Status: all items brainstormed (#14 skipped), builder-checked, user questions answered. Awaiting user approval of the full document; execution in phases A–E after approval.

The order follows the dependency groups: A Foundations → B Monthly control → C Insight → D Habits → E Bigger pages.

---

## #8 Fixed vs flexible costs (approved)

**Why:** the user wants to see their committed baseline cost of living separately from discretionary spending, and focus cuts on the flexible part. "Fixed" is reused later by safe-to-spend, the emergency fund meter, the salary-day plan, yearly costs and the health score.

**Decided with the user:**
- Fixed is set per **whole category**. Each category gets a **"Fixed cost"** switch, on the Categories page and in the category dialog, off by default.
- Expenses in fixed categories count as **fixed**, and expenses in other categories as **flexible**. **Uncategorised** expenses form a third bucket, **"Not yet sorted"**; they are never silently counted as flexible.
- Income and transfers are never part of the split. A category is entirely fixed or entirely flexible; there is no partial state.
- **Insights page:**
  - A new card showing Fixed / Flexible / Not yet sorted for the month, each compared with the typical month, using the same one-off rules as the rest of Insights.
  - The 12-month trend gains a fixed vs flexible view.
  - Each bucket drills down to exactly its transactions. This needs a new list filter, cost kind = fixed | flexible | unsorted, shared with bulk update.

**Builder notes (my calls):**
- Store the flag as a column on `categories` (`is_fixed`, boolean, default false). Include it in backup and restore; older backups default it to false.
- In the shared filter predicates, match fixed or flexible with a subquery on `categories.is_fixed`, so the predicate stays tag-free and `transactions.*`-only. `unsorted` is the same as category = none.
- The web Transactions URL gets a `cost=fixed|flexible|unsorted` param with a chip.

---

## #11 Balance check and reconciliation (approved)

**Why:** imported data drifts from reality (a statement missing a few days, a duplicate import). Once a month the user wants to compare MyFin with their bank apps and fix the gaps on the spot.

**Decided with the user:**
- **Balance check screen:**
  - Lists every active account with its MyFin balance and an input for the **real balance**. For credit cards that is the outstanding amount owed.
  - Shows per account **matches ✓** or **off by ₹X** (MyFin higher or lower) as the user types.
  - You can check one account or all of them.
- **Actions on a mismatched account:**
  1. **Add missing transaction:** opens the normal add-transaction dialog with the account preselected and the gap as amount and direction, all editable. The gap updates after saving.
  2. **Write it off:** creates one **adjustment** transaction for the gap, dated today, in category **"Balance adjustment"** (auto-created on first use), with description "Reconciliation write-off". Adjustments are **excluded from Insights** income and spending.
- **Saved results:** each check stores the date and result per account ("last checked 27 Oct, matched" / "written off ₹340"). These show on the Accounts page and are reused by #22 data freshness.
- **No separate reminder:** the month-end review (#12) will prompt it.

**Builder notes (my calls):**
- New table `balance_checks`: account, checked_at, real_balance, myfin_balance, result (matched / adjusted / left open), adjustment transaction id (nullable).
- Mark adjustments with a flag on the transaction (e.g. `is_adjustment`) rather than relying on the category name. Insights and later analytics filter on `is_adjustment = false`.
- The write-off is income or expense to that account, depending on the sign of the gap.

---

## #22 Data freshness per account (approved)

**Why:** imported data goes stale silently. The user wants to know which statements to upload next.

**Decided with the user:**
- **Per account, shown:** last transaction date, last balance check date (from #11), and a status:
  - **Fresh ✓** within the account's limit;
  - **Stale ⚠️** "N days since last transaction" beyond it.
- **Where:** next to each account on the Accounts page, and a dashboard **"Needs updating"** list with only the stale accounts.
- **Limit:** a fixed number of days per account. Defaults by account type: checking / wallet / UPI Lite 7, savings 30, credit card 35, investing / other 45. It can be edited in the account dialog, or set to "never".
- Inactive accounts are never flagged. Only a new transaction makes an account fresh; a balance check alone does not.

**Builder notes (my calls):**
- New nullable column `accounts.stale_after_days` (null = use the type default; 0 = never).
- "Last transaction" = max `date_timestamp` over transactions on either side of the account. Days are computed in IST.

---

## #20 Encrypted backups to a synced folder (approved)

**Why:** the data lives only in local MySQL. The user wants one-click off-machine backups with no Google sign-in inside MyFin.

**Decided with the user:**
- **Approach:** the synced-folder approach, not Google OAuth. MyFin writes backup files to a folder that a sync app uploads: Google Drive for desktop on macOS and Windows, rclone or Dropbox/Nextcloud on Linux. In Docker the folder is mapped into the container.
- **Configuration:** `BACKUP_DIR` in `myfin-api/.env` (and a volume mapping in docker-compose).
- **Backup now** (profile page) asks for a **backup password**. It writes one encrypted file, `myfin-backup-YYYY-MM-DD-HHmm.myfin`, containing the existing full user backup (which includes payee classifications and category fixed flags). The password is never stored. A clear warning says a forgotten password makes that backup unrecoverable.
- **Retention:** keeps the last 30 files, deleting older ones.
- **Restore list:** backups in the folder, newest first, with date and size. Pick one, enter the password, and confirm "this replaces all current data". It uses the existing restore.
- **Manual only:** there are no scheduled backups.

**Builder notes (my calls):**
- Encryption: AES-256-GCM, with the key derived using scrypt and a random salt and IV stored in the file header. A version byte in the file allows future format changes.
- If `BACKUP_DIR` is unset or not writable, the buttons are disabled with an explanation.
- Restore validates the decrypted JSON before any data is deleted (the existing restore already validates first).

---

## #2 Safe-to-spend forecast (approved)

**Why:** mid-month, the user wants to know what they can still freely spend after fixed commitments and savings.

**Decided with the user:**
- **Formula:** safe to spend = expected income − spent so far − fixed still to come − savings target, for the **current month only**.
  - **Expected income** = max(income received so far this month, typical monthly income).
  - **Spent so far** = this month's expenses, excluding transfers and #11 adjustments.
  - **Fixed still to come** = per fixed category (#8): max(0, typical monthly amount − spent in it this month), summed.
  - **Savings target**, set in settings as either a **fixed amount per month** or a **percentage of expected income**, switchable.
- **Card** on the Dashboard and Insights: "Safe to spend: ₹X for the rest of <month> · ₹Y/day for N days".
  - Tap to see the line-by-line breakdown.
  - Red when negative ("₹Z over").
- **Typical** uses the Insights typical-month rule (3 prior months, one-offs excluded).
- With no fixed categories, the card says so and "fixed still to come" is 0.

**Builder notes (my calls):**
- User settings: `savings_target_mode` (`amount` | `percent`) and `savings_target_value`. These sit on the user record or a small settings table.
- The days left are counted in IST, including today.
- Reuse `getMonthInsights`' typical computation (extract a shared helper) so the numbers agree with Insights.

---

## #3 Emergency fund meter (approved)

**Why:** the user wants to know how many months of essential costs their emergency savings cover.

**Decided with the user:**
- **The fund:** the user ticks **"Emergency fund"** on accounts in the account dialog, and the fund is the sum of the ticked accounts' current balances. **Investment accounts and assets are never eligible**: the tick isn't offered on investing-type accounts, and invest assets aren't counted.
- **A month's cost** = typical monthly **fixed** costs (#8), using the Insights typical rule.
- **Meter:** fund ÷ monthly fixed cost = months covered, against a target that is user-set (default 6).
  - Colours: red below 3, amber from 3 up to the target, green at or above the target.
  - Text: "N months covered · ₹X more to reach T months".
- **Placement:** a card on the Dashboard and Insights, later reused by #16 health score.
- **Empty states:** no ticked accounts, or no fixed costs, each give an explanatory message.

**Builder notes (my calls):**
- New column `accounts.is_emergency_fund` (boolean, default false). It is rejected (400) for investing-type accounts (`INVAC`).
- User setting `emergency_fund_target_months` (default 6).
- Only active accounts count. Negative balances count as 0.

---

## #13 Yearly costs spread monthly — sinking fund (approved)

**Why:** big once-a-year costs (insurance premium, course fees, renewals) cause shock months. The user wants them saved for monthly in a real savings account.

**Decided with the user:**
- **Yearly costs list page:** name, amount, due month, optional category. **Yearly only** (no 6-monthly or 2-yearly).
- **Suggestions:** candidates come from history (Insights one-offs, and payees recurring about 12 months apart) and can be accepted or ignored.
- **Sinking-fund account:** the user picks one savings account. It can't be an investing account, and it can't also be an emergency-fund account (#3).
- **Shown:**
  - the monthly set-aside per cost (amount ÷ 12) and in total;
  - **should have by now** = Σ amount × (months since last due date) ÷ 12;
  - "On track ✓" or "Behind by ₹X — transfer ₹Y this month to catch up", against the account's real balance;
  - upcoming due costs.
- **#2 Safe-to-spend:** this month's set-aside transfer counts as "still to come" until a transfer into the fund account happens that month.

**Builder notes (my calls):**
- New table `yearly_costs` (user, name, amount cents, due_month 1–12, category_id nullable, active).
- User setting `sinking_fund_account_id`, with validation against INVAC and against `is_emergency_fund`.
- "Months since last due": count from the most recent occurrence of the due month, so the target resets to 0 in the due month. Use IST months.
- A suggestion is a transaction in the last 13 months that is ≥ ₹5,000, whose payee key has no occurrence in the 10 months before it, and that is not already on the list. Dismissed suggestions are remembered.

---

## #15 Salary-day plan (approved)

**Why:** when salary lands, the user wants a proposed split into buckets and the resulting transfers tracked until they actually happen.

**Decided with the user:**
- **Trigger:** the user marks one income category as the **salary category**. The first income in it each month shows a **"Plan this salary"** card on the Dashboard. One plan per month; a second salary or bonus doesn't trigger another.
- **Proposed split** (each amount editable before confirming):
  1. Fixed costs: typical monthly fixed spending (#8). It stays in the salary account; no transfer.
  2. Yearly set-aside (#13): a transfer to the sinking-fund account.
  3. Emergency top-up (#3): only while below target. The default is min(remaining gap, 10% of salary), and that default % is editable.
  4. Savings target (#2): a transfer to a chosen account.
  5. Free to spend: the remainder.
- **On confirm**, the plan is saved and transfers 2–4 are created as **planned transactions**:
  - shown in the Transactions list greyed out with a **"Planned"** chip;
  - excluded from balances and from all figures (Insights, safe-to-spend, emergency fund, …).
- **Marking a planned transaction off:**
  1. **Match to the real one.** Suggested automatically when a real transaction arrives via import or manual entry with the same amount (± ₹1), the same accounts, and a date within 7 days. On confirm the real row stays and the planned row is removed.
  2. **Mark done:** the planned row becomes a real transaction, and balances update.
  3. **Skip:** the planned row is removed.
- **Visibility:**
  - a "Planned" filter chip on Transactions;
  - in the salary plan view, buckets marked planned / done / skipped ("2 of 3 transfers done");
  - planned rows more than 15 days past their date are flagged overdue in that view only.

**Builder notes (my calls):**
- **Storage:**
  - a `transactions.status` column (`posted` default | `planned`);
  - every existing query, balance recalculation, insights, safe-to-spend and bulk update must filter `status = 'posted'`, except the Transactions list when the Planned chip is active;
  - a new `salary_plans` table (user, month, salary transaction id, amounts per bucket, planned transaction ids, state).
- **Match suggestions:** shown in the PhonePe/paste import review and after a manual add. A match is never applied silently.
- **User settings:** `salary_category_id`, `emergency_topup_percent` (default 10), and `savings_target_account_id`.

---

## #19 Next month's spending forecast → budget (approved)

**Why:** the user wants a forecast they can turn into next month's budget with one click.

**Decided with the user:**
- **Card:** "Next month forecast" on Insights. In the last 7 days of a month it defaults to next month; otherwise any upcoming month can be picked.
- **Per-category forecast:**
  - fixed categories (#8): typical monthly amount;
  - flexible categories: average of the last 3 months, one-offs excluded, adjusted by last year's same-month seasonal difference when that data exists;
  - plus #13 yearly costs due that month, in their category.
- **Income** = typical monthly income. The total comes with a low–high range from each category's month-to-month variation.
- **Uncategorised** spending is shown as a separate "not yet sorted" line and is never budgeted.
- **Rounding:** amounts are rounded to the nearest ₹100.
- **"Create <Month> budget from this forecast":**
  - **No budget for that month:** create one with per-category planned expense = forecast and planned income = expected income, then open it for adjustment.
  - **A budget exists:** show current vs forecast per category, with **replace all**, **fill only empty categories**, or cancel.

**Builder notes (my calls):**
- Use the existing budget model and services: `budgets` and `budgets_has_categories.planned_amount_debit` / `planned_amount_credit`. Don't create a parallel structure.
- **Seasonal adjustment:** if last year has data for the target month and for the 3 months before it, multiply the 3-month average by (last year's target month ÷ last year's 3-month average), clamped to 0.5–1.5. Otherwise apply none.
- **Range:** ± the standard deviation of each category's monthly totals over the 3 months, summed in quadrature.

---

## #9 Small-spend leakage (approved)

**Why:** many tiny payments (UPI Lite snacks, tea, vending, autos) add up unnoticed.

**Decided with the user:**
- The **cut-off is user-set** in settings, with a default of ₹200. A small spend is an **expense below the cut-off**; transfers, adjustments and planned rows are excluded.
- **Insights card:**
  - "Small spends: N payments · ₹X this month (vs ₹Y typical)", using the Insights typical rule;
  - the top small-spend places by total, with count and average;
  - a 12-month trend of the small-spend total;
  - every figure drills down to its transactions.

**Builder notes (my calls):**
- User setting `small_spend_cutoff` (cents, default 20000).
- Drill-down needs an "amount below" list filter (`amount_lt`, in cents), added to the shared structured filter and to bulk update, plus a `below=` URL param with a chip.
- Places are grouped by the same payee key as Insights merchants. People are included too: small payments to people count, because tea-stall owners are often guessed as people.

---

## #4 Spending calendar heatmap (approved)

**Why:** to see at a glance which days money goes out, and patterns such as weekends and post-salary spikes.

**Decided with the user:**
- **Month view** (default; on Insights, following its month picker): a 7-column calendar. Each day is coloured by its total expenses; hover shows "₹X · N payments".
- **Year view (toggle):** the last 12 months as a GitHub-style daily strip.
- **Click a day** (either view) → Transactions filtered to that day.
- **Colours:** five shades scaled to the user's own spending (quantiles over the displayed range). Zero days are blank, and today is outlined.
- **"Flexible only" switch** (uses #8), off by default, so large fixed payments don't wash out the scale.
- **Weekday averages** (Mon–Sun) below the month view.
- Transfers, #11 adjustments and #15 planned rows are excluded.

**Builder notes (my calls):**
- Days are IST calendar days. Add the API data to the insights endpoint or a sibling `GET /insights/daily?from=&to=&flexible_only=`.
- The day drill-down reuses the `month` URL param mechanism with a `day=YYYY-MM-DD` param mapped to an IST day range.

---

## #10 Savings rate headline (approved)

**Why:** savings rate is the single most telling health number. The user wants it prominent, with a target.

**Decided with the user:**
- **Headline card at the top of the Dashboard:** "Savings rate: N% (target T% ✓/✗) · 12-month average A% · ▲/▼ vs last month", with a 12-month sparkline. Green when on or above target, red below.
- **The target comes from #2's savings target setting:**
  - a percentage target is used directly;
  - an amount target is converted to a percentage of that month's income (or of typical income when income is 0).
- **Calculation:** the same as Insights (income − spending) ÷ income, excluding transfers, adjustments and planned rows. "—" when income is 0.

**Builder notes (my calls):**
- Reuse `getMonthInsights` trend data, with no new aggregation.
- With no target set, show the rate and trend without a target line.

---

## #17 Net worth change, explained (approved)

**Why:** the user wants to know why net worth moved: saving, market growth, debt or adjustments.

**Decided with the user:**
- **Insights card** for the selected month: "Net worth ±₹X in <Month>", broken into:
  - **saved from income** (income − spending);
  - **investment growth** (change in invest asset values not explained by buys and sells);
  - **debt paid down** (reduction in credit-card and other debt balances);
  - **write-offs** (#11 adjustments).
- **12-month view** of each part's contribution (stacked bars).
- **Per-account list** under the card: each account's balance change that month.

**Builder notes (my calls):**
- Net worth uses MyFin's existing patrimony / balance-snapshot data. The parts must sum exactly to the net-worth change, with any residual shown as an "other" line rather than hidden.
- **Investment growth** = end value − start value − net invested in the month, using invest transactions and asset value snapshots.
- **Debt paid down** = the decrease in negative balances of credit/debt-type accounts. It overlaps with saving (a card bill payment is a transfer), so define the parts so nothing is counted twice. Saving is measured on income/expense only; debt-paydown is informational and taken out of "other".

---

## #16 Financial health score (approved)

**Why:** a single, explainable picture of financial health, tracked month to month.

**Decided with the user:** a checklist of pass/fail checks. Each shows ✓/✗ and a one-line fix hint. The score is "N of M passed", stored per month for a trend.

| Check | Pass when | Source |
|---|---|---|
| Savings rate | ≥ target | #10 / #2 |
| Emergency fund | ≥ target months | #3 |
| Yearly costs | sinking fund on track | #13 |
| Fixed costs | fixed ≤ 50% of income | #8 |
| Credit cards | paid in full last cycle | card accounts |
| Debt / EMIs | EMIs ≤ 40% of income | #1 |
| Data | no stale accounts and balances checked this month | #22 / #11 |

**Builder notes (my calls):**
- A check whose inputs aren't set up yet (no target, no ticked accounts, #1 not built) shows "not set up" with a link to set it up, and is excluded from M rather than counted as a fail.
- "Paid in full last cycle": for credit-card accounts, the balance at the latest balance check (#11), or else at the end of last month, was cleared by a transfer within the following 35 days. If it can't be determined, it counts as "not set up".
- The thresholds (50%, 40%) are constants, shown in the hint text.
- Placement: a Dashboard card, plus a detail page with the monthly history.

---

## #14 Weekly 2-minute check-in — SKIPPED by the user (2026-10-27)

---

## #12 Month-end review (approved)

**Why:** a guided routine that turns the month's data into clean books and next month's plan.

**Decided with the user:**
- **Dashboard card** "<Month> review: N of 6 done", shown from the 1st to the 10th of each month for the previous month. It opens a checklist page, which is also reachable at any time from the menu.
- **Steps** (each shows done ✓ or what's left):
  1. **Import:** stale accounts (#22), each linked to the import page.
  2. **Sort:** the previous month's uncategorised spending, linked to Transactions with that month and category=none.
  3. **Reconcile:** balance check (#11) done in the last 10 days or since month end.
  4. **Planned:** the previous month's planned rows (#15) all matched, done or skipped.
  5. **Review:** the user ticks this after viewing Insights for the month (a link opens it).
  6. **Plan:** a budget exists for the current month (#19 "create from forecast" link).
- The review is complete when all six are ticked. Completion is stored per month.

**Builder notes (my calls):**
- Steps 1–4 and 6 are computed live from data. Only step 5 is a manual tick, and it's stored.
- A step whose feature isn't set up (e.g. no planned rows) auto-passes as "nothing to do".

---

## #21 Milestones and progress moments (approved)

**Why:** motivation for consistency. Real achievements get celebrated.

**Decided with the user:**
- **Banner only** (no email). Each milestone shows once as a celebratory Dashboard banner (dismissible), then appears in a **milestones timeline** page.
- **Milestones:**
  - net worth crosses ₹1L / 5L / 10L / 25L / 50L / 1Cr;
  - emergency fund reaches 3 months, then the target (#3);
  - a goal is fully funded;
  - best savings-rate month ever, and 3 consecutive months on target (#10);
  - health score: all checks pass (#16);
  - month-end review completed 3 months in a row (#12);
  - a debt or loan fully cleared (#1).

**Builder notes (my calls):**
- New table `milestones` (user, kind, key such as the threshold or goal id, achieved_at, dismissed). The unique (user, kind, key) makes each fire once.
- Evaluate on Dashboard load (cheap checks using already-computed figures); no scheduler.
- Net-worth thresholds fire on upward crossings only, and never re-fire after a dip.

---

## #6 Event reminders (approved)

**Why:** the user wants reminders for both people's dates and money dates, visible ahead of time.

**Decided with the user:**
- **Events page** with name, date, repeat (once / monthly / yearly), kind (**people**: birthday, anniversary, wedding; **money**: rent, card due, renewal, SIP), and optional amount.
- **People events** can have a **gift budget**. Spending tagged with the event counts against it, and next year's suggestion uses actual spend.
- **Suggested money events** (accept or ignore):
  - #13 yearly costs at their due month;
  - payments recurring on about the same day each month;
  - credit-card due dates.
- **Upcoming list** on the Dashboard covering the **next 30 days**, e.g. "Amma's birthday in 5 days · budget ₹3,000" or "Card ••73 due in 2 days · ₹13,231".
- **Done status:**
  - money events auto-mark **paid ✓** when the matching payment appears;
  - **any event can be marked done manually**.
  - **Manual linking (user addition):** from an event occurrence, the user can pick one or more transactions to link, and from a transaction they can link it to an event. Linked transactions mark a money event paid, and count towards a people event's gift budget, alongside the tag.
- **Dashboard only** (no email). Assumed; the user can ask for email later.

**Builder notes (my calls):**
- New tables `events` (user, name, kind, date, repeat, amount, gift_budget, linked account/category/payee key) and `event_occurrences` (event, occurrence date, status: pending/done, matched transaction id).
- **Gift spend linking:** each event gets a tag `event:<name>`, using the existing tags model.
- **Auto-match:** a payment to the linked payee key or category within ±5 days of the occurrence date, with an amount within ±10% when the event has one.

---

## #1 Debts & loans: lent, borrowed, loans, EMIs (approved)

**Why:** the user has both informal lending (friends and family) and formal EMIs. They want one place to track who owes what and loan progress, without distorting spending.

**Decided with the user:**
- **People (lent and borrowed):**
  - **Entries:** person, amount, date, optional due date and note. An entry can be created from an existing transaction ("mark this payment as a loan to X") or by hand.
  - **Repayments:** auto-matched from transactions with the same payee, linked manually to a chosen transaction, or **marked manually** with no transaction (e.g. repaid in cash). Partial repayments reduce what's left.
  - **Status:** outstanding / settled ✓ / overdue (past due date). Page totals: "Owed to you ₹X · You owe ₹Y".
  - **Not spending or income:** lending and repayments are excluded from Insights spending and income.
- **Formal loans and EMIs:**
  - **Each loan:** lender, principal, interest rate (0 allowed for no-cost EMIs), tenure, EMI amount, EMI day and paying account.
  - **Schedule:** an amortisation schedule is generated. Each EMI is matched from transactions, linked manually, or **marked paid manually**, and missed EMIs are flagged.
  - **Shown:** outstanding principal, interest paid so far, EMIs left, end date, and a **prepayment what-if** (months saved, interest saved).
  - **Spending treatment:** only the **interest part** of each EMI counts as spending in Insights. The principal part reduces debt, which feeds #17 net worth and #16's EMI ≤ 40% check.
  - **Reminders:** EMIs appear automatically in #6 Upcoming.

**Builder notes (my calls):**
- **Tables:**
  - `debts` (user, kind lent/borrowed/loan, counterparty payee key or name, principal, rate, tenure, emi, emi_day, account, start, due, status);
  - `debt_payments` (debt, date, amount, principal part, interest part, transaction id nullable, manual flag).
- **Excluding lent and borrowed amounts and EMI principal from Insights:** mark the linked transactions (e.g. `transactions.debt_id` plus a role), and have insights exclude principal-only rows. For an EMI transaction, insights counts its interest part. Keep the "figures equal drill-down" rule: the drill-down list must apply the same exclusion.

---

## #5 Retirement / FIRE calculator (approved)

**Why:** to answer "how much do I need, and when can I stop working?" from the user's real data.

**Decided with the user:**
- **Inputs come from the settings page,** in a new **"Financial profile"** section, not from the calculator:
  - date of birth (age derived) and target retirement age;
  - expected return, inflation and safe withdrawal rate (defaults 10% / 6% / 3.5%);
  - retirement spending basis: everything or fixed costs only (from #8 typical);
  - optional **family support in retirement**: amount/month and number of years (default ₹0);
  - which accounts and invest assets count towards the corpus.
- **Shared settings home:** the same section holds every setting from this shortlist: #2 savings target, #3 emergency target months, #13 sinking-fund account, #15 salary category / top-up % / savings account, and #9 small-spend cut-off.
- **Retirement page:**
  - shows the corpus needed (future and today's rupees), the age at which the user is on track to reach it, and the extra monthly investment needed to retire at the target age;
  - a yearly projection chart against the target line;
  - **what-if sliders** that don't change saved settings, with an optional "save as my settings" button;
  - links to settings when required inputs are missing.

**Builder notes (my calls):**
- **Corpus needed** at retirement = (annual spending at retirement in future rupees ÷ SWR) + present value at retirement of the family-support stream (an inflation-adjusted annuity for N years).
- **Projection:** a yearly compounding of current corpus plus monthly investment (#2 target) at the expected return, with spending inflated at the inflation rate.
- A single `user_financial_profile` table (one row per user) holds all the shortlist settings.

---

## #7 Goal-linked investments (approved)

**Why:** goal progress should include the investments earmarked for it, at market value.

**Decided with the user:**
- In a goal, the user links one or more **investment assets** and chooses how much of each counts, as a percentage or a fixed amount.
- **Splittable:** one investment can be split across several goals. The total allocated across goals can't exceed 100% (or the asset's value for fixed amounts), and the UI shows how much of each asset is unallocated.
- **Goal progress** = existing account-based funding + the allocated share of each linked asset's **current market value**.
- **Display:** "₹X of ₹Y · on track / behind for <due date> at your current SIP". The SIP comes from recurring buys of the linked assets.

**Builder notes (my calls):**
- Mirror the existing `goal_has_account` model (`match_type` percentage/amount + `match_value`) with a new `goal_has_asset` (goal, invest asset, match_type, match_value). Reuse the existing goal funding and "unallocated funds" logic and UI patterns rather than inventing new ones.
- Add `goal_has_asset` to backup and restore.
- **"On track":** project the current value plus the monthly SIP at the #5 expected return up to the due date, and compare with the target.

---

## #18 "If something happens to me" file (approved)

**Why:** the user's family should be able to find every account, policy, loan and contact if the user can't help.

**Decided with the user:**
- **Legacy file page:**
  - **Accounts:** prefilled from MyFin, with bank/branch, nominee and document location per account.
  - **Insurance policies:** insurer, policy number, sum assured, nominee, claim helpline. Suggestions come from payees like STARHEALTH.
  - **Loans and EMIs, and people owed money / owing money**, both pulled live from #1.
  - **Key contacts:** CA, insurance agent, employer HR, etc.
  - **Free-text instructions.**
- **Never stores passwords, PINs or OTPs.** The UI says so, and fields are labelled "where to find".
- **Access:** a **printable PDF** that the user generates and keeps safely. There is no separate login.
- **Placement (user decision):** it lives **inside the Settings page** as its own section, not as a separate top-level page.

**Builder notes (my calls):**
- New tables `legacy_entries` (user, kind: account-detail/policy/contact/instruction, structured fields as JSON, linked account id nullable) for the user-entered parts. Loans and balances are read live at PDF time.
- **PDF:** generated client-side from a print-styled page (browser "Save as PDF"), avoiding a server PDF dependency. Each page shows "generated on <date>" and a reminder to regenerate after changes.
- Include `legacy_entries` in backup and restore.

---

## Cross-cutting decisions (after builder review; my calls unless marked)

1. **One "counts" rule.** One shared predicate, `countsForAnalytics`, decides what is income or spending for Insights and every new card. It excludes:
   - transfers (`T`);
   - #11 adjustments;
   - #15 planned rows;
   - #1 lent/borrowed principal and repayments.

   **EMIs are stored as two rows:** an interest expense, plus a principal **transfer** to a per-loan liability account (a new account type `LOANAC`). Every figure still equals its drill-down. Existing upstream pages (Budgets actuals, Stats, Dashboard) are **not changed**, to keep upstream merges easy; this is a known difference.
2. **Net worth** = active non-investing account balances (loan accounts negative) + invest holdings at market value (not `INVAC` balances, to avoid double counting) + money owed to the user (#1) − money the user owes (#1). Used by #17, #21, #5 and #18.
3. **Essential vs fixed (user decision: keep both).**
   - The existing per-transaction `is_essential` flag stays as it is and keeps feeding Budgets' essential reporting.
   - The new per-category **fixed** switch (#8) feeds every new feature (#2, #3, #5, #13, #15, #16, #19).
   - The two can differ, and that is accepted.
4. **Savings model.** Three separate monthly set-asides: the #2 savings target, the #13 yearly set-aside, and the #3 emergency top-up (only while below target).
   - #2 safe-to-spend subtracts all three for the current month, until each one's transfer has happened that month.
   - #15 "Free to spend" on salary day equals #2 safe-to-spend.
   - #10 savings rate stays (income − spending) ÷ income. Set-aside transfers are not spending, so they count as saved.
5. **Month-end salary funds the next month (user decision).**
   - An income in the **salary category** dated on or after the **salary cut-off day** (a setting, default 25) is attributed to the **next** month: its *effective month*.
   - This applies to #15 (plan for that next month), #2 expected income, #10 savings rate, the typical income, and the Insights income/savings figures.
   - To keep "figure equals drill-down", the Transactions `month` filter uses the same effective-month rule for salary rows. A small "counted in November" note is shown on such rows.
   - All other transactions use their calendar IST month.
6. **Typical month.**
   - Transactions linked to a #13 yearly cost (explicit link; suggested by category + payee key) are excluded from typical and from #2's "spent so far". They're funded by the sinking fund.
   - #19 adds yearly costs back once, so nothing is double counted.
   - Income gets a one-off rule too: a single income ≥ 1.5× typical monthly income (bonus) is excluded from the typical baseline.
7. **Planned rows live in their own table,** `planned_transactions`, not as a status on `transactions`. They're merged into the Transactions list only when the Planned chip is on, and converted into real transactions on "mark done". No upstream query needs changing. This replaces the #15 storage note.
8. **Earmarking.**
   - An account can be in at most one of: emergency fund (#3), sinking fund (#13), savings-target account (#15).
   - Goals (#7) and retirement (#5) may overlap with each other, but never with emergency or sinking accounts.
   - The retirement total counts invest holdings at market value plus ticked non-investing accounts. It never counts `INVAC` balances.
9. **Monthly records.**
   - The current month is always computed live.
   - Past months (#16 score, #12 completion) are frozen on the first visit after the month ends.
   - "Balances checked" means every active account with freshness enabled (#22) has a balance check dated in that month or within the first 10 days of the next.
   - #21 streak milestones evaluate only frozen months.
10. **Time zone.**
    - The API runs with `TZ=Asia/Kolkata`, set in `docker-compose.yml` and documented for local runs, so upstream budgets and snapshots align with the IST months used by Insights.
    - New code keeps using the explicit IST helpers.

**Build phases:**
- **A:** the shared counts rule + settings home (`user_financial_profile`), then #8, #11, #22, #20.
- **B:** #2, #3, #13, #15, #19.
- **C:** #9, #4, #10.
- **D:** #1, then #17, #5, #7, #18.
- **E:** #6, #16, #12, #21.

Each phase gets its own plan.
