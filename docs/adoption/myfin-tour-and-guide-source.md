# MyFin - tour and user-guide source material

Source reference for (a) Digital Adoption Platform (DAP) tours, tooltips and checklists and (b) a "how to use MyFin" guide.
Built from the code on branch `feature/phonepe-import` (web: `myfin-web`, API: `myfin-api`) and the specs/plans under `docs/superpowers/`. Nothing here was run in a browser (see section 8). Where the code and the specs differ, **the code wins** and the difference is noted ("Code vs spec").

Conventions used below:
- Labels are the exact English UI text from `myfin-web/public/locales/en/translation.json`.
- Money is shown in the user's currency (the product was built for INR; examples use rupees). Amounts are stored as integer cents.
- "IST" = Asia/Kolkata. All month boundaries are IST months.
- "Verify in app" = not confirmed from code; check before publishing a tour.
- Routes are hash routes (`HashRouter`), so a real URL looks like `https://<host>/#/insights`. DAP URL matching must use the hash part.

---

## 1. Purpose and how to use this file

**For DAP authoring:** section 2 gives page URLs and prerequisites (use them as flow start conditions and "launch when" rules). Section 4 gives per-page elements, suggested selectors and 3-7 step tour outlines with tooltip copy. Section 6 gives launcher checklists. Section 7 lists the `data-tour` attributes that should be added to the code first, because most elements have no stable hook.

**For the user guide:** section 3 is the "first week" story; section 4 has "how to" flows in the exact UI wording plus "How it works" rules; section 5 is the glossary; sections 9 and 10 are the consolidated rules table and "gotchas".

**Who reads what:** DAP authors need 2, 4 (elements/tour), 6, 7. Guide writers need 3, 4 (what/how-to/rules), 5, 9, 10.

**Page types:** MyFin has a left sidebar (collapsed to icons below the `md` breakpoint) and a top bar with the summary figures (Operating Funds / Investing / Debt / Net Worth, from the original app), a theme button (`aria-label="Change theme"`), a profile button (`aria-label="profile"`) and a logout button (`aria-label="logout"`). Most pages have a title + strapline header (`PageHeader`).

---

## 2. App map

Sidebar order (top to bottom) is exactly as in `MyFinSidebar.tsx`. "Needs" = prerequisites for the page to be useful. Audience: **E** = everyone, **P** = power user / optional.

| # | Menu label | Route | One-line purpose | Who | First-time prerequisites |
|---|---|---|---|---|---|
| 1 | Dashboard | `/dashboard` | Home: savings rate, cards that nag you (needs updating, salary plan, month review, upcoming, health, safe to spend, emergency fund) and charts. | E | Works empty. Cards fill in as data and settings arrive. |
| 2 | Transactions | `/transactions` | Every transaction; search, filter, edit, bulk edit, add, import. | E | At least one account. |
| 2a | (button) Import Transactions | `/transactions/import` | Paste from clipboard or upload a PhonePe statement CSV. | E | At least one account (paste flow) or accounts for each PhonePe payment method. |
| 3 | Budgets | `/budgets` | Monthly budgets (list). | E | Categories. |
| 3a | (button/icon) Matrix view | `/budgets/matrix` | Many months side by side (marked Beta). | P | Existing budgets. |
| 3b | (open a budget) | `/budget/:id`, `/budget/new` | Edit a month's planned income/expense per category. | E | Categories. |
| 4 | Accounts | `/accounts` | Accounts with balance, status, freshness ("Fresh" / "Stale"), last balance check. | E | None - this is where to start. |
| 4a | (button) Balance check | `/accounts/balance-check` | Compare MyFin balances with the bank and fix gaps. | E (monthly) | Accounts with transactions. |
| 5 | Investments | `/invest` (+ `/invest/dashboard`, `/invest/assets`, `/invest/transactions`, `/invest/stats`, `/invest/reports`) | Assets, buys/sells, performance. Tabs: Summary, Assets, Transactions, Stats, Reports. | P | An account of type Investment. |
| 6 | Goals | `/goals` | Savings goals funded by accounts and investments (Beta chip). | E | Accounts (and invest assets for investment funding). |
| 7 | Meta > Categories | `/categories` | Categories; mark **Fixed cost**. | E | None. |
| 7 | Meta > Entities | `/entities` | Payees/merchants as entities. | P | None. |
| 7 | Meta > Tags | `/tags` | Free tags on transactions. Event tags (`event:<name>`) appear here. | P | None. |
| 7 | Meta > Rules | `/rules` | "Auto-categorization rules". | E | Categories/entities to assign. |
| 8 | Insights | `/insights` | One month's story: summary, fixed vs flexible, small spends, calendar, where money went, forecast, safe to spend, emergency fund, net-worth change. | E | Transactions; categories; Profile settings for the full set. |
| 9 | Health | `/health` | Monthly checklist of 7 financial-health checks. | E | Per check (see 4.25); each unset check shows "Set up". |
| 10 | Month review | `/review` | Six-step month-end checklist. | E (monthly) | Some data. |
| 11 | Events | `/events` | Birthdays/anniversaries/money dates; gift budgets; paid status. | P | None. |
| 12 | Milestones | `/milestones` | Timeline of achievements. | E | Fills automatically. |
| 13 | Yearly costs | `/yearly-costs` | Spread once-a-year bills monthly into a sinking fund. | E | A savings account chosen as sinking fund (Profile). |
| 14 | Debts | `/debts` | Tabs: People (lent/borrowed) and Loans (EMIs). | E | None. |
| 15 | Retirement | `/retirement` | FIRE-style calculator from your real data. | P | Date of birth + retirement settings in Profile; 3 months of spending history. |
| 16 | Stats | `/stats` (+ `/stats/patrimony`, `/stats/projections`, `/stats/expenses`, `/stats/income`, `/stats/year-by-year`) | Original charts: Net Worth Evolution, Projections, Expenses, Income, Year-By-Year. | P | History. |
| - | (Dashboard card link) | `/salary-plan/:month` (e.g. `/salary-plan/2026-11`) | A confirmed salary plan and its transfer progress. | E | A confirmed plan. |
| - | Profile (top-bar person icon, `button[aria-label="profile"]`; not in the sidebar) | `/profile` | Language, currency, Financial profile, theme, password, tools, Encrypted backups, "If something happens to me", Stats for Nerds. | E | None. |
| - | (button) Open printable version | `/settings/legacy/print` | Print-styled "If something happens to me" file. | E | Legacy entries (optional). |
| - | Sign In / Sign Up | `/auth` | Login; "Try the demo account" shortcut. | - | - |
| - | Recover password | `/recover-password` | OTP e-mail flow. | - | - |
| - | Setup | `/setup` | First-run wizard (Welcome, Identity, Credentials, Done). | - | Fresh install. |

Unknown routes redirect to `/auth`.

---

## 3. Recommended onboarding order ("first week")

| Step | Do this | Where | Why it matters / what it unlocks |
|---|---|---|---|
| 1 | Create one account per real money place (bank, card, UPI Lite, wallet, savings, investment) with the right **Type**. Note the types: Current account, Savings account, Credit, Meal card, Wallet, Investment, Other. | Accounts > Add Account | Everything hangs off accounts. The Type drives defaults: freshness limit, whether it can be earmarked, how credit cards are shown (as amount owed). |
| 2 | Import your history. PhonePe users: Upload PhonePe statement. Others: paste from the bank site. | Transactions > Import Transactions | Fills every chart. PhonePe import maps each payment method to an account once and remembers it; re-uploading overlapping files never creates duplicates. |
| 3 | Create categories (Categories) and a few Rules, then re-run auto-categorise on new imports. | Meta > Categories, Meta > Rules | Uncategorised spending is shown as "Not yet sorted" everywhere and is never budgeted. Rules save the most time. |
| 4 | Sort uncategorised expenses (use the search/filters and "Edit N selected" bulk edit). | Transactions | Needed for Insights, forecast and month review step 2 ("Sort uncategorised spending"). |
| 5 | Mark **Fixed cost** on whole categories (rent, EMI-like, insurance, utilities, school fees). | Meta > Categories | Unlocks: Fixed / Flexible / Not yet sorted card, Safe to spend ("Fixed costs still to come"), Emergency fund meter (months of fixed costs), Fixed-costs health check, forecast, salary plan "Fixed costs" bucket. |
| 6 | Fill the **Financial profile**: Salary category, Salary cut-off day, Savings target (Amount or Percent of income) and Savings account, Sinking-fund account, Emergency fund target (months), Emergency top-up (%), Small-spend cut-off. Retirement fields can wait. | Profile > Financial profile | Salary category + cut-off make a late salary count for the next month. Savings target feeds Savings rate target, Safe to spend, Health. Earmarked accounts feed salary plan, yearly costs, emergency fund. |
| 7 | Tick **Emergency fund** on the account(s) holding your reserve. Pick the **Sinking-fund account** and **Savings account** in Profile (each account can have only one of these roles). | Accounts > edit account; Profile | Unlocks the Emergency fund card and health check. |
| 8 | Do the first **Balance check**: type your real bank balances; fix gaps with "Add missing transaction" or "Write it off". | Accounts > Balance check | Makes balances trustworthy. Saved checks feed the Accounts page, the Health "Up-to-date data" check and review step 3. |
| 9 | Add **Yearly costs** (insurance, fees). Accept suggestions from history. | Yearly costs | Removes shock months from "typical" and sets a monthly set-aside. Needs the sinking-fund account (step 6/7). |
| 10 | Make a budget for this/next month, ideally from **Forecast** ("Create <Month> budget from this forecast"). | Insights (Forecast card) or Budgets | Forecast needs ~3 months of history. |
| 11 | When the salary lands: **Plan this salary** on the Dashboard card. Mark its planned transfers done/matched as they happen. | Dashboard > Salary day | Needs Salary category in Profile. |
| 12 | Enter debts: People entries (lent/borrowed) and Loans with EMIs. | Debts | Keeps loans/lending out of spending; EMI interest-only counts as spending; feeds the "Loan EMIs" health check and net worth. |
| 13 | Add Events (birthdays, rent, card due dates) and accept suggestions. | Events | Dashboard "Upcoming (next 30 days)". |
| 14 | First **month-end review** (1st to 10th of the next month: the Dashboard card appears) and look at **Health**. | Month review, Health | Frozen monthly records start building a history; Milestones fire (streaks need several frozen months). |
| 15 | Optional: Goals (link investments), Retirement, Encrypted backups, "If something happens to me". | Goals, Retirement, Profile | Wealth and safety layers. |

Dependency summary: Accounts -> Transactions -> Categories (+Fixed) -> Profile settings -> Insights/Safe-to-spend/Emergency/Health/Forecast/Salary plan -> Review/Milestones.

---

## 4. Per-feature sections

Selector legend (column "Suggested DAP selector"): `#id`, `[name=...]`, `[aria-label=...]`, `[data-testid=...]` are **existing stable hooks**. Anything written as `text-selector (needs data-tour="xyz")` has no stable hook; the fallback is the visible text/role and the proposed attribute is collected in section 7. MUI renders many controls as generic `div`/`button` without ids, so text fallbacks break when copy or language changes.

Sidebar (applies to every page): menu items have no ids. Fallback `a:has-text("Insights")` etc., needs `data-tour="nav-<name>"` (section 7). On narrow screens the sidebar starts collapsed (icons only, text not rendered) so text selectors fail there.

### GROUP A - Getting started

#### 4.1 Sign in, demo account and first-run Setup

- **What:** Sign In / Sign Up screen (`/auth`), "Try the demo account" shortcut (username `demo`, password `demo`, data resets daily; a "Demo account" / "Daily reset" badge shows in the top bar and password change is blocked: "This feature is not available for demo accounts."). `/setup` is a 4-step wizard on a fresh install: Welcome (preferences), Identity, Credentials, Done ("All done! Now you're ready...").
- **Where:** `/auth`, `/setup`, `/recover-password`. No sidebar.
- **Prereqs/empty:** none. "Sign ups are disabled in the API settings" appears if the server blocks sign-up.
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Username / Email / Password | fields | login card | Credentials | `input[name=...]` - verify in app (not confirmed); text fallback label (needs `data-tour="login-form"`) |
| Sign In / Sign Up | button | login card | Submit; toggled by "Not yet registered?" / "Already registered?" | `button:has-text("Sign In")` (needs `data-tour="login-submit"`) |
| Forgot your password? | link | login card | Goes to Account recovery (OTP by e-mail, "Set a new password") | text link |
| Try the demo account | banner/button | login | Prefills demo credentials ("Username: demo / Password: demo") | text |

- **How to:** 1) Open the app. 2) Sign In, or Sign Up, or use the demo. 3) On a fresh install follow the Setup steps. 4) Land on the Dashboard.
- **Suggested DAP tour (on demand, demo only):** (a) "Welcome" - banner `Demo account` - "This is a demo account; explore freely, it resets daily." trigger: first visit as demo. No other tours here.
- **Tips:** DAP should not run on `/auth` for returning users. Password reset needs the server's e-mail setup.

#### 4.2 Accounts

- **What / why:** Every place money lives. Shows balance, status (Active/Inactive), and **freshness** (Fresh / Stale) so you know which statements to import next. Credit cards show what you owe.
- **Where:** sidebar **Accounts** `/accounts`. Entry points: Dashboard "Needs updating" card (links to Import), Balance check button, review steps.
- **Prereqs / empty state:** none. Empty table text is the generic "No record found"/"No data" view (no dedicated first-time message - see section 7).
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Add Account | button | header right | Opens "Add new account" dialog | `button:has-text("Add Account")` (needs `data-tour="accounts-add"`) |
| Balance check | button | header | Goes to `/accounts/balance-check` | `a[href$="/accounts/balance-check"]` (stable href; or `data-tour="accounts-balance-check"`) |
| Tabs: All / Operating Funds / Debt / Investments / Others | tabs | above table | Filter by account group | `button[role=tab]:has-text("Debt")` (needs `data-tour="accounts-tabs"`) |
| Search | field | above table | Filters rows | `#search` |
| Table columns: Color, Name, Balance, Status, Actions | table | body | Balance; Fresh chip or "Stale · N days"/"Stale · no transactions"; "Checked <date> · matched/adjusted/open" | table (needs `data-tour="accounts-table"`) |
| Edit / Delete | icon buttons | row Actions | `[aria-label="Edit"]`, `[aria-label="Delete"]` (not row-specific; combine with row text) | |
| Dialog: Name | field | dialog | | `[name="name"]` |
| Dialog: Type | select | dialog | Current account / Savings account / Credit / Meal card / Wallet / Investment / Other (Loan accounts are created by Debts > Loans) | `[name="type"]` |
| Dialog: Description | field | dialog | | `[name="description"]` |
| Dialog: Color | select | dialog | Colour in charts | `#color-select` |
| Dialog: Active / Inactive | status toggle | dialog | Inactive accounts are ignored by freshness, emergency fund, net worth | text (needs `data-tour="account-status"`) |
| Dialog: Exclude from budgets | switch | dialog | Transfers *into* this account count as expense in budgets | `[name="exclude_from_budgets"]` |
| Dialog: Mark stale after N days | field | dialog | Blank = type default, 0 = never | `#stale_after_days` |
| Dialog: Emergency fund | switch | dialog | Counts this account towards the emergency fund | `[name="is_emergency_fund"]` |

- **How to (add an account):** 1) Accounts > **Add Account**. 2) Fill **Name**, **Type**, optional **Description**, **Color**. 3) Optionally set **Mark stale after N days** and tick **Emergency fund** (not offered for Investment/Credit/Loan). 4) Submit (the paper-plane button).
- **Suggested DAP tour (when empty / first visit):**
 1. "Start here" - Add Account - "Add one account per bank, card, wallet and UPI Lite you use." (first visit, no accounts)
 2. Type select - "Pick the right type: it sets the stale-data reminder and how cards are shown."
 3. Emergency fund switch - "Tick this on the account holding your safety net." (first time dialog opens)
 4. Table row Fresh/Stale chip - "Stale means it is time to import a statement." (when at least one stale)
 5. Balance check button - "Once a month, compare each account with your bank." (on demand)
- **How it works (business rules)**
  - Freshness limits by type (days since last transaction): Current account 7, Wallet 7, Meal card 7, Savings 30, Credit 35, Investment 45, Other 45, Loan 0 (never). Per-account override: blank = default, `0` = never. A **new transaction** (either side of the account) is the only thing that makes an account Fresh; a balance check does not. Inactive accounts are never flagged. No transactions at all = Stale ("Stale · no transactions") unless the limit is "never".
  - Days are whole days since the last transaction date.
  - Credit cards and loans store the amount owed as a negative balance; the UI compares them as "amount owed" in Balance check.
  - **Earmarks:** an account can hold only **one** of: Emergency fund, Sinking-fund account, Savings (target) account. Retirement ticks may overlap the savings account but never emergency/sinking. **Investment, Credit and Loan accounts can never be earmarked** (this is wider than the spec, which only excluded investing accounts). Errors users can see: "An investment account cannot be an emergency fund." / "A credit card or loan account cannot be an emergency fund." / "This account is already the <role> account; an account can hold only one earmarked role." / "An investment, credit card or loan account cannot be earmarked (...). Remove the earmark first."
  - A loan's account cannot be deleted directly: "This account belongs to a loan. Delete the loan instead." Deleting an account removes its planned transfers (their salary-plan buckets become Skipped) and its legacy-file entry.
