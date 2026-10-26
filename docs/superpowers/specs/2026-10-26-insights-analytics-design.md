# Insights (analytics) page — design

Date: 2026-10-26
Status: builder-checked, awaiting user approval

## Intent

After importing a statement, the user wants to open MyFin and quickly understand **where the month's money went** (by category, merchant and person), **whether this month is better or worse than usual**, and **what is changing over time**. Existing Dashboard and Stats pages lean on categories and budgets. Most of the user's PhonePe rows still have no category, and none of those pages separate people from shops or compare a month with a "typical" one.

## Goals

- A new **Insights** page (route `/insights`, in the sidebar near Stats) that shows one month at a time, with a month picker defaulting to the current month.
- Every number links to the exact transactions behind it (drill-down to the Transactions page).
- People (family, friends) are shown separately from merchants. MyFin guesses which payees are people, and the user can correct any guess.

## Non-goals

- Changing the existing Dashboard or Stats pages.
- Budgets, forecasts, or any of the other shortlisted features (safe-to-spend, savings-rate targets, etc.).
- Merging merchant name variants beyond the simple normalisation below.
- Multi-month or custom date-range analysis, other than the 12-month trend.

## Anti-goals

- Counting transfers between the user's own accounts (type `T`) as spending or income.
- Numbers that don't match what the Transactions page shows for the same filter.
- Slow page loads. One month of data (a few hundred rows) must render in well under a second.

## Definitions