- **Tips / FAQ:** *Why is my card balance negative?* It is what you owe. *Why is a savings account Stale after 30 days?* It had no transactions; raise the limit or set 0 if it rarely moves.

#### 4.3 Import Transactions (paste and PhonePe)

- **What / why:** Get statements into MyFin. Two paths: copy-paste from a bank site, or upload a PhonePe CSV that can cover several payment methods at once.
- **Where:** Transactions > **Import Transactions** button or Dashboard "Needs updating" > **Import transactions**; route `/transactions/import`. Title "Import Transactions", strapline "Import your transactions in 3 steps".
- **Prereqs:** at least one account (paste: pick the account; PhonePe: map each payment method to an account).
- **Steps shown (stepper):** Paste path = *Import from clipboard* > *Assign columns* > *Final adjustments* > *Done!*. PhonePe path = *Upload* > *Match accounts* > *Final adjustments* > *Done!*.
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Continue (clipboard) | button | step 1 | Reads the clipboard (browser asks permission: "To be able to complete this task, you need to accept the clipboard reading permission prompt!") | `button:has-text("Continue")` (needs `data-tour="import-paste"`) |
| Upload PhonePe statement | button | step 1 | File picker for `.csv` | text (needs `data-tour="import-phonepe-upload"`) |
| Column selects ("Ignore", Date, Description, Amount, Credit, Debit, Type) | selects | Assign columns | Map pasted columns | `#select-0`, `#select-1`... (index ids exist) |
| From account | select | Assign columns | Account the rows belong to | `#account` |
| Date format chip ("Date format detected: ..." / "Ambiguous date format - click to select") | chip + dialog "Select date format" | Assign columns | Resolves D/M vs M/D | text (needs `data-tour="import-date-format"`) |
| Match accounts table (PhonePe payment method / Description / Account) | table + selects | PhonePe step 2 | Maps instruments (e.g. "UPI Lite", masked card numbers) to accounts; remembered next time | `#account-<instrumentKey>` |
| Review table (Date, Flow, Description, Value, Category, Entity, Essential, accounts From/To, row checkbox) | editable table | Final adjustments | Fix any row, untick rows to skip | table (needs `data-tour="import-review"`) |
| Import | button | Final adjustments | Opens "Complete import?" dialog showing "Imported transactions: N" and "New balance for account ..." | `button:has-text("Import")` (needs `data-tour="import-confirm"`) |
| "N transactions were already imported and have been skipped." | notice | review | PhonePe duplicates | text |
| See Transactions | button | Done | Goes to the list | text |

- **How to (PhonePe):** 1) Download the CSV in the PhonePe app. 2) Import Transactions > **Upload PhonePe statement** and choose the file. 3) In **Match accounts**, choose a MyFin account for each payment method; Continue (skipped automatically when every method is already remembered). 4) In **Final adjustments**, correct categories/accounts, untick rows you don't want. 5) **Import** > confirm. 6) **See Transactions**.
- **How to (paste):** 1) On the bank site select all transactions and copy. 2) **Continue**, allow clipboard access. 3) Assign columns (Date, Description, Amount or Credit/Debit), pick **From account**, resolve the date format if asked. 4) Review, **Import**.
- **Suggested DAP tour (first visit / when no transactions):** 1) Upload PhonePe statement - "Upload your monthly PhonePe CSV; repeat uploads are safe." 2) Match accounts - "Tell MyFin which account each payment method is. We remember it." 3) Review table - "Check the categories - anything uncategorised shows up as 'Not yet sorted'." 4) Import - "Nothing is saved until you press Import."
- **How it works (business rules)**
  - **PhonePe CSV:** rows before the header (`Date,Time,Transaction Details,...`) and the footer are skipped; "Sept" month spelling is accepted; times are read as IST. A file without the expected header is rejected: "This doesn't look like a PhonePe statement CSV." Very large files: "This file is too large to import." Nothing new: "No new transactions in this statement."
  - **Classification (in order):** (1) DEBIT "Add money UPI Lite" = **transfer** instrument -> UPI Lite; (2) DEBIT starting "Credit card bill paid <masked>" = **transfer** instrument -> card account (the card number key is mapped like any other; two keys may map to one account); (3) any CREDIT = **income** into the instrument's account; (4) any other DEBIT = **expense**. Payments between your own accounts via PhonePe ("Paid to <own name>" + "Received from <own name>") are *not* detected - they come in as an expense and an income: untick or fix them in review.
  - **No duplicates:** each row stores `phonepe:<Transaction ID>:<DEBIT|CREDIT>`; rows whose id already exists are skipped, including re-uploads of overlapping date ranges and double clicks. A refund that reuses an id is kept because direction is part of the key.
  - Your **Rules** run on every imported row (category, entity, essential, accounts). Descriptions are trimmed/space-collapsed; emoji kept.
  - Amounts stay decimal rupees to the end. A mapped account that was later deleted is treated as unmapped.
  - After import, a **planned transfer** may be offered a match ("Mark as matched?" dialog, see 4.13). Never applied silently.
- **Tips / FAQ:** *Can I import the same month twice?* Yes for PhonePe. For paste, MyFin cannot de-duplicate: avoid overlapping pastes (only PhonePe rows carry an external id; verify in app whether the paste flow warns about duplicates). *Why are my UPI Lite top-ups not spending?* They are transfers.

#### 4.4 Categories (including the Fixed cost switch)

- **What / why:** Categories group income and expenses. The **Fixed cost** flag marks whole categories as committed costs; it powers most of the new money-planning features.
- **Where:** sidebar **Meta > Categories** `/categories` (strapline "Manage your categories list"; page title "Category").
- **Prereqs/empty:** none.
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Add Category | button | header | Opens "Add new category" dialog | text (needs `data-tour="categories-add"`) |
| Search | field | above table | filter | `#search` |
| Dialog fields: Name, Description, Exclude from budgets | fields | dialog | | `#name`, `#description`, `[name="exclude_from_budgets"]`, `#color-select`, `#icon-select` |
| Columns: Color, Name, Description, Fixed cost, Status, Actions | table | body | "Fixed" chip shown when flagged | table (needs `data-tour="categories-table"`) |
| Fixed cost | switch | in the add/edit category dialog (tooltip: "Fixed costs (rent, insurance, EMIs) recur regardless of what you do. Insights splits spending into fixed, flexible and not yet sorted.") | Off by default. When on, the category is a fixed cost | `[name="is_fixed"]` |
| Edit / Delete | icon buttons | row | `[aria-label="Edit"]`, `[aria-label="Delete"]` | |

- **How to:** Categories > **Add Category** (or Edit) > fill name/colour > switch **Fixed cost** on for rent, insurance, EMIs, utilities > save.
- **Suggested DAP tour (after first import):** 1) Add Category - "Create the categories you spend on." 2) Fixed cost switch - "Switch this on for bills you cannot skip. It unlocks Safe to spend and the emergency fund meter." 3) Fixed chip column - "See at a glance which categories are fixed."
- **How it works:** Fixed is per **whole category** (no partial). Expense categories flagged Fixed = **fixed**; other categorised expenses = **flexible**; expenses with no category = **Not yet sorted** (a third bucket, never silently flexible). Income and transfers are never in the split. A category may be excluded from budgets ("Excluded from budgets" chip). The balance-write-off category "Balance adjustment" (type M, excluded from budgets) is auto-created on the first write-off. The per-transaction **Essential** flag is a *separate* older concept (used by Budgets' essential figures); Essential and Fixed can disagree and that is intended.

#### 4.5 Rules ("Auto-categorization rules")

- **What:** If a transaction's description/amount/accounts match conditions, assign a category/entity/accounts automatically.
- **Where:** **Meta > Rules** `/rules`, strapline "Automate the categorization of your transactions". Button **Add Rule**; dialog sections "Conditions" and "Result" ("The values to assign when the rule is triggered"): operators Ignore / Contains / Does not contain / Equals / Not equals; assign Category, Entity, From/To account, Essential (Yes/No).
- **Selectors:** none stable except `#search` (needs `data-tour="rules-add"`, `data-tour="rule-conditions"`, `data-tour="rule-result"`).
- **Tour:** 1) Add Rule - "Teach MyFin once, save clicks forever." 2) Conditions - "Match on text like 'SWIGGY'." 3) Result - "Pick what to assign."
- **How it works:** runs on imports, and via the **Auto-Categorize** button in the add-transaction dialog. Rules are what make "Not yet sorted" shrink; PhonePe import runs the same rule engine.

#### 4.6 Profile > Financial profile (the settings home)

- **What / why:** One form holding every number the planning features need. Saved with **Save** ("Financial profile saved").
- **Where:** Profile page (`/profile`, top-bar profile icon), accordion section **Financial profile** (strapline "Used to place a late salary in the right month"; header id `financial-profile-header`).
- **Prereqs:** categories and accounts must exist for the pickers.
- **Key elements (all have ids)**

| Element | Type | What it does | Selector |
|---|---|---|---|
| Salary category (default "Not set") | select | The income category that is your salary | `#salary-category` |
| Salary cut-off day | number 1-28 | "A salary received on or after this day (1-28) counts towards the next month" (default 25) | `#salary-cutoff-day` |
| Savings target: Amount / Percent of income | toggle | Mode of the target | text (needs `data-tour="profile-savings-mode"`) |
| Savings target value | number | "What you aim to set aside each month" | `#savings-target-value` |
| Savings account | select | Where savings transfers go | `#savings-target-account` |
| Sinking-fund account | select | "Where money for yearly costs is set aside" | `#sinking-fund-account` |
| Emergency fund target (months) | number 1-24 | "Months of typical spending to keep in reserve (1-24)" (default 6) | `#emergency-fund-months` |
| Emergency top-up (%) | number 0-100 | "Share of the monthly surplus to add to the emergency fund (0-100)" (default 10) | `#emergency-topup-percent` |
| Small-spend cut-off | number | "Payments below this amount count as small spends on the Insights page" (default 200) | `#small-spend-cutoff` |
| Retirement block: Date of birth (YYYY-MM-DD), Retirement age, Expected return (%/year), Inflation (%/year), Safe withdrawal rate (%), Spending to cover in retirement (All spending / Fixed costs only), Family support (per month), Family support (years), Accounts counted for retirement, Investments counted for retirement | fields | Inputs for Retirement page | `#date-of-birth`, `#retirement-age`, `#expected-return-pct`, `#inflation-pct`, `#swr-pct`, `[aria-label="Spending to cover in retirement"]`, `#family-support-monthly`, `#family-support-years`, `#retirement-accounts`, `#retirement-assets` |
| Save | button | Saves | `button:has-text("Save")` (needs `data-tour="profile-financial-save"`) |

- **How to:** Profile > open **Financial profile** > choose **Salary category** and **Salary cut-off day** > set **Savings target** (Amount or Percent of income) and **Savings account** > choose **Sinking-fund account** > set **Emergency fund target (months)** > **Save**. Errors read from the API, e.g. "salary_cutoff_day must be an integer between 1 and 28.", "emergency_fund_target_months must be an integer between 1 and 24.", "emergency_topup_percent must be an integer between 0 and 100.", "small_spend_cutoff must be greater than 0 and at most 100000.", "A percent savings target must be an integer between 0 and 100.", "date_of_birth must be a real past date as YYYY-MM-DD.", "retirement_age must be an integer up to 80." and "retirement_age must be above your current age.", plus the earmark-conflict messages in 4.2.
- **Suggested DAP tour (when `salary category` is Not set, or from Getting-started checklist):** 1) Section header - "Set these once; many cards depend on them." 2) Salary category - "Pick the category your salary lands in." 3) Cut-off day - "A salary that arrives late in the month is counted for next month." 4) Savings target + account - "Choose how much to save and where." 5) Sinking-fund account - "Pick a savings account for yearly bills." 6) Save.
- **How it works:** defaults: cut-off 25, emergency target 6 months, top-up 10 %, small-spend ₹200, retirement age 60, return/inflation/SWR 10/6/3.5 %. Savings target "percent" must be a whole number 0-100; "amount" is a currency amount per month. Retirement age is only checked against current age when you change the age or date of birth. Earmark rules as in 4.2 apply to Savings account and Sinking-fund account (inactive accounts are ignored by the features that use them).

### GROUP B - Day-to-day

#### 4.7 Dashboard

- **What / why:** The home page. Cards at the top tell you what needs attention; charts below summarise the month.
- **Where:** sidebar **Dashboard** `/dashboard`. Cards link to Import, Salary plan, Review, Events, Health, Insights, Milestones.
- **Layout, top to bottom (each card hides itself when it has nothing to say):**
 1. Milestone banner "Milestone reached" (Dismiss / "See all milestones")
 2. **Savings rate** card (headline + 12-month sparkline)
 3. Month picker (**Month**, month/year) and a "Last update" date (tooltip "Last update", hidden on small screens)
 4. **Needs updating** - "These accounts have no recent transactions"
 5. **Salary day** - "Your salary of X has landed. Plan how to split it for <month>." / "Your plan for <month> is set." (shown only for a recent salary or confirmed plan)
 6. **<Month> review: N of 6 done** (only 1st-10th of the month, for the previous month; hidden when complete or no data)
 7. **Upcoming (next 30 days)** with "All events"
 8. **Health N of M** (or "Set up your financial health checks")
 9. **Safe to spend**
 10. **Emergency fund**
 11. Charts: **Monthly Overview** (Current vs Remaining against the budget), **Monthly savings** (last 6 months of budget balance), **Income Distribution**, **Expense Distribution** (top 5 categories), **Investment Portfolio**, **Debt Distribution** (top 5 accounts).
- **Prereqs / empty states:** works empty; charts show "No data to display". Only *Savings rate*, *Safe to spend* and *Emergency fund* always render (with their own "not set up" messages, see 4.15-4.17).
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Month | date picker (month/year) | top-left | Drives the budget/distribution charts only (not the cards) | `button[aria-label^="Choose date"]` MUI default; needs `data-tour="dashboard-month"` |
| Needs updating > Import transactions | button | card | to `/transactions/import` | `a[href$="/transactions/import"]` |
| Plan this salary / View plan | buttons | Salary day card | opens plan dialog / `/salary-plan/<YYYY-MM>` | `button:has-text("Plan this salary")` (needs `data-tour="salary-plan-cta"`) |
| Open the review | button | review card | to `/review` | `a[href$="/review"]` |
| See details | button | Health card | to `/health` | `a[href$="/health"]` |
| "See how this is worked out" | button | Safe to spend | opens breakdown dialog | text (needs `data-tour="sts-details"`) |
| Dismiss / See all milestones | button/link | banner | dismiss; to `/milestones` | `a[href$="/milestones"]` |
| Card containers | cards | page | | none (needs `data-tour="dash-<card>"` e.g. `dash-savings-rate`, see section 7) |

- **Suggested DAP tour (first visit with data):** 1) Savings rate card - "Your headline number: how much of your income you kept." 2) Needs updating - "Accounts with old data show up here." 3) Safe to spend - "What you can still spend this month after bills and savings." 4) Emergency fund - "How many months of bills your reserve covers." 5) Month picker - "Change the month for the charts." (first visit)
- **How it works:** cards are covered under 4.13 (Salary day), 4.15-4.17, 4.24-4.27. The chart month is independent of the cards; cards always describe the current month (review: the previous month).
- **FAQ:** *Why no Salary day card?* A plan card shows only when a salary-category income landed in the last 40 days for the current/next effective month and has no plan yet, or when a plan exists. *Why no review card?* Only 1st-10th, only for the previous month, only if incomplete.

#### 4.8 Transactions

- **What / why:** The ledger. Add, edit, split, merge, bulk-edit, filter; every figure on Insights drills down here.
- **Where:** sidebar **Transactions** `/transactions` (strapline "All your transactions live here"). Drill-down links from Insights/Review/Health arrive with filters in the URL (shown as removable chips).
- **Prereqs:** at least one account.
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Add Transaction | button | header | Opens the add dialog | text (needs `data-tour="trx-add"`) |
| Import Transactions | button | header | to import | text (needs `data-tour="trx-import"`) |
| Search | field | toolbar | text search | `#search` |
| Filter chips All / Debit / Credit / Transfer / Planned | chips | toolbar | Type filter; **Planned** merges in planned (not yet real) transfers | text (needs `data-tour="trx-filters"`) |
| Drill-down chips (date range, "Uncategorised", "Write-offs", "Below <amount>", category/account fallbacks, cost kind, payee, day) | removable chips | above table | Active URL filters from Insights | text (needs `data-tour="trx-filter-chips"`) |
| Select all N matching / Clear / Edit N selected | links/buttons | selection bar | Bulk edit every matching row; dialog "Edit N transactions": Category, Entity, Essential ("Leave unchanged" default), then "Update N" -> "Update N transactions?" confirmation | text (needs `data-tour="trx-bulk-bar"`) |
| Row chips: **Adjustment**, debt chip ("Linked to a debt: not counted as spending or income. Click to open Debts."), **Yearly cost** (with unlink), "counted in <month>", **Planned** | chips | row | explain why a row is special | text |
| Row actions: Edit, "Mark as loan to / from a person...", "Link to event...", Delete | icon buttons | Actions column | | `[aria-label="Edit"]`, `[aria-label="Mark as loan to / from a person…"]`, `[aria-label="Link to event…"]`, `[aria-label="Delete"]` |
| Planned row actions: **Mark done**, **Skip**, **Match...** | buttons | planned rows | see 4.13 | text (needs `data-tour="planned-actions"`) |
| Dialog: Type of transaction (Expense/Transfer/Income) | toggle | add/edit dialog | | `[aria-label="Type of transaction"]` |
| Dialog: Value, Date of transaction, Description, Auto-Categorize, From account, To account, Category, Entity, Tags, Essential | fields | dialog | | `#description`, `#account_from`, `#account_to`, `#category`, `#entity`, `#tags`, `[name="date"]`, `[name="essential"]`, `[aria-label="Auto-Categorize"]` |
| Split Transaction / Merge Transactions | chips/buttons | dialog | Split one payment into several (`split_*` fields) | `#split_amount` etc. |

- **How to:** *Add:* **Add Transaction** > choose type > Value, date, description > accounts (From for expense, To for income, both for transfer) > category/entity/tags > submit. *Bulk categorise:* search or follow an Insights drill-down > tick rows (or **Select all N matching**) > **Edit N selected** > choose Category > **Update N** > confirm.
- **Suggested DAP tour (first visit with rows):** 1) Filter chips - "Narrow by type, or see planned transfers." 2) Search - "Search any description." 3) Row checkbox + selection bar - "Select many rows and categorise them in one go." 4) Drill-down chips - "Opened from Insights? These chips show the filter. Click x to remove." (only when URL has filters) 5) Add Transaction.
- **How it works**
  - **Counted rows** (what Insights treats as income/spending): type Expense or Income, not an Adjustment, and not debt principal. Excluded everywhere: **transfers**, **balance adjustments (write-offs)**, **planned rows**, **lent/borrowed amounts and repayments, loan disbursements, EMI principal**. An EMI's **interest** row *does* count.
  - **Month filter uses the effective month:** a salary-category income dated on/after the cut-off day shows "counted in <next month>" and is listed under the next month, so drill-down equals the figure.
  - Editing/deleting restrictions: a row a lent/borrowed entry started from cannot be deleted ("Delete or unlink the debt entry first."); a loan opening balance cannot be deleted alone ("This is a loan's opening balance. Delete the loan instead."); a debt-linked row's type cannot change ("This transaction is linked to a debt. Unlink it from the debt first to change its type."); amount/date/accounts of a matched EMI's interest/principal rows are locked until you **Unpay** the EMI. Editing a repayment/origin row updates its debt entry. Deleting a row that backed a repayment removes that repayment; deleting a row linked to an event removes the link (a money event goes back to pending); deleting a yearly-cost-linked row just removes the row.
  - A planned transfer matching a new real row (same accounts, within ₹1, within 7 days) prompts "Mark as matched?" after a manual add or import. "Not now" leaves it.
  - Linking: a row is either a yearly cost **or** a debt, never both ("This transaction is linked to a yearly cost. Unlink it from the yearly cost first."), and a salary-plan's salary row cannot be linked to a debt.
- **FAQ:** *Why does a transaction not appear in Insights?* It is a transfer, write-off, planned, or debt principal. *Why is my Planned row greyed?* It is not a real transaction yet and does not affect balances.

#### 4.9 Balance check

- **What / why:** Once a month, compare each account to your bank app and fix gaps on the spot.
- **Where:** Accounts > **Balance check**, `/accounts/balance-check` (strapline "Compare each account with your bank, then fix the gaps"). Also linked from review step "Reconcile balances".
- **Prereqs:** active accounts. Inactive accounts are not listed.
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Table: Name, MyFin balance, Real balance | table | body | One row per active account. For credit cards the column is "Amount owed" | table (needs `data-tour="bc-table"`) |
| Real balance (input) | field | row | Type your bank figure; the row shows "Matches ✓" or "off by X" live | `input` in row (needs `data-tour="bc-real-input"`) |
| Save check | button | row | Stores the check ("Check saved") | text (needs `data-tour="bc-save"`) |
| Add missing transaction | button | row (mismatch) | Opens add-transaction dialog with account, amount and direction prefilled | text (needs `data-tour="bc-add-missing"`) |
| Write it off | button | row (mismatch) | Confirmation "Write off the gap on <account>?" - "This adds an adjustment of X so MyFin matches your real balance. Adjustments are not counted as spending or income." Success toast "Gap written off" | text (needs `data-tour="bc-writeoff"`) |

- **How to:** 1) Open Balance check. 2) Type the real balance per account (cards: amount owed). 3) Mismatch? Choose **Add missing transaction** (when you know what is missing) or **Write it off** (unknown small gap). 4) **Save check** for each account.
- **Suggested DAP tour (on demand / from checklist):** 1) MyFin balance column - "This is what MyFin thinks you have." 2) Real balance - "Type what your bank shows. Credit cards: type the amount you owe." 3) Matches / off by - "Green tick means all good." 4) Add missing transaction - "Found the missing payment? Add it here." 5) Write it off - "Unexplained small gap? Write it off. It will not count as spending."
- **How it works:** comparison is exact to the cent: `gap = real - MyFin` (cards/loans compared as amount owed). Result stored: **matched** (gap 0) or **open**; after a write-off the check is stored as **adjusted**. The Accounts page shows "Checked <date> · matched/adjusted/open". **Write-off** creates one adjustment transaction **dated now**, category **"Balance adjustment"** (created on first use, excluded from budgets), description "Reconciliation write-off", income if MyFin was too low and expense if too high (cards: direction judged on the raw negative balance). Write-offs are flagged adjustments: excluded from Insights income/spending, shown as "Write-offs" in the net-worth card and with the **Adjustment** chip. A write-off with no gap fails with "Nothing to write off: the balances already match." Concurrent write-offs on one account are serialised.
- **FAQ:** *Does a balance check make an account Fresh?* No. *Do I have to check every account?* The Health "Up-to-date data" check and review step "Reconcile balances" look at accounts with freshness tracking (not "never").

### GROUP C - Planning

#### 4.10 Budgets (original page, extended by Forecast)