- **Income** = sum of type `I` transactions in the month. **Spending** = sum of type `E` transactions in the month. Transfers are excluded from both.
- **Savings** = income − spending. **Savings rate** = savings ÷ income (shown as "—" when income is 0).
- **Typical month**: the per-metric average over the **3 complete months before** the selected month, with **one-offs excluded**.
  - A **one-off** is an expense of at least ₹10,000 whose payee does not appear in at least 2 of those 3 months. Examples: an insurance premium, a flight, jewellery. (Builder's call: compute this server-side and expose the list.)
  - If fewer than 3 prior months have data, use what exists. With none, comparisons are hidden.
- **Payee key**: the transaction description, trimmed, with whitespace collapsed and upper-cased, after removing a leading `Paid to ` / `Received from ` / `Requested by ` / `Payment to ` (see Decision 4; entities are not used).
- **Person vs merchant**: each payee key is classified `person` or `merchant`.
  - **Guess.** A payee is guessed to be a person when:
    - its name contains none of a business-word list (e.g. PVT, LTD, LIMITED, PRIVATE, STORE, STORES, CAFE, HOTEL, RESTAURANT, ENTERPRISES, MART, TECHNOLOGIES, SERVICES, BAKERY, FOODS, STALL, AIRLINE, CLINIC, VENDING, plus known brands such as SWIGGY, ZOMATO, BLINKIT, NETFLIX, UBER, OLA); **and**
    - at least one of these holds: the description started with `Requested by ` or `Received from `; or the user has made a payment to it of ₹1,000 or more that is a multiple of ₹100.

    Everything else is a merchant. The builder may refine the word list; the rule shape is fixed.
  - **User correction**: stored per user and payee key, and it always beats the guess.

## The page

1. **Month summary cards**: Income, Spending, Savings, Savings rate. Each shows the value and the difference from the typical month, in green when better (more income, less spending, more savings, higher rate) and red when worse.
2. **Where the money went**: one card with a three-way switch:
   - **By category**: horizontal bars of spending per category, largest first. "Uncategorised" is its own bar.
   - **By merchant**: top 10 merchant payee keys by spending, each with total, number of payments and average per payment, plus an "Other merchants" row.
   - **By person**: every person payee, with sent (expenses), received (income) and net. Each row has a small control to mark it as "not a person" (and the merchant list offers "this is a person"), saving a user correction.
3. **Biggest changes vs typical**: up to 5 categories or merchants whose spending moved the most against the typical month, in absolute rupees, e.g. "Food delivery ₹6,200 (+48%)". Each links to its transactions.
4. **12-month trend**: bar or line chart of income and spending for the 12 months ending at the selected month, with savings rate as a line on a secondary axis. Clicking a month selects it.
5. **Payment method mix**: spending split by source account (UPI Lite, each bank account, each card), as a small bar or pie chart.

## Drill-down

Every clickable figure navigates to the Transactions page with filters in the URL. The page reads them on load and shows them as removable chips above the table. Filters needed, beyond today's search and type:

- **Date range**: from and to, as the month boundaries.
- **Category**: a specific category, or "none".
- **Payee key**: matches the normalised payee as defined above.
- **Account**: the source account, for the payment method mix.

These filters also apply to the Transactions page's existing sort, pagination and "select all matching" bulk edit, so the user can, for example, categorise every uncategorised Swiggy row of the month in one go.

## Technical shape

- **API (myfin-api):**
  - **New endpoint `GET /insights/month?year=&month=`.** It returns, in one response:
    - the month summary;
    - the typical-month values;
    - spending by category;
    - merchant and person aggregates;
    - the biggest changes;
    - the payment method mix;
    - the 12-month trend;
    - the list of one-offs excluded from typical.

    Compute with SQL aggregation, not by loading all rows into Node.
  - **New table `payee_classifications`** (user, payee key, kind `person|merchant`), unique per user and payee key, cascade-deleted with the user. **New endpoint `PUT /insights/payee-classification`** with body `{ payee_key, kind }` to save a correction.
  - **Extend `GET /trxs/filteredByPage/:page` and the bulk-update `filter`** with the new filters: `date_from`, `date_to`, `category_id` (or `none`), `payee_key`, `account_id`. They extend the shared `filteredTransactionsFrom` SQL fragment, so list, count and bulk update stay consistent.
  - The payee-key normalisation is one function shared by aggregation and filtering. SQL and TypeScript must agree; integration tests cover this.
- **Web (myfin-web):**
  - New `features/insights/` page using the existing `@nivo` chart packages and MUI cards, following the Stats pages' patterns.
  - Transactions page: read URL filters and show filter chips.
  - i18n keys in en, pt and fr (upstream now has French).

## Testing

- **API integration tests:** a seeded month should check:
  - the summary, with transfers excluded;
  - the typical month, with one-off exclusion;
  - person guessing, including the `Requested by` and round-amount rules, and that business words win;
  - that a user correction overrides a guess;
  - that every drill-down filter returns exactly the rows that were aggregated, i.e. the per-merchant total equals the sum of its drill-down rows.
- **Unit tests:** payee-key normalisation and the person-guess function.
- **Web:** type check and build; manual check in the browser.

## Constraints

- Builds on the current upgraded codebase: API 5.5.1 with Prisma 7, web 10.7.1. Charts use `@nivo` (already a dependency).
- Money is stored as integer cents in `transactions.amount` and shown in the user's currency (INR) with the existing formatting helpers.
- Tests must never touch the user's real databases (localhost:3306 / 3307). Use a throwaway MySQL container.

## Decisions (settled after builder review; my calls, open to correction)

1. **Months are IST months.** All month boundaries (selected month, the 3-month typical window, the 12-month trend, drill-down filters) are computed in TypeScript as epoch-second ranges for Asia/Kolkata. Aggregation groups by those ranges, never by `FROM_UNIXTIME`, so totals and drill-downs always agree regardless of the MySQL session time zone.
2. **Date filters:** `date_from` is inclusive and `date_to` exclusive, both epoch seconds. In the web URL the Transactions page uses `month=YYYY-MM` (plus the other filters). The URL is the source of truth: chips remove their parameter, and back/forward works.
3. **Aggregation query:** aggregates use a tag-free query with the same predicates as the list (the shared predicate builder gains a variant without the tags join), so a transaction is never counted twice. **Source account:** expenses use the from-account and income the to-account; transfers are excluded everywhere, including the payment method mix. The `account_id` filter matches either side.
4. **Payee key is computed in SQL only.** One shared `Prisma.sql` fragment:
   - starts from `UPPER(TRIM(REGEXP_REPLACE(description, '\\s+', ' ')))`;
   - strips a leading `PAID TO ` / `RECEIVED FROM ` / `REQUESTED BY ` / `PAYMENT TO ` with `REGEXP_REPLACE`;
   - is used by aggregation, the payee filter and classification lookup alike;
   - adds no stored column and no backfill.

   **The entity is not used**: the key always comes from the description, which keeps it stable when entities change. That replaces the entity rule in the Definitions section. An empty key is "Unknown payee": counted in totals and categories, but never listed as a merchant or person.
5. **The person guess uses all-time history per payee key**, so a payee doesn't flip between months. "Prefix seen" means any transaction for that key ever started with `Requested by ` / `Received from `. The round-amount rule likewise uses all history.
6. **One-offs:** a single transaction of ₹10,000 or more whose key is non-empty and doesn't appear in at least 2 of the 3 baseline months. One-offs are excluded from the **baseline only**; the selected month stays raw. **Biggest changes** compares each category or merchant with its baseline average over the 3 months, counting months with no spend as zero and excluding one-offs. When the baseline is 0 it shows "new" instead of a percentage.
7. **"Other merchants"** is not clickable. `PUT /insights/payee-classification` accepts `kind: null` to delete a correction and fall back to the guess. Classifications are strictly per user.
8. **A month with no income** shows a gap for savings rate in the trend, and "—" in the cards.
9. **New filters AND-combine** with search and type. In the bulk-update `filter`, `query` stays optional (default `''`) and the new fields are optional.

## Left to the builder

- Exact chart types and layout within each card, and responsive behaviour.
- The full business-word list (shape fixed above).
- Query structure and indexes, as long as the page loads quickly for a few thousand transactions per year.