- **What:** A budget per month with planned income/expense per category; compare with actuals. (Original MyFin feature; briefer here.)
- **Where:** sidebar **Budgets** `/budgets` (strapline "Plan your future here"); **Add Budget** goes to `/budget/new`; a row opens `/budget/:id`; **Matrix view** `/budgets/matrix` (Beta).
- **Key elements:** list: **Add Budget**, **Only Opened** switch, **Matrix view** (aria-label "Matrix view"), Search `#search`, rows with **See More** / **Delete** (aria-labels). Details: Month picker (aria-label "Month", with **Previous**/**Next**), **Monthly budget**, per-category **Estimated** / **Current** inputs (aria-labels `"<category>: Estimated"`, `"<category>: Current"`), **Breakdown** (itemised plan: `"<category>: Breakdown"`), **Budget actions** menu (aria-label "Budget actions") with **Clone another budget** and **Matrix view**; summary board "Budget balance", "Net result for <month>", "Savings: <rate>"; dialog "Close budget with unsaved changes?" (Keep editing / Discard and close / Save and close); clone dialog "Clone a previous month" > **Clone budget**. Search boxes "Search expense categories..." / "Search income categories...".
- **Selectors:** many aria-labels exist (above). Buttons **Add Budget** etc. need `data-tour="budgets-add"`.
- **Tour (3 steps, first budget):** 1) Add Budget - "Create a plan for the month, or start from the forecast on Insights." 2) Estimated - "Type what you plan per category." 3) Budget balance - "Plan minus actual, live."
- **How it works (rules that interact with the new features):** the Forecast "Create <Month> budget from this forecast" writes planned amounts into the normal budget model (planned expense per category = forecast; planned income = expected income). Categories **with a breakdown** or **inactive** are never changed by the forecast ("Not changed (they have a breakdown or are inactive): ..."). Review step 6 ("Plan next month's budget") is done when a budget exists for next month. Budget actuals, Stats and Dashboard charts use the **original** rules and do not exclude write-offs/debt principal the way Insights does (known difference, kept to ease upstream merges).

#### 4.11 Goals

- **What / why:** Savings goals with a target amount, optional due date and priority, funded from accounts and (new) a share of investments.
- **Where:** sidebar **Goals** `/goals` (strapline "Track your financial goals here", Beta chip). Button **New Goal**.
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| New Goal | button | header | Dialog | text (needs `data-tour="goals-new"`) |
| Summary tiles: In progress, Completed, Underfunded, Unallocated funding | cards | top | counts and money available to allocate | none (needs `data-tour="goals-summary"`) |
| Goal views tabs: In progress / Archived / All, "Underfunded only", Sort by, "Search goals..." | tabs/controls | list | | `[aria-label="Goal views"]` |
| Goal card/rows: name, Priority chip, progress bar "of", due date, Edit (aria-label "Edit <goal name>") | cards | list | | `[aria-label^="Edit "]` |
| Dialog: Name, Target Amount, Priority, Description, Set due date / Due Date, Active/Archived | fields | dialog | "Higher numbers are funded first. For example, priority 100 is processed before priority 10." | text/`[aria-label="Higher numbers are funded first..."]` |
| Dialog: **Funding Accounts** (Account, Type Fixed Amount/Percentage, Amount/Percentage, **Add Account**) | section | dialog | Which accounts fund the goal | text (needs `data-tour="goal-funding-accounts"`) |
| Dialog: **Investments** (Investment, Fixed/Percentage, **Add investment**) | section | dialog | "Count a share of your investments towards this goal" | text (needs `data-tour="goal-investments"`) |
| Delete Goal | button | dialog | irreversible | text |

- **How to:** Goals > **New Goal** > Name, Target Amount, Priority, optional Due Date > under **Funding Accounts** pick accounts (percentage or fixed amount) > under **Investments** pick assets > **Add**.
- **Suggested DAP tour (first visit / empty "No goals in progress"):** 1) New Goal - "What are you saving for?" 2) Priority - "Higher numbers get money first." 3) Funding Accounts - "Which accounts count towards it?" 4) Investments - "Count part of an investment at its market value." 5) Unallocated funding tile - "Money not yet assigned to any goal."
- **How it works**
  - Funding = account-based funding + the allocated share of each linked asset's **current market value** (value x percentage, or the fixed amount capped by the asset's value). Accounts and assets are walked in **priority order, higher number first**; if an asset's value drops below the sum of fixed allocations, the lowest priorities lose first. Archived goals still hold their share.
  - One asset can be split across goals; limits: percentage 0-100 and not more than what is left ("Only N% of this investment is left"), amounts positive and not above what is left ("Amount exceeds what is left of this investment") nor above the goal target ("Amount cannot exceed the goal target"). The check applies when a link is added or an amount raised; a later value drop does not block saving.
  - **On track:** shown as "<funded> of <amount> · on track for <date> at your current SIP" or "... behind for ..." when the goal has a due date. SIP = average monthly **buys** of the linked assets over the last 6 full IST months. Projection = (current funding grown monthly at the expected return from the Financial profile, default 10 %/yr) + SIP annuity vs the target. Past due date: on track only if already fully funded.
  - **Fully funded** (funding >= amount, within half a paisa) is what fires the "Goal fully funded" milestone.
  - Goals and retirement may use the same accounts/assets, but neither may use emergency or sinking accounts (earmark rule).

#### 4.12 Yearly costs

- **What / why:** Spread once-a-year bills (insurance, fees, renewals) into a monthly set-aside saved in a real savings account (the "sinking fund") so no month is a shock.
- **Where:** sidebar **Yearly costs** `/yearly-costs` (strapline "Once-a-year bills, spread over the months into a sinking-fund account."). Linked from Health ("Yearly costs" check) and the Salary plan.
- **Prereqs / empty states:** none listed yet: "No yearly costs yet." and status "Add your yearly costs to see how much to set aside each month."; with costs but no sinking-fund account: "Pick a sinking-fund account in Settings to track this. Set aside X a month."
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Sinking fund status | card | top | "On track. Keep setting aside X a month." / "Behind by X. Transfer Y this month." / "<account> holds X; it should hold Z by now." / "Coming up: ..." | text (needs `data-tour="yc-status"`) |
| Suggested from your history | card | middle | "Big one-time payments that look like yearly bills." with **Add** / **Ignore** | text (needs `data-tour="yc-suggestions"`) |
| Your yearly costs | list | bottom | rows with **Link payments**, **Edit**, **Delete** | `[aria-label="Edit"]` etc. (needs `data-tour="yc-list"`) |
| Add yearly cost | button | list header | Dialog: Name, Yearly amount, Due month, Category | text (needs `data-tour="yc-add"`) |
| Link payments | button | row | Dialog "Link payments to <name>": past payments from the last 13 months; **Link** | text |

- **How to:** 1) Pick the sinking-fund account in Profile. 2) **Add yearly cost** (name, amount, due month, category) or **Add** a suggestion. 3) Transfer the suggested monthly amount into the sinking-fund account. 4) When the bill is paid, **Link payments** so it is not counted in your typical month.
- **Suggested DAP tour (when empty):** 1) Add yearly cost - "Add each once-a-year bill." 2) Suggested - "We found big payments that look yearly; add the real ones." 3) Status card - "See if your fund is on track." 4) Link payments - "Link the real payment so it doesn't distort your typical month."
- **How it works**
  - Monthly set-aside per cost = amount / 12; total = sum of active costs / 12 (rounded to the cent).
  - **Should have by now** = sum over costs of amount x ((current month - due month + 12) mod 12) / 12. In the due month the target resets to 0. **Behind by** = max(0, should have - fund account's real balance) (no account: should-have itself). **Transfer this month to catch up** = behind + monthly total. **On track** = an account exists and behind = 0. Upcoming = costs due this month or in the next 2 months.
  - Only **yearly** costs (no 6-monthly). Due month 1-12 else "due_month must be between 1 and 12." Category must be yours.
  - **Suggestions:** an expense in the last 13 months of at least ₹5,000 whose payee had **no** payment in the 10 months before it and that is not already on the list or ignored (dismissals are remembered).
  - **Linked payments** (explicit link, expenses only) leave the **typical month** and Safe-to-spend "spent so far" (the sinking fund covers them). Deleting a yearly cost keeps and unlinks the payments. The Forecast adds yearly costs due in the target month back **once** in their category.
  - The sinking-fund account cannot be an Investment/Credit/Loan account, nor the Emergency-fund or savings-target account.

#### 4.13 Salary plan (Dashboard card, dialog, view, planned transfers)

- **What / why:** When salary lands, MyFin proposes how to split it into buckets and creates the savings transfers as **planned transactions** you tick off when they really happen.
- **Where:** Dashboard card **Salary day**; dialog **Plan this salary**; view `/salary-plan/<YYYY-MM>` ("Salary plan for <month>"); planned rows in Transactions with the **Planned** chip/filter.
- **Prereqs:** **Salary category** in Profile (see 4.6). Without it no card appears. Ideally also emergency accounts, a sinking-fund account and a savings account (a bucket without an account is "No account (not tracked)").
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Salary day card: "Your salary of X has landed. Plan how to split it for <month>." | card | Dashboard | | text (needs `data-tour="dash-salary-plan"`) |
| Plan this salary | button | card | Opens dialog | text (needs `data-tour="salary-plan-cta"`) |
| Dialog "Plan this salary" - bucket rows: Fixed costs, Yearly set-aside, Emergency top-up, Savings; each with amount input and **Transfer to** (account) | dialog | | Edit amounts/accounts | `[data-testid="salary-plan-free"]` exists only for the "Free to spend" value; rest needs `data-tour="salary-plan-bucket-<name>"` |
| Free to spend | computed row | dialog | "Free to spend is based on this salary: the salary minus the other buckets." | `[data-testid="salary-plan-free"]` |
| Confirm plan | button | dialog | Saves; creates planned transfers; goes to the view | text (needs `data-tour="salary-plan-confirm"`) |
| View: columns Bucket, Amount, Transfer to, Status (Not tracked / Planned / Done / Skipped / Overdue chip); "N of M transfers done"; **See planned transfers** | page | `/salary-plan/:month` | | text (needs `data-tour="salary-plan-table"`) |
| Planned row actions **Mark done** / **Skip** / **Match...** | buttons | Transactions, Planned filter | | text |
| "Mark as matched?" dialog (**Mark as matched** / **Not now**) | dialog | after add/import | | text |

- **How to:** 1) When the **Salary day** card appears click **Plan this salary**. 2) Adjust amounts and **Transfer to** accounts. 3) **Confirm plan**. 4) When you make a transfer in your bank, import/add it - accept "Mark as matched?", or in Transactions (Planned chip) use **Mark done**, **Match...** or **Skip**.
- **Suggested DAP tour (when the card first appears):** 1) Salary day card - "Salary landed - let's split it." 2) Buckets - "Fixed costs stay in your salary account; the other buckets become transfers." 3) Free to spend - "What is left after everything else." 4) Confirm plan - "These become planned transfers; they do not change balances until done." 5) View page status - "Track which transfers have happened."
- **How it works**
  - **Trigger:** only for the current effective month or later: today's IST month, or next month once a salary-category income dated on/after this month's cut-off has landed. Among salary incomes of the last **40 days**, the earliest one in such a month **without a plan** gets the proposal; older unplanned months are ignored. One plan per month; a bonus or second salary in the same month does not trigger another. Write-offs and money borrowed/repaid are not salary. A salary-plan's salary row cannot be linked to a debt.
  - **Proposed split (all editable):** *Fixed costs* = typical monthly fixed (stays in the salary account, no transfer); *Yearly set-aside* = total yearly/12 -> sinking-fund account; *Emergency top-up* = only while below target: min(gap to target, top-up % **of this salary**); *Savings* = amount, or percent **of this salary**; *Free to spend* = salary - fixed - yearly - emergency - savings (may be negative).
  - **Confirm** creates **planned transactions** for yearly/emergency/savings (stored separately from real transactions: no effect on balances, Insights, safe-to-spend, emergency fund, etc.). Validation: salary must be an income; month must be the salary's effective month; amounts >= 0; buckets valid; target accounts must be yours, active, not Investment, not the account the salary was paid into, and not holding a conflicting earmark. Errors: "A salary plan already exists for this month." ("Could not save the plan. A plan may already exist for this month.")
  - **Resolving a planned row:** *Mark done* turns it into a real transaction dated min(planned date, today) and balances update; *Match...* / the "Mark as matched?" prompt keeps the real transaction and deletes the planned row; *Skip* removes it. Auto-suggested match = same type/accounts, amount within **₹1**, date within **7 days**; a real transaction can stand for only one planned row ("This transaction is already recorded for another planned transfer"; "This transaction does not match the planned one"). A category deleted since planning leaves the new row uncategorised.
  - **Overdue:** a still-planned row more than **15 days** past its date is flagged Overdue in the plan view ("Some planned transfers are more than 15 days overdue.") only.
  - **Safe to spend interplay:** once a plan is confirmed, its bucket amounts are the month's targets (settings are ignored for that month); a **Skipped** bucket is not reserved (0); money already transferred still counts. Deleting an account marks its buckets Skipped.
  - **Code vs spec:** spec first suggested a `status` column on transactions; the shipped design uses a separate `planned_transactions` table, merged into Transactions only when the **Planned** chip is on.
- **FAQ:** *Why did I not get the card?* No salary category, salary older than 40 days, plan already exists, or the salary belongs to a past month.

#### 4.14 Forecast (card on Insights) - next month's spending, to a budget

- **What / why:** Predicts a month's spending per category and turns it into a budget in one click.
- **Where:** Insights page, card **Forecast** (anchor `#forecast`; the review step "Plan next month's budget" links to `/insights?month=<next>#forecast`).
- **Key elements:** **Month** picker (in the last 7 days of a month it defaults to next month, else any upcoming month), category table (**Category**, **Current**, **Forecast**, "seasonal x<factor>", "has a breakdown"), lines "Includes X yearly costs", "Not yet sorted", **Forecast total** with low-high range, **Expected income** (+ "Includes X of uncategorised income, which no budget line holds"), button **Create <Month> budget from this forecast**, and the compare dialog "<Month> budget already exists" with **Fill only empty** / **Replace all** / **Cancel**. Selectors: `#forecast` for the card; the rest by text (needs `data-tour="forecast-create"`, `data-tour="forecast-compare"`).
- **Tour (Insights, when forecast has data):** 1) Forecast card - "A prediction for next month based on your last three months." 2) Seasonal tag - "Adjusted for last year's pattern when we have it." 3) Create budget button - "Turn it into next month's budget." 4) Compare dialog - "Already have a budget? Choose how to merge."
- **How it works**
  - Per category: **fixed** categories = typical monthly amount; **flexible** = average of the 3 prior months (one-offs and yearly-cost-linked rows excluded), multiplied by a **seasonal factor** = (last year's target-month spend / last year's 3-month average before it), **clamped to 0.5-1.5**, applied only when last year has data in all four months; plus yearly costs due that month in their own category. Income = typical monthly income. Amounts **rounded to the nearest ₹100**; the displayed total is the sum of rounded lines. Range = +/- the standard deviation of each category's monthly totals, added in quadrature. Uncategorised spending is a separate "Not yet sorted" line and is **never budgeted**. "Not enough history yet to forecast this month." when no baseline.
  - Create modes: no budget -> create (planned expense per category, planned income = expected income) and open it; budget exists -> `replace` or `fill_empty` (errors "A budget already exists for this month." / "No budget exists for this month." / "Invalid mode." / "month must be YYYY-MM"). Inactive categories and categories with a breakdown are skipped and named.
  - **Code note:** the typical baseline is taken for the *current* month and applied to the target month; for far-future months the seasonal factor uses the same target month a year earlier.

### GROUP D - Insights and patterns

#### 4.15 Insights page (overview) and its cards

- **What / why:** "Where your money went this month" - one month at a time, every number clickable down to the exact transactions.
- **Where:** sidebar **Insights** `/insights` (title "Insights", strapline "Where your money went this month"). Drill-down links go to `/transactions` with filters in the URL (month, type, category, payee, account, cost kind, below, day). URL param `?month=YYYY-MM` selects the month.
- **Page order:** header with month picker (**Previous month** / **Month** / **Next month**) > **Safe to spend** > **Forecast** (4.14) > **Emergency fund** > **Income / Spending / Savings / Savings rate** cards (with "Typical: X" and "<x> vs typical"; footnote "N one-off payments are left out of the typical month") > **Fixed vs flexible** > **Small spends** > **Spending calendar** > **Where the money went** (By category / By merchant / By person) > **Biggest changes vs typical** + **Payment method mix** > **12-month trend** > **Net worth change, explained**.
- **Prereqs / empty states:** "Loading..." then the page; "Could not load insights. Please, try again."; month with no rows shows the empty view ("No record found"). Comparisons show "No typical month yet" until at least one prior month has data.
- **Key elements (page level)**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Previous month / Next month | icon buttons | header | Change month | `[aria-label="Previous month"]`, `[aria-label="Next month"]` |
| Month | date picker | header | Jump to a month | `[aria-label="Month"]` (verify) |
| Every underlined figure (FigureLink) | links | all cards | Drill down to Transactions | `a[href*="#/transactions"]` (needs `data-tour="insights-figure"` on the first one for tours) |
| Where the money went: By category / By merchant / By person | toggle | card | Switch view | text (needs `data-tour="wmw-toggle"`) |
| "This is a person" / "Not a person" / "Undo my correction" | icon buttons | merchant/person rows | Correct the person-vs-merchant guess | `[aria-label="This is a person"]`, `[aria-label="Not a person"]`, `[aria-label="Undo my correction"]` |
| Trend view (Income vs spending / Fixed vs flexible) | toggle | trend card | `[aria-label="Trend view"]` | |
| Trend bars | chart | trend card | "Click a month to select it" | chart (needs `data-tour="insights-trend"`) |
| Card containers | | | | none (needs `data-tour="insights-<card>"`, e.g. `insights-fixed-flexible`, see 7.1) |

- **Suggested DAP tour (first visit, once there is data; ~7 steps):** 1) Month picker - "Pick a month. Everything below follows it." 2) Summary cards - "Green means better than your typical month; red means worse." 3) Fixed vs flexible - "See bills you can't change versus spending you can." 4) Where the money went - "Switch between categories, shops and people." 5) Any underlined figure - "Click any number to see the exact transactions." 6) Trend - "Click a bar to jump to that month." 7) Net worth change - "Why your net worth moved."
- **How it works (shared by all cards)**
  - **Counted rows:** income and expenses only; excluded: transfers, balance adjustments (write-offs), planned rows, lent/borrowed principal and repayments, loan disbursements, EMI principal (EMI interest counts). **Every figure equals its drill-down list** (same predicate).
  - **Effective month:** a salary-category income dated on or after the cut-off day (default 25) belongs to the **next** month; everything else uses its IST calendar month. Applies to Insights income/savings, typical income, safe to spend, savings rate, salary plan, and the Transactions `month` filter ("counted in <month>").
  - **Typical month:** average over the (up to) **3 effective months before** the selected one that have data (a month with data = any counted row, even a yearly-cost one). Fewer than 3 = use what exists; none = comparisons hidden. **One-offs are left out of the baseline only** (the selected month stays raw): an expense of at least **₹10,000** whose payee does **not** appear in at least **2** of the baseline months; an income row of at least **1.5 x the median** of the baseline months' monthly income totals (a bonus). Rows linked to a yearly cost are also left out. The one-offs are listed as a count.
  - **Savings** = income - spending; **Savings rate** = savings / income, "-" when income is 0. Green when better than typical (more income, less spending, more savings, higher rate), red when worse.
  - **Payee key** = the description, upper-cased, trimmed, spaces collapsed, with a leading "PAID TO ", "RECEIVED FROM ", "REQUESTED BY " or "PAYMENT TO " removed. An empty key is "Unknown payee": counted in totals/categories, never listed as merchant/person.
  - **Person vs merchant:** a payee is guessed a **person** only if its name has none of the business words (PVT, LTD, LIMITED, PRIVATE, STORE(S), CAFE, HOTEL, RESTAURANT, ENTERPRISES, MART, TECHNOLOGIES, SERVICES, BAKERY, FOODS, STALL, AIRLINE, CLINIC, VENDING, brands such as SWIGGY, ZOMATO, BLINKIT, NETFLIX, UBER, OLA, ...) **and** at least one payment ever started with "Requested by " / "Received from ", or you have paid it at least ₹1,000 in a multiple of ₹100. All-time history is used so a payee does not flip between months. **Your correction always wins** (per user and payee key; "Undo my correction" restores the guess).
  - **By merchant:** top 10 by spending with total, payments and average, plus a non-clickable "Other merchants" row. **By person:** Sent (expenses), Received (income), Net. **Biggest changes vs typical:** up to 5 categories/merchants that moved most in rupees vs their 3-month baseline average (months with no spend count as 0; one-offs excluded); "new" instead of a percentage when the baseline is 0. **Payment method mix:** spending by source account (expenses use the from-account); an unknown account shows as "Unknown account".
  - **12-month trend:** 12 effective months ending at the selected month; months with no income show a gap for savings rate. Toggle to Fixed / Flexible / Not yet sorted.
- **FAQ:** *Why is "Typical" missing?* No earlier month has data. *Why did a payment I made not show?* It may be a transfer. *Why is my salary in next month?* It arrived on/after the cut-off day (see Profile).

##### 4.15a Fixed vs flexible card

- Shows **Fixed**, **Flexible**, **Not yet sorted** (tooltip "Spending that is not yet sorted has no category yet."), each with "vs typical". Each bucket drills down to its transactions (`cost=fixed|flexible|unsorted`). Needs categories flagged **Fixed cost**; with none flagged everything categorised is flexible. Rules: expenses in Fixed-flagged categories = fixed; other categorised = flexible; uncategorised = Not yet sorted; income/transfers excluded.
- Tour: "Fixed vs flexible - Fixed costs are the bills you can't skip. Focus savings efforts on Flexible." (trigger: first time at least one category is Fixed).

##### 4.15b Small spends card

- Title **Small spends**, subtitle "Payments below <cut-off>", headline "N small payments, X", "Typical month: N payments, X", **Where they went** (top places: description, count, average), **Last 12 months** bars (click a bar to open that month's list). Empty: "No small payments this month".
- Rule: a small spend is a counted **expense strictly below** the cut-off (Profile > Small-spend cut-off, default ₹200; strict `<`, so exactly ₹200 is not small). Transfers, adjustments, planned rows and debt principal excluded. People count too (tea-stall owners are often guessed as people). The typical baseline uses the same 3-month/one-off rules. Drill-down uses the `below=` filter ("Below <amount>" chip).
- Tour: "Small spends add up. This shows how many tiny payments you make and where." trigger: first visit when count > 0.

##### 4.15c Spending calendar

- Title **Spending calendar**; toggle **Month** / **Year** view; **Flexible only** switch (hides fixed categories so big bills do not wash out colours); **Less ... More** legend; **Average by weekday**. Each day tile has an aria-label like `"<date>: <amount> · N payments"` (or "No spending"); click = Transactions for that day (`day=YYYY-MM-DD`).
- Rules: IST calendar days, **no salary shifting**; counted expenses only; five shades from quantile cut points (20/40/60/80 %) over the non-zero days of the range; zero days blank, today outlined. Weekday average = total on that weekday / number of such weekdays in the range up to today (future days not counted). Range at most 400 days (API error "The range may span at most 400 days", "from and to must be valid dates (YYYY-MM-DD)").
- Selector: `[aria-label^="2026-"]` tiles; Switch by label (needs `data-tour="calendar-flexible"`).
- Tour: "Darker days mean more spent. Click a day to see what you paid."

#### 4.16 Savings rate card (Dashboard top)

- **What:** "Savings rate: N%" headline, "(target T% ✓/✗)", "12-month average A%", "<pts> pts vs last month", a 12-month sparkline (aria-label "Savings rate over the last 12 months"). Always about the **current** month. Hides until Insights data loads; "Could not load this data." on error.
- **Prereqs:** none to show the rate; a **savings target** in Profile adds the target and green/red colour. Rate "-" when the month has no income.
- **Rules:** rate = (income - spending) / income on counted rows with effective-month income; 12-month average = (sum income - sum spending) / sum income over the trend. Target: percent mode = the value; amount mode = value / (this month's income, or typical income when income is 0) x 100; none if no base. **One shared rule everywhere (dashboard, health, milestones):** the target is met when the rate **rounded to a whole percent** >= the target rounded to a whole percent (19.6 % meets 20 %). "vs last month" compares the displayed (rounded) figures. Transfers into savings are not spending, so they count as saved.
- Selector: `[aria-label="Savings rate over the last 12 months"]` for the sparkline; card needs `data-tour="dash-savings-rate"`.
- Tour: "Your savings rate is the share of income you kept. Set a target in Profile to see a tick." (first visit; link to Profile).

#### 4.17 Safe to spend card (Dashboard and Insights)

- **What:** "Safe to spend: X for the rest of <month> · Y/day for N days" (red "Over by X this <month> ..." when negative). Button **See how this is worked out** opens "How safe to spend is worked out": Expected income; "Received so far X; typical Y"; "Spent so far (excluding yearly costs)"; Fixed costs still to come (per category "<name>: typical X, spent Y"); Savings for this month; Yearly costs set-aside for this month; Emergency fund top-up for this month ("X still to transfer" / "Already transferred"); **Safe to spend**; Per day. **Close**.
- **Empty/hints:** "No fixed categories yet. Mark categories like Rent as fixed to count them here." / "Your fixed categories have no typical amount yet (no spending in the last 3 months), so nothing is counted here." / "Received so far X; no typical income yet".
- **Rules (code is the truth):**
  - **Safe = expected income - spent so far - fixed still to come - savings deducted - yearly deducted - emergency deducted**, current month only.
  - **Expected income = max(income received this month, typical monthly income).** **Spent so far** = this month's counted expenses excluding yearly-cost-linked rows. **Fixed still to come** = sum over fixed categories of max(0, typical monthly amount - spent in it this month) (only categories with a typical amount).
  - **Set-asides:** each (savings, yearly, emergency top-up) has a *target* and money *already transferred* into its account(s) this month (transfers into the savings account / sinking fund / emergency accounts; plan accounts included). Deducted = **max(target, transferred)** (money already moved still counts as set aside); "still to transfer" = max(0, target - transferred). Window for "this month's transfers": with a salary category, from the previous cut-off day to this cut-off day (a late salary's plan transfers happen in the previous calendar month); otherwise the calendar month. Targets come from the **confirmed salary plan's buckets** for that month if one exists (a **Skipped** bucket = 0), else settings: savings = amount or percent x **expected income**; yearly = sum of yearly costs / 12; emergency = min(gap to target, top-up % x **expected income**) when below target, else 0.
  - **Days left** = days to the end of the IST month counting today, at least 1; per day = safe / days left.
  - Cards read "Over by X" when negative. Tapping opens the breakdown.
  - **Code vs spec:** spec said the set-aside counts as "still to come" until a transfer happens; code deducts the larger of target and actual transferred.
- Tour: 1) Card - "What you can still spend this month without touching bills or savings." 2) See how this is worked out - "Open the maths line by line." 3) Over-by state - "Red means you've committed more than you earn this month." (first visit when fixed categories exist)

#### 4.18 Emergency fund card (Dashboard and Insights)

- **What:** "N months covered" meter (aria-label "Emergency fund"), "X saved · Y fixed costs a month", "Z more to reach T months" / "Target of T months reached". Colours red / amber / green.
- **Empty states:** "No emergency-fund accounts yet. Tick “Emergency fund” in an account’s settings to track it here." / "X saved, but there are no fixed costs to compare against yet. Mark categories as fixed to see how many months this covers."
- **Setup:** tick **Emergency fund** on accounts (4.2); mark **Fixed cost** categories (4.4); set **Emergency fund target (months)** in Profile.
- **Rules:** fund = sum of ticked **active** accounts' current balances (negative balances count as 0; investments/assets/credit/loan never). Month's cost = **typical monthly fixed** costs. Months covered = fund / monthly fixed, **rounded to 1 decimal** and colours follow the rounded figure: **red below 3, amber from 3 up to the target, green at or above the target**. More needed = max(0, target x monthly fixed - fund). That gap also drives the Salary-plan "Emergency top-up" and the Safe-to-spend emergency set-aside. Milestones: "covers 3 months" (only if the target is above 3) and "reached target".
- Selector: `[aria-label="Emergency fund"]`.
- Tour: "Months of fixed bills your reserve would cover." / "Tick Emergency fund on your account." (when no accounts)

#### 4.19 Net worth change, explained (Insights bottom)

- **What:** "Net worth <+/-X> in <month>", from -> to, then **Why it moved**: **Saved from income** (Income / Spending lists), **Investment growth** ("Change in holdings' value, not counting buys and sells"), **Write-offs** ("Balance adjustments"), **Other** ("Money lent or borrowed, loan bookkeeping and anything else"), informational **Debt paid down** ("Card and loan balances; already part of the lines above"); **By account** list (also "Investments", "Lent and borrowed" lines); **Last 12 months** stacked bars (click a bar to select a month). Empty: "No accounts, investments or debts to show yet."
- **Rules (net worth definition):** active **non-investing** account balances (credit/loan negative = owed) + invest holdings at market value (Investment-account balances are never counted - holdings are) + money lent still outstanding - money borrowed still outstanding. Past months use each account's *current* status/type. Invest value at a time = the asset's snapshot of that IST month, else its latest earlier snapshot. The parts sum **exactly** to the change; anything unexplained is "Other". Saved = counted income - counted spending by **calendar** month (a late salary stays in its calendar month here). Investment growth = end value - start value - net invested (buys - sells).
- **Note:** the top bar "Net Worth" and Stats "Net Worth Evolution" come from the original app and may not use this exact definition (verify in app).

#### 4.20 Stats (original)

- **What:** Original MyFin charts. Tabs: **Net Worth Evolution** (`/stats/patrimony`), **Projections**, **Expenses** (Expenses By Category / Entity / Tag, Expenses Evolution), **Income**, **Year-By-Year**. Title strapline "Look into the past and future here". Selectors: tabs `button[role=tab]` by text (needs `data-tour="stats-tabs"`).
- **Tour (optional):** "Longer-term charts: net worth, projections and year-by-year." Not tied to the new rules (does not exclude write-offs/debt principal).

### GROUP E - Debts and wealth

#### 4.21 Debts (People and Loans)

- **What / why:** One place for informal lending/borrowing (friends, family) and formal loans with EMIs, **without distorting your spending**.
- **Where:** sidebar **Debts** `/debts` (title "Debts", subtitle "Money you lent or borrowed, and how much is still owed."). Tabs **People** and **Loans**. Also reachable from Transactions: row action "Mark as loan to / from a person...", and the debt chip on a row ("Click to open Debts"). EMIs appear in the Dashboard **Upcoming** card ("<lender> loan EMI").
- **Prereqs:** none. Loans optionally need a **paying account** (bank/card/cash, not Loan/Investment) and optionally the income row where the loan amount was credited.
- **Key elements - People tab ("Lent and borrowed")**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Totals "Owed to you X · You owe Y" | text | top | | text (needs `data-tour="debts-people-totals"`) |
| Add entry | button | header | Dialog "Add entry": Type ("I lent money (they owe me)" / "I borrowed money (I owe them)"), Person, Amount, Date, Due date (optional), Note (optional); **Save** | text (needs `data-tour="debts-add-entry"`) |
| Entry rows with chips Outstanding / Settled ✓ / Overdue; "due <date>"; repayment lines "Repaid X on <date>" / "Marked manually" | list | body | | text |
| Mark repayment | button | row | Dialog "Record a repayment · <name>": "For a repayment with no transaction, e.g. in cash." | text (needs `data-tour="debts-mark-repayment"`) |
| Suggested repayments ("These transactions look like repayments. Confirm the ones that are.") **Confirm** | list + button | row | Links a transaction as repayment | text |
| Remove this repayment | icon | repayment line | `[aria-label="Remove this repayment"]` | |
| Edit / Delete | buttons | row | Delete: "Linked transactions will count as spending or income again." | text |

- **Key elements - Loans tab ("Loans and EMIs")**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Add loan | button | header | Dialog "Add loan": Lender, Principal, Interest rate (% a year), Tenure (months), EMI (blank = calculated, "Leave empty to use X"), First EMI month, EMI day of month, Paying account, "Loan amount credited to... (optional)" (Not linked) | text (needs `data-tour="debts-add-loan"`) |
| Loan card: terms "EMI X on day D · R% · principal P", progress, "outstanding principal", chips (Closed ✓, missed count) | card | list | | text |
| Schedule table: Date, EMI, Interest, Principal, Balance, Status; row actions **Match**, **Mark paid**, **Link transaction...**, **Unpay** | table + buttons | loan card (expand) | See rules | text (needs `data-tour="loan-schedule"`) |
| Mark past EMIs paid | button | loan card | Marks every unpaid installment dated on/before today as paid manually | text |
| Prepayment what-if: Prepay amount, Paid after (Before the first EMI / EMI #n (date)) | panel | loan card | Shows months and interest saved and the new end date | text (needs `data-tour="loan-whatif"`) |
| Link credited amount... / Unlink credited amount | buttons | loan card | Marks the income the loan was paid out into (stops counting as income) | text |
| Delete | button | loan card | "Delete the loan from <name>, its schedule and its loan account?" / "Matched EMI debits get their full amount back and count as spending again." | text |

- **How to (lent money):** Debts > People > **Add entry** > "I lent money (they owe me)" > Person, Amount, Date > **Save**. Or from Transactions click "Mark as loan to / from a person...". When they pay back: **Confirm** a suggested repayment, or **Mark repayment**.
- **How to (loan):** Debts > Loans > **Add loan** > fill terms > **Save**; then for each EMI use **Match** (suggested debit), **Link transaction...** (pick any bank/card/cash expense within ₹1 of the EMI and 45 days), or **Mark paid** (paid outside MyFin).
- **Suggested DAP tour (first visit):** 1) People tab - "Money you lend or borrow stays out of your spending." 2) Add entry - "Record who owes whom." 3) Loans tab - "Track EMIs and see how much interest you pay." 4) Add loan - "Enter the loan terms once; MyFin builds the schedule." 5) Schedule Match - "Match each EMI to the real bank debit." 6) What-if - "See what an extra payment saves." (trigger: first visit; step 4-6 when a loan exists)
- **How it works (business rules)**
  - **People entries:** lent = an expense row (or hand entry), borrowed = an income row; repayments go the other way. Status: **Outstanding** (principal - repaid > 0), **Settled ✓**, **Overdue** (past the due date and not settled, computed). Over-repayment shows 0 outstanding. Totals never below 0 per entry. Repayments: auto-suggested from unlinked transactions of the repayment type **on or after the start date whose payee key equals the person's name key** (never applied silently); linked manually to a transaction; or recorded manually (no transaction). Repayment cannot be dated before the entry start ("A repayment cannot be dated before the entry started."). Validation: "A name is required.", "amount must be positive.", "date is required.", "kind must be lent or borrowed." A transaction can be linked to one debt only ("This transaction is already linked to a debt."), not if it is a balance adjustment or a yearly cost. **Lending/repayments are excluded from Insights spending and income.** Deleting an entry makes its linked transactions count again.
  - **Loan creation:** creates a **loan account** (type Loan, named after the lender, then "<lender> loan", "<lender> loan 2", ...) opened at **minus the principal** with one adjustment ("Loan opening balance"). Validation: "A lender is required.", "principal must be positive.", "rate cannot be negative." (0 allowed for no-cost EMI), "tenure_months must be between 1 and 600.", "emi_day must be between 1 and 31.", "The EMI must be more than the monthly interest.", "A loan account cannot be the paying account.", "Pick a different lender name."
  - **EMI amount (if blank):** standard formula EMI = P x r x (1+r)^n / ((1+r)^n - 1) with r = annual rate / 12 / 100, rounded to the cent; at 0 % = principal / months rounded **up** to the cent.
  - **Schedule:** each month interest = round(balance x r), principal = EMI - interest; the **last row (or the row that clears the balance) pays exactly what is left** so the EMI of the last row is adjusted. First EMI is in the chosen first month on the EMI day; the day is **clamped to the month's length** (31 -> 30/28/29 in short months).
  - **Match an EMI to a real debit:** the debit becomes the **interest expense** (category **"Loan interest"**, role interest; its date and description are kept) and a **principal transfer** from the debit's account to the loan account is created, so the account's net change still equals the original debit. Matching rules: expense only, not an adjustment, from a bank/card/cash account (not Loan/Investment), within **±₹1** of the EMI ("The amount must be within ₹1 of the EMI."), within **45 days** of the installment date ("The debit must be within 45 days of the installment date."), not already linked. Suggestions look **10 days** either side and use each expense for at most one installment. **Mark paid** = paid outside MyFin: a manual payment and a principal adjustment on the loan account; the bank is untouched and the interest is **not** counted as spending. **Unpay** reverses (original amount/category restored; principal transfer deleted). While an EMI is matched its amount, date and accounts are locked.
  - **Missed:** an unpaid installment more than **5 days** past its date is flagged missed. **Closed ✓:** all installments paid; a rounding residual up to ₹1 still counts as settled.
  - **Spending treatment:** only the **interest part** counts as spending in Insights; principal moves between accounts and reduces debt (feeds net worth and the "Loan EMIs" health check).
  - **Prepayment what-if:** extra payment after installment k, same EMI: months saved, interest saved, new end date (rate from the loan).
  - **Loan amount credited:** link the income row within 30 days of the loan start; it stops counting as income.
  - **Delete loan:** matched debits get their original amount and category back; principal transfers, adjustments and the loan account are deleted. A hand-added row on the loan account blocks deletion with an explanatory message.
  - **Account deletion:** a loan's account cannot be deleted on its own.

#### 4.22 Retirement

- **What / why:** "How much you need, and whether you are on track" - a FIRE-style calculator driven by your real spending, corpus and savings.
- **Where:** sidebar **Retirement** `/retirement` (title "Retirement"). Inputs live in Profile > Financial profile (button **Open settings** when something is missing).
- **Prereqs / empty states (each shows a message and **Open settings**):** "Add your date of birth in your profile to see your retirement figures." / "There is not enough spending history yet to estimate your retirement spending." / "Set a safe withdrawal rate in your profile." / "Your retirement age must be above your current age. Update it in your profile." Load error "Could not load your retirement figures. Try again."
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Result tiles: **Corpus needed at retirement** ("X in today's money"), **On track to retire at** ("Age N" / "Not by age 90"; "Your target: age N"), **Extra needed each month** ("On top of the X you invest now") | cards | top | | text (needs `data-tour="retire-results"`) |
| **Projected corpus** chart ("Your corpus" vs "Needed" by Age) | chart | middle | | none (needs `data-tour="retire-chart"`) |
| **What if...** sliders: Expected return, Inflation, Safe withdrawal rate, Retirement age, Monthly investment | sliders | panel | Change figures without saving | `[aria-labelledby="slider-<key>"]` (ids `slider-<key>` exist) |
| **Save as my settings** / **Reset** | buttons | panel | Persist the slider values / discard | text (needs `data-tour="retire-save"`) |
| Open settings | button | missing-inputs banner | to `/profile` | `a[href$="/profile"]` |

- **How to:** 1) Fill the Retirement block in Profile. 2) Open **Retirement**. 3) Drag sliders to explore. 4) **Save as my settings** to keep them or **Reset**.
- **Suggested DAP tour (first visit):** 1) Results - "Your target pot and whether you're on track." 2) Chart - "Blue is your growing pot; the other line is what you'd need at each age." 3) Sliders - "Try what-ifs. Nothing is saved until you press Save as my settings." 4) Open settings - "Missing inputs? Fix them in Profile." (when empty)
- **How it works**
  - Age is from the date of birth (IST). **Annual spending today** = 12 x typical monthly spending basis: **Fixed costs only** = typical fixed; **All spending** = typical spending **plus the yearly-costs monthly set-aside** (typical month leaves yearly costs out). Monthly investment (default) = the Savings target (Amount, or Percent x typical income).
  - **Corpus needed** at retirement (future rupees) = annual spending x (1+inflation)^years / SWR **+ present value of the family-support stream** (monthly x 12 inflation-adjusted, for N years, discounted at the expected return; the closed form handles return = inflation). "Today's money" = divided by the inflation factor. If SWR is 0 the corpus is 0 and the page asks you to set it.
  - **Corpus now** = balances of ticked, active, non-investing accounts (negatives count as 0) + latest value of ticked assets (investment-account balances are never counted).
  - **Projection** (yearly, to age 90): corpus = corpus x (1+return) + 12 x monthly investment; "needed" at each age is recomputed. **On track to retire at** = first age where corpus >= needed (else "Not by age 90"). **Extra needed each month** = the monthly amount closing the gap at the retirement age (never negative), on top of what you invest now.
  - **Save as my settings** writes sliders to the profile; the **Monthly investment** slider becomes an *amount-mode* Savings target. Error: "retirement_age must be above your current age." Retirement accounts may overlap the savings account but never emergency/sinking accounts.

#### 4.23 Investments (original, extended by goals/retirement)

- **What:** Assets, buy/sell/income/cost transactions, performance. Tabs **Summary**, **Assets**, **Transactions**, **Stats**, **Reports**; buttons **Add asset**, **Add transaction**; strapline "Manage your investments here"; banners "Investments has been updated!" (Beta) and "Backdated Transaction Alert".
- **Selectors:** tabs `button[role=tab]` by text (needs `data-tour="invest-tabs"`), the four Summary tiles have help icons with aria-labels such as "Help: total invested - shows the total capital you've invested across all assets."
- **Tour (brief):** 1) Add asset - "Create each holding." 2) Add transaction - "Record buys and sells." 3) Summary - "Total invested, current value and returns."
- **Interactions with new features:** asset current value feeds net worth, Goals (market value, SIP from recurring buys) and Retirement. Investment-type *accounts* are never counted in these (holdings are, to avoid double counting); Investment accounts cannot be earmarked.

### GROUP F - Routines

#### 4.24 Month-end review ("Month review")

- **What / why:** A six-step checklist that turns last month's data into clean books and next month's plan.
- **Where:** sidebar **Month review** `/review` (title "Month-end review", subtitle "Six steps to close last month. Past months are kept as they were."). Dashboard card "<Month> review: N of 6 done" with **Open the review** - shown **only from the 1st to the 10th** of a month, for the previous month, while incomplete.
- **Steps (exact labels) and links:** 1 **Import stale accounts** (-> Import page, lists each stale account) · 2 **Sort uncategorised spending** (-> Transactions `?month=<M>&type=E&category=none`) · 3 **Reconcile balances** (-> Balance check) · 4 **Resolve planned transfers** (-> Transactions `?planned=1`) · 5 **Review Insights** (manual tick "I've reviewed this month in Insights" + **Open**) · 6 **Plan next month's budget** (-> Insights forecast `#forecast`).
- **Key elements:** Month picker (**Month**), progress "N of 6" / **Complete**, step rows (icons: done ✓ / nothing to do / to do; each with **Open**), the tick checkbox, **Last 12 months** history bars (aria-label per bar; **Frozen** / **Reconstructed** badges). Selectors: step rows and tick need `data-tour="review-step-<name>"`, `data-tour="review-tick"`; badges `[aria-label="Frozen"]`, `[aria-label="Reconstructed"]`.
- **How to:** open the review on the 1st; work down the steps via each **Open**; tick "I've reviewed this month in Insights"; create next month's budget from the forecast. When all 6 are done the card disappears.
- **Suggested DAP tour (first time the Dashboard card appears):** 1) Card - "It's month-end: six quick steps to close last month." 2) Step 1-3 - "Import, sort, reconcile." 3) Step 4 - "Settle planned transfers." 4) Tick - "Look at Insights, then tick this yourself." 5) Step 6 - "Create next month's budget from the forecast."
- **How it works**
  - **Step logic (live):** *Import* = no active, freshness-enabled account is stale now (nothing to do if none has freshness tracking: "No account has freshness tracking turned on"). *Sort* = count of counted uncategorised expenses of that month = 0. *Reconcile* = every active freshness-enabled account has a balance check dated in the month **or within the first 10 days of the next** month. *Planned* = no planned row dated in that month remains (none and no salary plan = "No salary plan this month"). *Review* = the manual tick. *Plan* = a budget exists for the **next** month. A step with "nothing to do" counts as done. "N of 6 done" = steps not "to do".
  - **Freezing:** the current month is always live. A past month is **stored (frozen) when it becomes complete, or on the first read from day 11 (IST) of the next month**; frozen months never change ("This month is frozen: later changes don't alter its review."). A past month **first opened from the start of M+3 onward** is **Reconstructed** from today's data, never stored ("Reconstructed from today's data: this month was first opened more than two months after it ended, so it wasn't frozen."). Months before your data begins are computed but never stored.
  - **Tick errors:** frozen month -> "Couldn't save: this month may be frozen. Reloaded." (API 409 "This month is frozen; its review can no longer change"); future month "A future month cannot be reviewed"; before your data "There is no data for this month".
  - Three completed frozen months in a row fire the "Month-end review completed 3 months in a row" milestone.

#### 4.25 Health ("Financial health")

- **What / why:** A monthly pass/fail checklist of the basics with a one-line fix hint per check and a score "N of M passed" tracked over 12 months.
- **Where:** sidebar **Health** `/health` (title "Financial health", subtitle "A monthly checklist of the basics. Past months are kept as they were."). Dashboard card **Health N of M** / "Set up your financial health checks" (-> **See details**; "Every check you've set up passes this month.").
- **Checks (labels):** **Savings rate**, **Emergency fund**, **Yearly costs**, **Fixed costs**, **Credit cards**, **Loan EMIs**, **Up-to-date data**. Each row shows ✓ / ✗ / not set up, a value and a hint; failing/unset rows carry **Fix** / **Set up** (links to the relevant page). A month with no checks set up: "No checks set up yet".
- **Key elements:** Month picker (**Month**), score card ("Health N of M"), check rows (icons have aria-labels), "not set up" list, **Last 12 months** bar buttons (`aria-label="<month>: N of M"`), badges **Frozen** / **Reconstructed**. Selectors: bars `button[aria-label*=" of "]`; rows need `data-tour="health-check-<key>"`; card needs `data-tour="health-score"`.
- **Suggested DAP tour:** 1) Score card - "How many basics you've nailed this month." 2) A failing row - "Each cross comes with a hint to fix it." 3) Set up link - "Not set up? Click Set up." 4) History bars - "Past months are kept as they were." (first visit; step 3 only when any not-set-up)
- **How it works (thresholds)**

| Check | Passes when | "Not set up" when |
|---|---|---|
| Savings rate | rounded savings rate >= rounded target (shared rule, 4.16); no income in the month = fail ("No income this month (aim ≥ N %)") | no savings target, or no income base |
| Emergency fund | months covered (1 decimal) >= target months | no ticked accounts / no fixed costs |
| Yearly costs | sinking fund **on track** (behind = 0) | no active yearly cost / no sinking-fund account |
| Fixed costs | typical fixed / typical income **<= 50 %** | no fixed categories / no typical income |
| Credit cards | every active card's owed balance was cleared by **transfers into it within 35 days** (tolerance ₹1) of the reference time | no cards; or a card is still inside its 35-day window ("Card payments are still within the 35-day window") |
| Loan EMIs | sum of open loans' scheduled EMIs (loans started before month end) / typical income **<= 40 %** | no open loans / no typical income |
| Up-to-date data | no active freshness-enabled account is stale **and** each has a balance check dated in the month or within the first **10 days** of the next month (a missing check fails only after that grace period; until then "check balances by day 10 of next month") | no account has freshness tracking turned on |

  - Card reference: each card's latest balance check in the month (stored as amount owed), else its balance at the end of the previous month. Any card failed = fail; else any window still open = not set up; else pass.
  - **Score** "N of M passed": M excludes "not set up" checks (they are never counted as a fail).
  - **Freezing (E10):** the current month is live. A past month freezes on its first read once it is **settled** - from **day 11 (IST) of the next month** *and* every active card's 35-day window has closed - and **at the latest 36 days after the next month starts** regardless. Before then it is live. A past month first opened from the start of **M+3** is **Reconstructed** (live, never stored). For past months, checks that read current state (emergency fund, sinking fund, staleness) are evaluated as of the last second of the month but still use today's account balances. Months before your data show everything "not set up" and are never stored. Frozen month note: "This month is frozen: later changes don't alter its score."
  - Thresholds (50 %, 40 %, 35 days, ₹1) are constants, quoted in the hint texts.
  - "All checks pass in a month" fires a milestone (frozen months only).

#### 4.26 Events

- **What / why:** Reminders for people dates (birthday, anniversary, wedding - with gift budgets) and money dates (rent, card due, renewal, SIP, other) with automatic "paid" status. Dashboard-only (no e-mail).
- **Where:** sidebar **Events** `/events` (subtitle "Birthdays, anniversaries and money dates, with gift budgets and paid status"); Dashboard **Upcoming (next 30 days)** with **All events**; Transactions row action "Link to event...".
- **Prereqs / empty:** "No events yet. Add a birthday, or a money date like rent or a card due date."
- **Key elements**

| Element | Type | Location | What it does | Selector |
|---|---|---|---|---|
| Suggested events (Add / Ignore) | card | top | "Yearly costs, payments that recur on about the same day each month, and credit-card due dates." | text (needs `data-tour="events-suggestions"`) |
| Add event | button | list header | Dialog "Edit event": Name, Kind (Birthday, Anniversary, Wedding, Rent, Card due, Renewal, SIP, Other), First date, Repeats (once/monthly/yearly), Amount (optional), Gift budget (optional; "Use last time's spend: X"), Payee (optional), Category (optional), Account (optional), Active | text (needs `data-tour="events-add"`) |
| Event row: next date, "today/in N days", status (pending / done ✓ / paid ✓), "spent X", "budget X", "tag event:<name>" | rows | list | | text |
| Mark done / Mark not done, Unlink, Edit, Delete, History | buttons | row | | text |
| Link to event dialog: Event, Occurrence, **Link** | dialog | from a transaction | "Linked to the event"; errors "This transaction is already linked to an event, or the date is not an occurrence." / "No occurrence within 90 days of this payment." / "You have no active events yet." | text |

- **How to:** Events > **Add event** (or **Add** a suggestion) > name, kind, first date, repeat; for people events set a **Gift budget**; for money events set **Payee**/**Category**/**Account** and optionally **Amount** so payments are matched automatically.
- **Suggested DAP tour (when empty):** 1) Suggested events - "We spotted bills that repeat; add the real ones." 2) Add event - "Add birthdays and money dates." 3) Gift budget - "Spending tagged with the event counts against it." 4) Payee/Account help - "A payment to this payee within 5 days marks it paid." 5) Dashboard Upcoming card - "Your next 30 days at a glance."
- **How it works**
  - **Repeats:** once / monthly / yearly; monthly and yearly keep the first date's day, **clamped to the month's last day** (31st -> 30th, 29 Feb -> 28 Feb), so no month is skipped. Name 1-250 characters; amounts >= 0; date must be a real date; names are unique (they become the tag `event:<name>`: "An event with this name already exists."). Changing date/repeat drops stranded occurrence rows (their links go too). Deleting an event keeps its tag on transactions ("The event's tag stays on your transactions.").
  - **Status is derived:** done when marked by hand, or (money events) while a transaction is linked. Unlinking or deleting the linked transaction returns a link-only money occurrence to **pending**; an unlinked one is not auto-matched again.
  - **Auto-match (money events with a payee key, category, or card account):** closest-dated unlinked counted expense/transfer **within ±5 days** of the occurrence date, matching the payee key or category (card due: a transfer into the card's account), and **within ±10 %** of the event amount when it has one; looks back **35 days** and ahead 30. Marks it **paid ✓**.
  - **People events - gift spend** = counted expenses tagged `event:<name>` dated from **60 days before** to **7 days after** the occurrence, plus manually linked transactions (each counted once). Next year's suggested budget = last occurrence's actual spend.
  - **Upcoming list:** next **30 days**, plus unpaid money items (events and loan EMIs) **up to 7 days overdue**, flagged "overdue" and listed first. A card due without an amount shows the card's current outstanding. Pending history shows the last year (max 6).
  - **Suggestions:** active yearly costs at their due month (day 1); payees with counted expenses in **>= 3 of the last 4 months on days within 3 of each other** (monthly, median day); credit cards with **>= 2 transfers in** over the last 4 months (card due). Dismissed suggestions are remembered.

#### 4.27 Milestones

- **What / why:** Celebrate real progress. A banner on the Dashboard (dismissible), then a timeline.
- **Where:** sidebar **Milestones** `/milestones` (subtitle "Achievements worth celebrating, newest first"; empty "No milestones yet. They appear here as you reach them."); Dashboard banner "Milestone reached" with **Dismiss** and **See all milestones**.
- **Key elements:** banner (selector needs `data-tour="milestone-banner"`), **Dismiss** button (`button:has-text("Dismiss")`), timeline rows (needs `data-tour="milestones-list"`).
- **Milestones (labels):** "Your net worth crossed X" (₹1L, 5L, 10L, 25L, 50L, 1Cr) · "Your emergency fund now covers 3 months of fixed costs" · "Your emergency fund reached your target of N months" · "Goal fully funded: <name>" · "Best savings month in the last 12 months: <month> (N %)" · "3 months in a row on your savings target" · "Every health check passed in <month>" · "Month-end review completed 3 months in a row" · "<name> paid you back in full" / "You repaid <name> in full" / "Loan cleared: <name>".
- **Suggested DAP tour (first banner):** "You reached a milestone! Dismiss it here; it stays on the Milestones page."
- **How it works**
  - Each milestone fires **once** (unique per kind and key); net-worth thresholds fire on upward crossings only and never re-fire after a dip. Evaluated when the Dashboard loads (cached for about 5 minutes); no scheduler, no e-mail.
  - **First-ever evaluation rule:** to avoid a flood on day one, only the **highest** net-worth threshold, the **latest** of each other kind, and goal/debt milestones whose achievement date is **known and within the last 30 days** get a banner; everything else goes **silently** to the timeline (dismissed). Goal milestones have no known funding date, so on the first run they go straight to the timeline. "First-ever" = the profile has never been evaluated, even if nothing was found.
  - **Streaks** (3 months on savings target; 3 months of completed reviews; health all-pass) look only at **settled/frozen** months: the savings figures only count months whose grace period (10 days) has ended, so the previous month counts only from day 11; months with no income break a streak; a run counts only if the month before it is known and did not pass. Best savings month needs at least one earlier month with income.
  - The emergency "3 months" step exists only when the target is above 3.
  - Debt cleared = status **Settled**; date = the last payment (else now).

### GROUP G - Settings and safety

#### 4.28 Profile page

- **What:** Accordion sections, each with a header id: **Change Language** (`#language-header`), **Change Currency** (`#currency-header`), **Financial profile** (`#financial-profile-header`, 4.6), **Change Theme** (`#theme-header`), **Change Password** (`#password-header`), **Tools** (`#tools-header`), **Encrypted backups** (`#folder-backups-header`), **If something happens to me** (`#legacy-header`), **Stats for Nerds** (`#stats-header`, counts of transactions/entities/categories/accounts/budgets/rules/tags and the app **Version**).
- **Where:** top-bar profile icon `button[aria-label="profile"]`, route `/profile`, title "Profile Management", strapline "Read and update your personal preferences".
- **Tour (first visit):** 1) Financial profile - "Your planning numbers live here." 2) Encrypted backups - "Back up to a synced folder." 3) If something happens to me - "A file your family can find."
- **Rules:** changing password logs you out ("Password successfully updated. Please, log back in."); demo accounts cannot change it; mismatch "Passwords don't match. Please, verify your input and try again."

#### 4.29 Encrypted backups (Profile)

- **What / why:** One-click, password-protected backups to a folder that a sync app (Google Drive for desktop, rclone, Dropbox...) uploads. No Google sign-in inside MyFin.
- **Elements:** **Back up now** (asks **Password** + **Confirm password**; "At least 8 characters"; warning "A forgotten password means this backup can't be restored. There is no way to recover it."), backup list ("No backups yet") with **Restore** per file (password dialog; "Restoring replaces ALL your current data with the contents of this backup."), **Confirm** / **Cancel**. If the server folder is not configured/writable: "Folder backups are unavailable" and the buttons are disabled.
- **Selectors:** section `#folder-backups-header`; buttons by text (needs `data-tour="backup-now"`, `data-tour="backup-list"`).
- **Tour:** 1) Back up now - "Choose a password you will remember; we can't recover it." 2) List - "Newest first; restore any."
- **Rules:** manual only (no schedule). Files named `myfin-backup-YYYY-MM-DD-HHmm.myfin` in `BACKUP_DIR/<username>/`; AES-256-GCM with a key from your password (scrypt); the **newest 30** are kept. Password at least 8 characters ("Password must have at least 8 characters"); wrong password/corrupted file = "Wrong password or corrupted backup" (UI: "Restore failed. Check the password and try again."); file limit 200 MB; usernames with unusual characters cannot name a folder. Restore validates before deleting anything and then replaces all current data. The backup includes the new data (payee classifications, category fixed flags, etc.; older backups default new flags to off).

#### 4.30 "If something happens to me" (legacy file)

- **What / why:** A printable file so family can find every account, policy, loan and contact. **It never stores passwords, PINs or OTPs** (banner: "Never store passwords, PINs or OTPs. Say where to find things, not the secrets themselves.").
- **Where:** Profile > **If something happens to me** (section; "A printable file for your family: accounts, policies, loans and contacts"). **Open printable version** -> `/settings/legacy/print` ("Generated on <date>", **Save as PDF** uses the browser print, **Go back**, reminder "Regenerate after changes").
- **Elements:** sections Accounts (prefilled from MyFin: bank/branch, nominee, document location), **Insurance policies** (insurer, policy number, sum assured, nominee, claim helpline; "Suggested from your payments:" chips), **Loans and EMIs** and **Money owed to you and by you** ("Read live from your Debts"), **Key contacts**, **Instructions**; **Add** / **Edit** / **Delete** per item; dialog **Save**. Selectors: section `#legacy-header`; others by text (needs `data-tour="legacy-add"`, `data-tour="legacy-print"`).
- **Rules:** entries with a key or value matching `password|passcode|pin|otp|cvv` are rejected: "Don't store passwords, PINs or OTPs here". Loans and people balances are read live at print time. Deleting an account removes its legacy entry. Included in backups.
- **Tour:** 1) Banner - "Say where to find things, never the secrets." 2) Add - "Add policies and contacts." 3) Open printable version - "Save as PDF and keep it safe." trigger on demand.

#### 4.31 Tools (Profile > Tools)

- **What:** **Export data** (unencrypted JSON of everything: warning "Beware! An unencrypted JSON file will be generated containing all records associated with your user account."), **Import data** (restore from a backup file, drop zone "Drag & drop your file here or click to select a file"; "The backup file you uploaded is not compatible with your current API version"), **Recalculate balances of all accounts**, **Automatically populate with mock data** (resets everything: "All your current data will be lost!").
- **Rules:** exported JSON is not encrypted - prefer **Encrypted backups**. Selectors: section `#tools-header`; buttons by text (needs `data-tour="tools-export"`).

### GROUP H - Original MyFin pages (brief)

| Page | Route | What it is / key elements | Notes for DAP |
|---|---|---|---|
| Entities | `/entities` (**Meta > Entities**) | Payees/merchants. **Add Entity**, Search `#search`, Edit/Delete. | Entities are optional; the Insights "payee key" does **not** use entities (it is derived from the description). Rules can assign entities. |
| Tags | `/tags` (**Meta > Tags**) | Free labels on transactions. **Add Tag**. | Event tags `event:<name>` are created automatically by Events. |
| Rules | `/rules` | see 4.5 | |
| Categories | `/categories` | see 4.4 | |
| Accounts | `/accounts` | see 4.2 | |
| Budgets / Matrix | `/budgets`, `/budgets/matrix`, `/budget/:id` | see 4.10; the matrix ("Add a budget month", "Start from" Blank month / existing month; "A budget already exists for that month.") | Marked Beta. |
| Investments | `/invest` | see 4.23 | |
| Stats | `/stats` | see 4.20 | |
| Goals | `/goals` | see 4.11 (extended) | |
| Profile | `/profile` | see 4.28 | |

---

## 5. Cross-feature concepts (glossary)

| Term | Plain-language meaning |
|---|---|
| **Counted rows** | The income and expenses that "count" in Insights and every new card. Not counted: transfers between your accounts, balance write-offs, planned (not-yet-real) transfers, money lent/borrowed and repayments, loan payouts, and the principal part of an EMI. The interest part of an EMI does count. |
| **Effective month** | The month a transaction is credited to for analysis. Normally its calendar month. A salary (income in your Salary category) received on or after the **salary cut-off day** (default 25) counts for the **next** month, so "November's" money is the late-October salary. Shown as "counted in <month>" on the row. |
| **Salary category / cut-off day** | Profile settings that define which income is salary and from which day it is treated as next month's. |
| **Typical month** | Average of the up-to-3 months before the selected one that have data, with one-off items and yearly-cost payments removed. Used for "vs typical", forecast, fixed costs, emergency fund and health. |
| **One-off** | An expense of ₹10,000 or more to a payee that did not appear in at least 2 of the 3 baseline months (e.g. a flight), or an income at least 1.5 x the median monthly income (a bonus). Left out of the typical month only. |
| **Fixed / Flexible / Not yet sorted** | Fixed = expenses in categories flagged **Fixed cost**; Flexible = other categorised expenses; Not yet sorted = no category. Whole categories, no partial state. |
| **Essential** | An older per-transaction flag used by Budgets. Independent of Fixed. |
| **Adjustment / write-off** | A transaction MyFin creates to make a balance match reality ("Reconciliation write-off", category "Balance adjustment"). Never counted as income or spending. |
| **Planned transaction** | A future transfer created by a confirmed salary plan. Shown greyed with a **Planned** chip; changes no balance or figure until you **Mark done** or **Match** it to the real one. |
| **Earmarked account** | An account with a job: Emergency fund, Sinking fund, or Savings (target) account. One job per account. Investment, credit-card and loan accounts cannot be earmarked. Retirement ticks are separate (may share the savings account only). |
| **Sinking fund** | A savings account where you set aside 1/12 of each yearly cost every month. |
| **Safe to spend** | What is left this month after bills still to come and savings set-asides: expected income - spent - fixed still to come - set-asides. |
| **Expected income** | The larger of what you have received so far this month and your typical monthly income. |
| **Freshness** | Whether an account has had a transaction recently enough (limit per account type). **Fresh ✓** or **Stale**. Only a new transaction refreshes it. |
| **Balance check** | Comparing MyFin's balance with the bank's; stored per account as matched / adjusted / open. |
| **Frozen month** | A past month's health score or review that has been saved and will no longer change. Freezes from day 11 of the following month (health also waits for card windows). |
| **Reconstructed** | A past month first opened more than two months after it ended; shown from today's data but never saved. |
| **Grace period** | The first 10 days of the next month, during which a balance check still counts for the previous month. |
| **Net worth** | Active non-investing account balances (credit/loan negative) + investment holdings at market value + money lent outstanding - money borrowed outstanding. Investment-account balances are not added (the holdings are). |
| **Savings rate** | (income - spending) / income. Meets the target when whole-number rounded values compare (19.6 % meets 20 %). |
| **Corpus (retirement)** | Your invested pot: ticked non-investing accounts + ticked investment assets at market value. |
| **Payee key** | The normalised description used to group payments by shop/person. |
| **Drill-down** | Clicking a figure to open Transactions filtered to exactly the rows behind it. |
| **Milestone** | A one-time achievement shown as a banner and a timeline entry. |

---

## 6. Launcher checklists for the DAP

"Completion signal" = what the app itself shows or data that proves the step is done (use it to tick items automatically; where there is no in-app signal a manual tick is needed).

### 6.1 Getting-started checklist (one-time)

| # | Item (label) | Link | Completion signal |
|---|---|---|---|
| 1 | Add your accounts | `#/accounts` | At least one account exists (Accounts table not empty). |
| 2 | Import your transactions | `#/transactions/import` | Transactions exist; Dashboard "Needs updating" no longer lists accounts. |
| 3 | Create categories and rules | `#/categories`, `#/rules` | At least one category; Insights "Not yet sorted" shrinking. |
| 4 | Mark your fixed costs | `#/categories` | At least one category with the "Fixed" chip; the Fixed vs flexible card / Safe to spend no longer shows "No fixed categories yet". |
| 5 | Fill in your Financial profile (salary category, cut-off, savings target, accounts, emergency months) | `#/profile` | Profile shows Salary category not "Not set"; Savings rate card shows "(target T% ...)". |
| 6 | Tick your emergency-fund account | `#/accounts` | Emergency fund card shows "N months covered" instead of the empty message. |
| 7 | Do your first Balance check | `#/accounts/balance-check` | Accounts page shows "Checked <date> · matched". |
| 8 | Add your yearly costs | `#/yearly-costs` | Sinking fund status card shows On track / Behind. |
| 9 | Add debts and loans (if any) | `#/debts` | Entries/loans listed. |
| 10 | Add events and money dates | `#/events` | Dashboard Upcoming card appears. |
| 11 | Create next month's budget | `#/insights` (Forecast) | Month review step "Plan next month's budget" = done. |
| 12 | Back up your data | `#/profile` | A file appears under Encrypted backups. |

### 6.2 Monthly routine checklist (on the 1st-10th)

| # | Item | Completion signal |
|---|---|---|
| 1 | Import stale accounts | Review step 1 "Import stale accounts" done; no "Needs updating" card. |
| 2 | Sort uncategorised spending | Review step 2 done ("Every expense has a category"). |
| 3 | Reconcile balances | Review step 3 done ("Balances are checked"); Health "Up-to-date data" passes. |
| 4 | Plan the salary (when it lands) and settle planned transfers | Salary day card shows "Your plan for <month> is set."; review step 4 done; `/salary-plan/<month>` shows "N of N transfers done". |
| 5 | Review Insights and tick it | Review step 5 done (manual tick - the only manually ticked step). |
| 6 | Create next month's budget | Review step 6 done. |
| 7 | Look at Health and fix any cross | Health card "Every check you've set up passes this month." |
| 8 | Pay yearly set-aside / top-ups | Yearly costs status "On track"; Safe to spend set-aside lines show "Already transferred". |
| 9 | Check milestones | Banner or new Milestones entry (automatic). |

Whole checklist complete signal: Dashboard review card disappears (it hides when the review is complete).

---

## 7. Instrumentation gaps

### 7.1 Proposed `data-tour` attributes

Existing stable hooks are few: ids on Profile section headers and Financial-profile fields, `name`/`id` on dialog fields (account, category, rule fields, transaction dialog), `#search`, `#forecast`, `[data-testid="salary-plan-free"]` (the only `data-testid` in the web app) and many `aria-label`s (icons, month pickers, health/review bars, calendar tiles, emergency-fund meter). Everything else needs the attributes below. Paths are relative to `myfin-web/src/`.

| # | Proposed `data-tour` | File | Component | Element |
|---|---|---|---|---|
| 1 | `nav-dashboard` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Dashboard" |
| 2 | `nav-transactions` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Transactions" |
| 3 | `nav-budgets` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Budgets" |
| 4 | `nav-accounts` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Accounts" |
| 5 | `nav-investments` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Investments" |
| 6 | `nav-goals` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Goals" |
| 7 | `nav-meta` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Meta (sub-menu)" |
| 8 | `nav-categories` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Meta > Categories" |
| 9 | `nav-entities` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Meta > Entities" |
| 10 | `nav-tags` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Meta > Tags" |
| 11 | `nav-rules` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Meta > Rules" |
| 12 | `nav-insights` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Insights" |
| 13 | `nav-health` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Health" |
| 14 | `nav-review` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Month review" |
| 15 | `nav-events` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Events" |
| 16 | `nav-milestones` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Milestones" |
| 17 | `nav-yearly-costs` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Yearly costs" |
| 18 | `nav-debts` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Debts" |
| 19 | `nav-retirement` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Retirement" |
| 20 | `nav-stats` | `components/MyFinSidebar.tsx` | MyFinSidebar | Menu item "Stats" |
| 21 | `login-form` | `features/auth/Login.tsx` | Login | Username/Email/Password block |
| 22 | `login-submit` | `features/auth/Login.tsx` | Login | Sign In / Sign Up button |
| 23 | `accounts-add` | `features/accounts/Accounts.tsx` | Accounts | Add Account button |
| 24 | `accounts-balance-check` | `features/accounts/Accounts.tsx` | Accounts | Balance check button |
| 25 | `accounts-tabs` | `features/accounts/Accounts.tsx` | Accounts | All / Operating Funds / Debt / Investments / Others tabs |
| 26 | `accounts-table` | `features/accounts/Accounts.tsx` | Accounts | Accounts table (Fresh / Stale chips) |
| 27 | `account-status` | `features/accounts/AddEditAccountDialog.tsx` | AddEditAccountDialog | Active / Inactive toggle |
| 28 | `import-paste` | `features/transactions/import/ImportTrxStep0.tsx` | ImportTrxStep0 | Continue (clipboard) button |
| 29 | `import-phonepe-upload` | `features/transactions/import/ImportTrxStep0.tsx` | ImportTrxStep0 | Upload PhonePe statement button |
| 30 | `import-date-format` | `features/transactions/import/ImportTrxStep1.tsx` | ImportTrxStep1 | Date format chip |
| 31 | `import-review` | `features/transactions/import/ImportTrxStep2.tsx` | ImportTrxStep2 | Review table |
| 32 | `import-confirm` | `features/transactions/import/ImportTrxStep2.tsx` | ImportTrxStep2 | Import button |
| 33 | `categories-add` | `features/categories/Categories.tsx` | Categories | Add Category button |
| 34 | `categories-table` | `features/categories/Categories.tsx` | Categories | Categories table with Fixed chip column |
| 35 | `rules-add` | `features/rules/Rules.tsx` | Rules | Add Rule button |
| 36 | `rule-conditions` | `features/rules/AddEditRuleDialog.tsx` | AddEditRuleDialog | Conditions section |
| 37 | `rule-result` | `features/rules/AddEditRuleDialog.tsx` | AddEditRuleDialog | Result section |
| 38 | `profile-savings-mode` | `features/profile/FinancialProfileForm.tsx` | FinancialProfileForm | Savings target Amount / Percent toggle |
| 39 | `profile-financial-save` | `features/profile/FinancialProfileForm.tsx` | FinancialProfileForm | Save button |
| 40 | `dashboard-month` | `features/dashboard/Dashboard.tsx` | Dashboard | Month picker |
| 41 | `dash-charts` | `features/dashboard/Dashboard.tsx` | Dashboard | Chart grid (Monthly Overview ... Debt Distribution) |
| 42 | `dash-needs-updating` | `features/dashboard/NeedsUpdatingCard.tsx` | NeedsUpdatingCard | Needs updating card |
| 43 | `milestone-banner` | `features/milestones/MilestoneBanner.tsx` | MilestoneBanner | Banner |
| 44 | `dash-savings-rate` | `features/insights/SavingsRateCard.tsx` | SavingsRateCard | Card |
| 45 | `dash-salary-plan` | `features/salaryPlan/SalaryPlanCard.tsx` | SalaryPlanCard | Salary day card |
| 46 | `salary-plan-cta` | `features/salaryPlan/SalaryPlanCard.tsx` | SalaryPlanCard | Plan this salary button |
| 47 | `dash-month-review` | `features/review/MonthReviewCard.tsx` | MonthReviewCard | Review card |
| 48 | `dash-upcoming` | `features/events/UpcomingCard.tsx` | UpcomingCard | Upcoming card |
| 49 | `health-score` | `features/health/HealthScoreCard.tsx` | HealthScoreCard | Health card |
| 50 | `dash-safe-to-spend` | `features/insights/SafeToSpendCard.tsx` | SafeToSpendCard | Card (Dashboard and Insights) |
| 51 | `sts-details` | `features/insights/SafeToSpendCard.tsx` | SafeToSpendCard | "See how this is worked out" button |
| 52 | `dash-emergency-fund` | `features/insights/EmergencyFundCard.tsx` | EmergencyFundCard | Card (Dashboard and Insights) |
| 53 | `trx-add` | `features/transactions/Transactions.tsx` | Transactions | Add Transaction button |
| 54 | `trx-import` | `features/transactions/Transactions.tsx` | Transactions | Import Transactions button |
| 55 | `trx-filters` | `features/transactions/Transactions.tsx` | Transactions | All / Debit / Credit / Transfer / Planned chips |
| 56 | `trx-filter-chips` | `features/transactions/Transactions.tsx` | Transactions | Drill-down filter chips |
| 57 | `trx-bulk-bar` | `features/transactions/Transactions.tsx` | Transactions | Selection bar (Select all N matching / Edit N selected) |
| 58 | `planned-actions` | `features/transactions/PlannedTransactionsList.tsx` | PlannedTransactionsList | Mark done / Skip / Match... buttons |
| 59 | `bc-table` | `features/accounts/BalanceCheck.tsx` | BalanceCheck | Table |
| 60 | `bc-real-input` | `features/accounts/BalanceCheck.tsx` | BalanceCheck | Real balance input |
| 61 | `bc-save` | `features/accounts/BalanceCheck.tsx` | BalanceCheck | Save check button |
| 62 | `bc-add-missing` | `features/accounts/BalanceCheck.tsx` | BalanceCheck | Add missing transaction button |
| 63 | `bc-writeoff` | `features/accounts/BalanceCheck.tsx` | BalanceCheck | Write it off button |
| 64 | `budgets-add` | `features/budgets/list/BudgetList.tsx` | BudgetList | Add Budget button |
| 65 | `goals-new` | `features/goals/Goals.tsx` | Goals | New Goal button |
| 66 | `goals-summary` | `features/goals/Goals.tsx` | Goals | Summary tiles |
| 67 | `goal-funding-accounts` | `features/goals/AddEditGoalDialog.tsx` | AddEditGoalDialog | Funding Accounts section |
| 68 | `goal-investments` | `features/goals/AddEditGoalDialog.tsx` | AddEditGoalDialog | Investments section |
| 69 | `yc-status` | `features/yearlyCosts/YearlyCosts.tsx` | YearlyCosts | Sinking fund status card |
| 70 | `yc-suggestions` | `features/yearlyCosts/YearlyCosts.tsx` | YearlyCosts | Suggested from your history card |
| 71 | `yc-list` | `features/yearlyCosts/YearlyCosts.tsx` | YearlyCosts | Your yearly costs list |
| 72 | `yc-add` | `features/yearlyCosts/YearlyCosts.tsx` | YearlyCosts | Add yearly cost button |
| 73 | `salary-plan-bucket-fixed` | `features/salaryPlan/SalaryPlanDialog.tsx` | SalaryPlanDialog | Bucket row "fixed" (amount + Transfer to) |
| 74 | `salary-plan-bucket-yearly` | `features/salaryPlan/SalaryPlanDialog.tsx` | SalaryPlanDialog | Bucket row "yearly" (amount + Transfer to) |
| 75 | `salary-plan-bucket-emergency` | `features/salaryPlan/SalaryPlanDialog.tsx` | SalaryPlanDialog | Bucket row "emergency" (amount + Transfer to) |
| 76 | `salary-plan-bucket-savings` | `features/salaryPlan/SalaryPlanDialog.tsx` | SalaryPlanDialog | Bucket row "savings" (amount + Transfer to) |
| 77 | `salary-plan-confirm` | `features/salaryPlan/SalaryPlanDialog.tsx` | SalaryPlanDialog | Confirm plan button |
| 78 | `salary-plan-table` | `features/salaryPlan/SalaryPlanView.tsx` | SalaryPlanView | Bucket table |
| 79 | `forecast-create` | `features/insights/ForecastCard.tsx` | ForecastCard | Create <Month> budget button |
| 80 | `forecast-compare` | `features/insights/ForecastCard.tsx` | ForecastCard | Compare dialog (Fill only empty / Replace all) |
| 81 | `insights-month` | `features/insights/Insights.tsx` | Insights | Month picker (has aria-label; add for tour anchor) |
| 82 | `insights-summary` | `features/insights/SummaryCards.tsx` | SummaryCards | Income/Spending/Savings/Savings rate cards |
| 83 | `insights-fixed-flexible` | `features/insights/FixedFlexibleCard.tsx` | FixedFlexibleCard | Card |
| 84 | `insights-small-spends` | `features/insights/SmallSpendsCard.tsx` | SmallSpendsCard | Card |
| 85 | `insights-calendar` | `features/insights/SpendingCalendar.tsx` | SpendingCalendar | Card |
| 86 | `calendar-flexible` | `features/insights/SpendingCalendar.tsx` | SpendingCalendar | Flexible only switch |
| 87 | `insights-where-money-went` | `features/insights/WhereMoneyWent.tsx` | WhereMoneyWent | Card |
| 88 | `wmw-toggle` | `features/insights/WhereMoneyWent.tsx` | WhereMoneyWent | By category / By merchant / By person toggle |
| 89 | `insights-biggest-changes` | `features/insights/BiggestChanges.tsx` | BiggestChanges | Card |
| 90 | `insights-payment-mix` | `features/insights/PaymentMix.tsx` | PaymentMix | Card |
| 91 | `insights-trend` | `features/insights/TrendChart.tsx` | TrendChart | 12-month trend chart |
| 92 | `insights-net-worth` | `features/insights/NetWorthCard.tsx` | NetWorthCard | Card |
| 93 | `insights-figure` | `features/insights/FigureLink.tsx` | FigureLink | Clickable figure link (add to first instance via prop) |
| 94 | `stats-tabs` | `features/stats/Stats.tsx` | Stats | Tabs |
| 95 | `invest-tabs` | `features/invest/Invest.tsx` | Invest | Tabs |
| 96 | `debts-tabs` | `features/debts/Debts.tsx` | Debts | People / Loans tabs |
| 97 | `debts-people-totals` | `features/debts/PeopleTab.tsx` | PeopleTab | Totals line |
| 98 | `debts-add-entry` | `features/debts/PeopleTab.tsx` | PeopleTab | Add entry button |
| 99 | `debts-mark-repayment` | `features/debts/PeopleTab.tsx` | PeopleTab | Mark repayment button |
| 100 | `debts-add-loan` | `features/debts/LoansTab.tsx` | LoansTab | Add loan button |
| 101 | `loan-schedule` | `features/debts/LoansTab.tsx` | LoansTab | Schedule table |
| 102 | `loan-whatif` | `features/debts/LoansTab.tsx` | LoansTab | Prepayment what-if panel |
| 103 | `retire-results` | `features/retirement/Retirement.tsx` | Retirement | Result tiles |
| 104 | `retire-chart` | `features/retirement/Retirement.tsx` | Retirement | Projected corpus chart |
| 105 | `retire-save` | `features/retirement/Retirement.tsx` | Retirement | Save as my settings button |
| 106 | `review-step-import` | `features/review/ReviewStepRow.tsx` | ReviewStepRow | Step row "import" |
| 107 | `review-step-sort` | `features/review/ReviewStepRow.tsx` | ReviewStepRow | Step row "sort" |
| 108 | `review-step-reconcile` | `features/review/ReviewStepRow.tsx` | ReviewStepRow | Step row "reconcile" |
| 109 | `review-step-planned` | `features/review/ReviewStepRow.tsx` | ReviewStepRow | Step row "planned" |
| 110 | `review-step-review` | `features/review/ReviewStepRow.tsx` | ReviewStepRow | Step row "review" |
| 111 | `review-step-plan` | `features/review/ReviewStepRow.tsx` | ReviewStepRow | Step row "plan" |
| 112 | `review-tick` | `features/review/ReviewStepRow.tsx` | ReviewStepRow | "I've reviewed this month in Insights" checkbox |
| 113 | `health-check-savings_rate` | `features/health/HealthCheckRow.tsx` | HealthCheckRow | Check row "savings_rate" |
| 114 | `health-check-emergency_fund` | `features/health/HealthCheckRow.tsx` | HealthCheckRow | Check row "emergency_fund" |
| 115 | `health-check-yearly_costs` | `features/health/HealthCheckRow.tsx` | HealthCheckRow | Check row "yearly_costs" |
| 116 | `health-check-fixed_costs` | `features/health/HealthCheckRow.tsx` | HealthCheckRow | Check row "fixed_costs" |
| 117 | `health-check-credit_cards` | `features/health/HealthCheckRow.tsx` | HealthCheckRow | Check row "credit_cards" |
| 118 | `health-check-debt_emis` | `features/health/HealthCheckRow.tsx` | HealthCheckRow | Check row "debt_emis" |
| 119 | `health-check-data` | `features/health/HealthCheckRow.tsx` | HealthCheckRow | Check row "data" |
| 120 | `events-add` | `features/events/Events.tsx` | Events | Add event button |
| 121 | `events-suggestions` | `features/events/Events.tsx` | Events | Suggested events card |
| 122 | `milestones-list` | `features/milestones/Milestones.tsx` | Milestones | Timeline |
| 123 | `backup-now` | `features/profile/FolderBackups.tsx` | FolderBackups | Back up now button |
| 124 | `backup-list` | `features/profile/FolderBackups.tsx` | FolderBackups | Backup list |
| 125 | `legacy-add` | `features/profile/LegacyFile.tsx` | LegacyFile | Add buttons |
| 126 | `legacy-print` | `features/profile/LegacyFile.tsx` | LegacyFile | Open printable version button |
| 127 | `tools-export` | `features/profile/Utilities.tsx` | Utilities | Export data button |

**Total: 127 elements flagged as needing `data-tour` attributes.** Naming rule: kebab-case, page prefix; for repeated rows add the record id, e.g. `data-tour="trx-row-<id>"` (not listed above).


### 7.2 Other gaps noticed (empty states, confusing labels)

| Area | Observation | Suggestion |
|---|---|---|
| Accounts / Categories / Rules / Tags / Entities | No dedicated first-time empty state or "add your first X" prompt; empty tables show the generic "No record found". | Add an empty-state component per page (also a natural DAP trigger). |
| Dashboard | Cards hide themselves entirely when empty, so a first-time user sees almost nothing explaining what is missing. | A "Getting started" card driven by section 6.1, or let the DAP launcher do it. |
| Dashboard | Month picker only affects the charts, not the cards; easy to misread. | Label or move it. |
| Menu | "Meta" (sub-menu for Categories/Entities/Tags/Rules) is not self-explanatory; "Stats" vs "Insights" vs "Health" overlap in name. | Consider renaming ("Setup"/"Organise") or add tooltips. |
| Menu | Profile is reachable only via an unlabeled top-bar icon (`aria-label="profile"`, no visible text). | Tooltip. |
| Review/Health | "Month review" (menu) vs "Month-end review" (page title) vs "<Month> review" (card). | Align names. |
| Safe to spend / Forecast | Savings-target maths differ slightly by design (percent of **expected income** in Safe to spend vs of **the salary** in the Salary plan). Users may see different numbers. | Mention in tooltip. |
| Top bar "Net Worth" and Stats "Net Worth Evolution" vs Insights "Net worth change" | Different code paths; may not agree (verify in app). | Reconcile or explain. |
| Beta chips | Goals, Budgets matrix and Investments carry "Beta"/"updated" notices that may distract from tours. | Hide the DAP step if the banner overlaps. |
| Transactions | Many one-icon row actions share the same aria-label across rows (e.g. "Edit", "Delete"). | Add row ids (`data-tour` + transaction id) for row-specific steps. |
| i18n | Tours keyed on text break in other languages (the app ships more than English). | Prefer `data-tour` selectors. |
| Sidebar | Collapsed sidebar on small screens hides text labels. | Selectors must not depend on text. |

---

## 8. Known limitations and not-yet-verified notes

- **Not walked through in a browser.** The newer pages (Insights and its cards, Safe to spend, Emergency fund, Yearly costs, Salary plan, Balance check, Freshness, Health, Month review, Events, Milestones, Debts/Loans, Retirement, Goals-investments, Encrypted backups, "If something happens to me") were built and tested with automated tests (API integration/unit tests, web type-check/build) but **have not yet been manually walked through in a browser**. Treat labels, layout, element locations and selector suggestions as code-derived and verify in the running app before recording a tour.
- **Spec vs code:** this file follows the code. Differences found: earmarks (credit/loan accounts are also never earmarkable; a retirement tick exists and may overlap the savings account); safe-to-spend deducts max(target, transferred) and prefers the confirmed salary plan's buckets; planned rows live in their own `planned_transactions` table; the emergency meter colours follow the 1-decimal rounded figure; the savings-target check compares whole-percent rounded values; retirement "All spending" includes the yearly set-aside; the review card shows only on days 1-10; goal on-track uses the average of buys over the last 6 full months.
- **Things deliberately inconsistent with the original app:** Budgets actuals, Stats and the Dashboard charts use the original rules and do not exclude write-offs or debt principal as Insights does; the top-bar Net Worth may not equal Insights' net-worth definition.
- **Time zone:** all months/days are IST (the API must run with `TZ=Asia/Kolkata`); users in other zones will see boundaries at IST midnight.
- **Not built / out of scope:** weekly check-in (skipped by the user), e-mail reminders, scheduled backups, Google OAuth backups, PDF/other-bank statement import, detection of own-account PhonePe self-payments.
- **Verify in app:** exact placement of dialogs (e.g. the Month picker's accessible name on Insights), sign-in field names, Profile menu discoverability, whether the paste-import warns on duplicates, top-bar Net Worth definition, whether the Upcoming card hides when empty, Dashboard "New Transaction"/"New Budget" strings that exist in the locale file but were not seen in the Dashboard code.
- Other languages: the locale file ships multiple languages (English used here); newer pages may be missing translations (verify).

---

## 9. Business rules reference (consolidated)

### 9.1 What counts

| Figure / feature | Includes | Excludes |
|---|---|---|
| Insights income & spending, savings rate, typical month, small spends, calendar, forecast, safe-to-spend "spent so far", health savings check | Income (I) and expense (E) rows; EMI **interest** rows | Transfers (T); balance adjustments / write-offs; planned rows; lent/borrowed principal; repayments; loan disbursement income; EMI principal. Yearly-cost-linked expenses are additionally left out of *typical* and *safe-to-spend spent so far* (and added back once in the forecast). |
| Net-worth "Saved from income" | counted income - counted spending by calendar month | same exclusions |
| Net worth | active non-investing accounts (+ loan/credit negative), invest holdings at market value, lent outstanding, minus borrowed outstanding | Investment-account balances (double count), inactive accounts |
| Emergency fund | ticked **active** accounts (negatives = 0) | investment/assets, credit, loan, inactive |
| Retirement corpus | ticked active non-investing accounts (negatives = 0) + ticked assets' latest value | Investment-account balances |
| Balances | real transactions only | planned rows until Mark done |

### 9.2 Time rules

| Rule | Detail |
|---|---|
| IST months | Every month/day boundary is IST. |
| Effective month | Salary-category income dated >= cut-off day (default 25; 1-28) belongs to next month. Calendar rows use their IST month. Drill-down uses the same rule. Calendar heatmap and the net-worth "saved" part use plain calendar days/months. |
| Typical baseline | 3 effective months before the selected month that have data (<3 allowed; 0 = no comparison). |
| Safe-to-spend window | Set-aside transfers counted from previous cut-off to this cut-off when a salary category exists; else calendar month. Days left include today (min 1). |
| Salary-plan trigger | Last 40 days, current/next effective month only, earliest unplanned; planned row overdue after 15 days. |
| Review card | Day 1-10 (IST), previous month, hidden if complete / no data. |
| Freshness | Days since last transaction > limit = Stale (limit by type; 0 = never). |
| Health freeze | Day 11 of M+1 and card windows closed; cap M+1 +36 days; from M+3 first read = Reconstructed. |
| Review freeze | When complete, or first read from day 11 of M+1; from M+3 = Reconstructed. |
| Balance-check grace | Check dated in M or first 10 days of M+1 counts for M. |
| Event dates | 31st / 29 Feb clamp to month end. Upcoming = next 30 days + up to 7 days overdue. |
| Loan dates | EMI day clamps to month length; missed after 5 days unpaid. |

### 9.3 Thresholds and tolerances

| Rule | Value |
|---|---|
| One-off expense | >= ₹10,000 and payee in < 2 of 3 baseline months |
| One-off income | >= 1.5 x median monthly income of baseline |
| Emergency colours (rounded to 0.1 month) | red < 3; amber 3 <= x < target; green >= target (default target 6; 1-24) |
| Emergency top-up | min(gap, top-up % of salary [plan] or of expected income [safe-to-spend]); default 10 % (0-100) |
| Health | fixed <= 50 % of typical income; loan EMIs <= 40 %; card cleared within 35 days (tolerance ₹1); balance check by day 10 of next month |
| Savings target met | round(rate %) >= round(target %) |
| Small spend | strictly < cut-off (default ₹200; max ₹100,000) |
| Yearly-cost suggestion | >= ₹5,000, in last 13 months, none from that payee in the 10 months before |
| Forecast | seasonal factor clamp 0.5-1.5 (needs last-year data for the month and 3 before); round to ₹100; range = quadrature of per-category SD |
| Planned-row match | same accounts, amount within ₹1, date within 7 days |
| EMI match | amount within ±₹1; within 45 days (suggestions 10 days); missed > 5 days; closed with residual <= ₹1 |
| Event auto-match | ±5 days; amount ±10 % when set; back-look 35 days; gift window -60/+7 days; link dialog needs an occurrence within 90 days |
| Event suggestions | payee in >= 3 of last 4 months, days within 3 of each other; cards with >= 2 transfers in over 4 months |
| Milestones | net-worth ₹1L/5L/10L/25L/50L/1Cr; streak = 3 months; first-run banner window 30 days |
| Heatmap | 5 shades, quantiles 20/40/60/80 %; range <= 400 days |
| Backups | keep newest 30; password >= 8 chars; file <= 200 MB |
| Loans | tenure 1-600 months; EMI day 1-31; rate >= 0; EMI > monthly interest |
| Retirement | defaults return 10 %, inflation 6 %, SWR 3.5 %, retirement age 60 (max 80); projection to age 90; family support years <= 60 |

### 9.4 Formulas

| Name | Formula |
|---|---|
| Safe to spend | expected income - spent so far - fixed still to come - savings deducted - yearly deducted - emergency deducted |
| Expected income | max(received this month, typical monthly income) |
| Fixed still to come | sum over fixed categories of max(0, typical - spent this month) |
| Set-aside deducted | max(target, transferred); still to transfer = max(0, target - transferred) |
| Per day | safe / days left (incl. today) |
| Emergency months | fund / typical monthly fixed |
| Emergency gap | max(0, target x monthly fixed - fund) |
| Yearly set-aside | sum(active yearly amounts) / 12 |
| Should have by now | sum(amount x ((current month - due month + 12) mod 12) / 12) |
| Behind by | max(0, should have - sinking balance) |
| Catch-up transfer | behind + monthly total |
| Salary plan free | salary - fixed - yearly - emergency - savings |
| Savings rate | (income - spending) / income |
| EMI | P r (1+r)^n / ((1+r)^n - 1), r = rate/12/100; 0 % = ceil(P/n) |
| Interest / principal split | interest = round(balance x r); principal = EMI - interest; last row pays the remaining balance |
| Retirement corpus needed | annual spending x (1+inf)^n / SWR + PV of family support |
| Net-worth change parts | saved + investment growth + write-offs + other = change (other = remainder) |
| Investment growth | end value - start value - (buys - sells) |
| Goal on track | funding x (1+m)^k + SIP x ((1+m)^k - 1)/m >= target, m = return/12/100 |

### 9.5 Data dependencies (what feeds what)

| Feeds | From |
|---|---|
| Fixed vs flexible, Safe to spend, Emergency meter, Health (Fixed costs, Emergency), Forecast, Salary plan "Fixed costs", Retirement (basis "Fixed") | **Fixed cost** flag on categories |
| Savings rate target, Safe to spend savings line, Salary plan Savings bucket, Health savings check, Retirement default monthly investment | Profile **Savings target** (mode + value) |
| Salary day card, effective-month shifting, Safe to spend window | Profile **Salary category** + **cut-off day** |
| Emergency card, top-up bucket, Health check | accounts ticked **Emergency fund** + target months |
| Yearly set-aside (Safe to spend, Salary plan, Health, Forecast, Retirement "All") | **Yearly costs** + Sinking-fund account |
| Freshness, Needs updating card, review steps 1/3, Health "Up-to-date data" | account type/limits, last transactions, **Balance checks** |
| Month review step 4 | planned transfers from **Salary plans** |
| Month review step 6 | **Budgets** (create via Forecast) |
| Health Loan EMIs, net worth, Upcoming (EMIs), milestones (debt cleared) | **Debts > Loans/People** |
| Goals progress | account balances + investment assets (market value) + buys (SIP) |
| Milestones | net worth, emergency fund, goals, savings trend, health & review frozen records, debts |
| Net worth card / milestone thresholds | accounts, investments, debts |

### 9.6 Validation and error messages users can hit (selection)

| Area | Message |
|---|---|
| Financial profile | "salary_cutoff_day must be an integer between 1 and 28." · "emergency_fund_target_months must be an integer between 1 and 24." · "emergency_topup_percent must be an integer between 0 and 100." · "small_spend_cutoff must be greater than 0 and at most 100000." · "A percent savings target must be an integer between 0 and 100." · "retirement_age must be above your current age." · "date_of_birth must be a real past date as YYYY-MM-DD." |
| Earmarks | "This account is already the <role> account; an account can hold only one earmarked role." · "An investment account cannot be earmarked." · "A credit card or loan account cannot be earmarked." |
| Balance check | "Nothing to write off: the balances already match." |
| Salary plan | "A salary plan already exists for this month." · "The transaction is not a salary income." · "The salary does not belong to that month." · "Bucket amounts cannot be negative." · "Investment accounts cannot receive a salary-plan transfer." · "Inactive accounts cannot receive a salary-plan transfer." · "A salary-plan transfer cannot go to the account the salary was paid into." |
| Planned rows | "This transaction does not match the planned one" · "This transaction is already recorded for another planned transfer" |
| Yearly costs | "due_month must be between 1 and 12." · "Only expense transactions can be linked." · "This transaction is linked to a debt. Unlink it from the debt first." |
| Forecast | "A budget already exists for this month." · "month must be YYYY-MM" |
| Debts | "A name is required." · "amount must be positive." · "This transaction is already linked to a debt." · "A repayment cannot be dated before the entry started." · "Delete or unlink the debt entry first." · "This is a loan's opening balance. Delete the loan instead." · "The EMI must be more than the monthly interest." · "The amount must be within ₹1 of the EMI." |
| Events | "An event with this name already exists." · "The date must be a real YYYY-MM-DD date." · "Amounts must be zero or more." |
| Legacy file | "Don't store passwords, PINs or OTPs here" |
| Backups | "Password must have at least 8 characters" · "Wrong password or corrupted backup" · "Backup file is too large" |
| Review | "This month is frozen; its review can no longer change" · "A future month cannot be reviewed" |
| Heatmap API | "The range may span at most 400 days" |
| Import | "This doesn't look like a PhonePe statement CSV." · "This file is too large to import." · "No new transactions in this statement." |

---

## 10. Gotchas users will hit

1. **Month-end salary counts next month.** A salary-category income on or after the cut-off day (default the 25th) is credited to the *following* month in Insights, savings rate, safe to spend and the salary plan. It carries a "counted in <month>" note. Without a Salary category set, no shifting happens.
2. **Write-offs are not spending.** "Write it off" creates an Adjustment excluded from Insights; it only appears under "Write-offs" in the net-worth card.
3. **Transfers are not spending.** UPI Lite top-ups, credit-card bill payments and moves between your accounts do not count. The *card purchases* are the spending.
4. **EMIs split into interest and principal.** Only the interest is spending; principal reduces the loan. Matching an EMI changes the original debit's amount to the interest part (reversible with **Unpay**).
5. **Planned rows don't affect balances** or any figure until **Mark done** (or matched to the real transaction).
6. **Health/Review months freeze after day 11** of the next month (health also waits for card payment windows, max 36 days). Later edits do not change a frozen month. A month first opened 3+ months late is "Reconstructed" and always live.
7. **Passwords are refused in the legacy file** (keys/values containing password, passcode, PIN, OTP or CVV are rejected).
8. **Credit cards show what you owe.** In Balance check type the amount owed. A card paid in full requires *transfers into the card* within 35 days; payments recorded as expenses do not satisfy the health check.
9. **"Not yet sorted" is never budgeted or counted as flexible.** Categorise to make fixed/flexible accurate.
10. **An account can have only one job** (emergency / sinking / savings); investment, credit and loan accounts have none.
11. **A balance check does not make an account Fresh;** only a new transaction does. Inactive accounts are never flagged. Loan accounts are never stale.
12. **Typical month drops one-offs and yearly-cost payments.** A ₹12,000 insurance premium will not inflate "typical" if it is a one-off or linked to a yearly cost.
13. **Small spends use strict "below"** the cut-off.
14. **The Dashboard month picker only drives the budget charts;** cards always show the current month (review: previous).
15. **Safe to spend can turn red even with income left** because set-asides and fixed costs still to come are subtracted; transfers already made still count as set aside (the larger of target and transferred).
16. **Percent vs amount savings targets differ by place:** Safe to spend uses % of expected income; the Salary plan uses % of that salary.
17. **Forecast never changes categories that have a budget breakdown or are inactive.** It skips them.
18. **Linked rows are protected:** debt-origin rows, loan opening balances and matched EMI rows cannot be deleted or have amount/date/accounts edited until unlinked/unpaid; a row can be linked to a yearly cost or a debt, not both.
19. **Demo account:** data resets daily; password change is disabled.
20. **Backups are manual and the password cannot be recovered.** The unencrypted JSON export in Tools is not encrypted.
21. **Event names become tags** (`event:<name>`) and must be unique; deleting an event leaves the tag on transactions.
22. **Net worth excludes Investment-account balances on purpose** (the holdings are counted instead).
23. **Hash routes:** URLs look like `#/insights?month=2026-10`; DAP URL rules must match the hash fragment.
