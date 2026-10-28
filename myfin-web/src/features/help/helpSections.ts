import type { HelpSection } from './helpTypes.ts';

// Route paths are literals (see the note in helpContent.ts).
// Source: docs/adoption/myfin-tour-and-guide-source.md, sections 4.7 to 4.31.

export const MORE_SECTIONS: HelpSection[] = [
  // ---- Day-to-day ----
  {
    id: 'dashboard',
    group: 'Day-to-day',
    title: 'Dashboard',
    summary:
      'The home page. Cards at the top tell you what needs attention; charts below summarise the month.',
    route: '/dashboard',
    howTo: [
      'Start at the top: Savings rate, then the cards that need action (Needs updating, Salary day, Month review, Upcoming, Health).',
      'Safe to spend and Emergency fund always show, with a hint if they are not set up yet.',
      'Use the Month picker to change the month shown in the charts below the cards.',
      'Click a card\'s button (Import transactions, Plan this salary, Open the review, See details) to act on it.',
    ],
    rules: [
      'Each card hides itself when it has nothing to say. Only Savings rate, Safe to spend and Emergency fund always render.',
      'The Month picker only drives the charts. The cards always describe the current month (the review card describes the previous month).',
      'No Salary day card? A salary-category income must have landed in the last 40 days for the current or next month, with no plan yet, or a plan must exist.',
      'No review card? It only shows from the 1st to the 10th, for the previous month, while the review is incomplete.',
    ],
  },
  {
    id: 'transactions',
    group: 'Day-to-day',
    title: 'Transactions',
    summary:
      'The ledger. Add, edit, split, merge, bulk-edit and filter. Every figure on Insights drills down here.',
    route: '/transactions',
    howTo: [
      'Add: press Add Transaction, choose Expense, Transfer or Income, fill value, date and description, pick the accounts (From for an expense, To for income, both for a transfer), then the category, entity and tags.',
      'Bulk categorise: search, or follow an Insights drill-down; tick rows (or press "Select all N matching"); press "Edit N selected"; choose a Category; press Update and confirm.',
      'Filter with the All / Debit / Credit / Transfer / Planned chips. Planned also shows planned (not yet real) transfers.',
      'Arrived from Insights? The chips above the table show the active filter. Click x to remove one.',
    ],
    rules: [
      'Counted rows (what Insights treats as income and spending): Expense or Income, not an Adjustment, and not debt principal.',
      'Never counted: transfers, balance adjustments (write-offs), planned rows, lent or borrowed amounts and repayments, loan payouts and EMI principal. An EMI\'s interest row does count.',
      'The month filter uses the effective month: a salary received on or after the cut-off day shows "counted in <next month>".',
      'A row cannot be both a yearly cost and a debt. Linked rows have restrictions: unlink first to change their type, or delete the debt or loan instead of the row.',
      'A planned transfer that matches a new real row (same accounts, within 1, within 7 days) prompts "Mark as matched?". "Not now" leaves it.',
    ],
  },
  {
    id: 'balance-check',
    group: 'Day-to-day',
    title: 'Balance check',
    summary:
      'Once a month, compare each account with your bank app and fix gaps on the spot.',
    route: '/accounts/balance-check',
    howTo: [
      'Open Accounts > Balance check.',
      'Type the real balance for each account. For credit cards, type the amount you owe.',
      'A green "Matches" means all good. "Off by X" means a gap.',
      'For a gap, press "Add missing transaction" if you know what is missing, or "Write it off" for an unexplained small gap.',
      'Press Save check on each account.',
    ],
    rules: [
      'The comparison is exact to the cent: gap = real - MyFin. The stored result is matched, open, or adjusted after a write-off.',
      'A write-off adds one adjustment transaction dated now, in the category "Balance adjustment". It is not counted as income or spending.',
      'A balance check does not make an account Fresh; only a new transaction does.',
      'Inactive accounts are not listed.',
    ],
  },

  // ---- Planning ----
  {
    id: 'budgets',
    group: 'Planning',
    title: 'Budgets',
    summary:
      'A budget per month with planned income and expense per category, compared with what actually happened.',
    route: '/budgets',
    howTo: [
      'Open Budgets and press Add Budget, or create one from the Forecast on Insights.',
      'Type what you plan under Estimated for each category. Current shows what has happened.',
      'Use the Budget actions menu to clone a previous month, or open the Matrix view to see many months side by side (Beta).',
    ],
    rules: [
      'The Forecast writes planned amounts into the normal budget model. Categories with a breakdown or that are inactive are never changed by it.',
      'Budget actuals, Stats and the Dashboard charts use the original MyFin rules. They do not exclude write-offs or debt principal the way Insights does.',
      'Month-end review step 6 is done when a budget exists for next month.',
    ],
  },
  {
    id: 'goals',
    group: 'Planning',
    title: 'Goals',
    summary:
      'Savings goals with a target amount, optional due date and priority, funded from accounts and a share of investments.',
    route: '/goals',
    howTo: [
      'Open Goals and press New Goal.',
      'Fill Name, Target Amount, Priority and an optional due date.',
      'Under Funding Accounts, pick accounts with a fixed amount or a percentage.',
      'Under Investments, pick assets to count a share of them at market value.',
    ],
    rules: [
      'Higher priority numbers are funded first (priority 100 before priority 10).',
      'Funding = account funding + each linked asset\'s allocated share of its current market value.',
      'One asset can be split across goals, but never beyond 100%, and an amount cannot exceed what is left of the asset or the goal target.',
      'With a due date, a goal shows "on track" or "behind" using the average monthly buys of the linked assets over the last 6 months and your expected return.',
      'A fully funded goal fires a milestone. Goals cannot use emergency or sinking accounts.',
    ],
  },
  {
    id: 'yearly-costs',
    group: 'Planning',
    title: 'Yearly costs',
    summary:
      'Spread once-a-year bills (insurance, fees, renewals) into a monthly set-aside saved in a real savings account, so no month is a shock.',
    route: '/yearly-costs',
    howTo: [
      'Pick the sinking-fund account in Profile.',
      'Press Add yearly cost (name, yearly amount, due month, category), or press Add on a suggestion from your history.',
      'Transfer the suggested monthly amount into the sinking-fund account.',
      'When the bill is paid, press Link payments so it does not distort your typical month.',
    ],
    rules: [
      'Monthly set-aside = yearly amount / 12.',
      '"Should have by now" = amount x months since due / 12 for each cost, reset to 0 in the due month. Behind by = that minus the fund account\'s real balance.',
      'Suggestions are expenses of 5,000 or more in the last 13 months whose payee had no payment in the 10 months before.',
      'Linked payments leave the typical month and Safe to spend. Deleting a yearly cost keeps and unlinks its payments.',
      'The sinking-fund account cannot be an Investment, Credit or Loan account, nor the emergency or savings account.',
    ],
  },
  {
    id: 'salary-plan',
    group: 'Planning',
    title: 'Salary plan',
    summary:
      'When salary lands, MyFin proposes how to split it into buckets and creates the savings transfers as planned transactions you tick off when they happen.',
    route: '/dashboard',
    howTo: [
      'Set the Salary category in Profile first.',
      'When the Salary day card appears on the Dashboard, press Plan this salary.',
      'Adjust the amounts and the Transfer to accounts, then Confirm plan.',
      'When you make a transfer in your bank, import or add it and accept "Mark as matched?". Or use Mark done, Match or Skip on the Planned row in Transactions.',
    ],
    rules: [
      'Proposed split: Fixed costs (stay in the salary account), Yearly set-aside, Emergency top-up (only while below target), Savings, and Free to spend = what is left. All editable.',
      'Confirming creates planned transactions. They change no balances or figures until they are done or matched.',
      'Auto-suggested match: same type and accounts, amount within 1, date within 7 days.',
      'A planned row more than 15 days past its date is flagged Overdue in the plan view.',
      'Once a plan is confirmed, its bucket amounts become the month\'s targets for Safe to spend. A skipped bucket reserves nothing.',
      'One plan per month; a bonus or second salary in the same month does not trigger another.',
    ],
  },
  {
    id: 'forecast',
    group: 'Planning',
    title: 'Forecast',
    summary:
      'Predicts a month\'s spending per category and turns it into a budget in one click. A card on the Insights page.',
    route: '/insights',
    howTo: [
      'Open Insights and find the Forecast card (it defaults to next month in the last 7 days of a month).',
      'Check the table of categories, the total with its range, and the expected income.',
      'Press "Create <Month> budget from this forecast".',
      'If a budget already exists, choose "Fill only empty" or "Replace all".',
    ],
    rules: [
      'Fixed categories use their typical monthly amount. Flexible ones use the average of the last 3 months (one-offs and yearly-cost rows excluded).',
      'A seasonal factor (last year\'s pattern, clamped to 0.5 to 1.5) applies only when last year has data in all four months. Yearly costs due that month are added once.',
      'Amounts are rounded to the nearest 100. The range is plus or minus the standard deviation of each category.',
      '"Not yet sorted" spending is shown as its own line and never budgeted.',
      'You need about 3 months of history, otherwise: "Not enough history yet to forecast this month."',
    ],
  },

  // ---- Insights and patterns ----
  {
    id: 'insights',
    group: 'Insights and patterns',
    title: 'Insights',
    summary:
      'Where your money went this month, one month at a time, with every number clickable down to the exact transactions.',
    route: '/insights',
    howTo: [
      'Pick a month with Previous / Next or the Month picker. Everything below follows it.',
      'Green means better than your typical month; red means worse.',
      'Click any underlined figure to open the exact transactions behind it.',
      'Under "Where the money went" switch between category, merchant and person.',
      'Click a bar in the 12-month trend to jump to that month.',
    ],
    rules: [
      'Every figure equals its drill-down list, because both use the same rule for counted rows.',
      'Typical month = average of up to the 3 months before the selected one that have data, with one-offs and yearly-cost payments removed. With none, comparisons are hidden.',
      'Savings = income - spending. Savings rate = savings / income, shown as "-" when income is 0.',
      'A payee is guessed to be a person only if its name has no business words and you have received from or requested from it, or paid it round amounts of 1,000 or more. Your correction always wins.',
      'Biggest changes vs typical lists up to 5 categories or merchants that moved most compared with their 3-month average.',
    ],
  },
  {
    id: 'fixed-flexible',
    group: 'Insights and patterns',
    title: 'Fixed vs flexible card',
    summary:
      'Splits spending into bills you cannot skip, spending you can change, and spending not yet sorted.',
    route: '/insights',
    howTo: [
      'Mark your fixed categories first (Categories > Fixed cost).',
      'Open Insights and read Fixed, Flexible and Not yet sorted, each with "vs typical".',
      'Click a bucket to see its transactions.',
    ],
    rules: [
      'Fixed = expenses in Fixed-flagged categories. Flexible = other categorised expenses. Not yet sorted = no category.',
      'With no category flagged Fixed, everything categorised counts as flexible.',
      'Income and transfers are never in the split.',
    ],
  },
  {
    id: 'small-spends',
    group: 'Insights and patterns',
    title: 'Small spends card',
    summary:
      'Shows how many tiny payments you make and where they go, because they add up.',
    route: '/insights',
    howTo: [
      'Set the Small-spend cut-off in Profile (default 200).',
      'Open Insights and read the headline, "Where they went" and the last 12 months bars.',
      'Click a bar to open that month\'s list.',
    ],
    rules: [
      'A small spend is a counted expense strictly below the cut-off. Exactly 200 is not small.',
      'Transfers, adjustments, planned rows and debt principal are excluded. Payments to people count too.',
    ],
  },
  {
    id: 'spending-calendar',
    group: 'Insights and patterns',
    title: 'Spending calendar',
    summary:
      'A heatmap of spending by day. Darker days mean more spent; click a day to see what you paid.',
    route: '/insights',
    howTo: [
      'Switch between Month and Year view.',
      'Turn on "Flexible only" so big fixed bills do not wash out the colours.',
      'Click a day to open its transactions. Check "Average by weekday" for your pattern.',
    ],
    rules: [
      'Uses IST calendar days with no salary shifting. Only counted expenses are included.',
      'Five shades come from quantile cut points over the non-zero days of the range. Zero days are blank.',
      'The range can span at most 400 days.',
    ],
  },
  {
    id: 'savings-rate',
    group: 'Insights and patterns',
    title: 'Savings rate card',
    summary:
      'The share of your income you kept this month, with a 12-month sparkline. At the top of the Dashboard.',
    route: '/dashboard',
    howTo: [
      'Set a savings target in Profile to see a target and a tick or cross.',
      'Read the headline, the 12-month average and the change versus last month.',
    ],
    rules: [
      'Rate = (income - spending) / income on counted rows. It is "-" when the month has no income.',
      'The target is met when the rate rounded to a whole percent is at least the target rounded to a whole percent (19.6% meets 20%). Dashboard, Health and milestones all use this rule.',
      'In Amount mode the target percent is the amount / this month\'s income (or typical income when income is 0).',
      'Transfers into savings are not spending, so they count as saved.',
    ],
  },
  {
    id: 'safe-to-spend',
    group: 'Insights and patterns',
    title: 'Safe to spend',
    summary:
      'What you can still spend for the rest of the month after bills still to come and savings set-asides.',
    route: '/dashboard',
    howTo: [
      'Mark your fixed categories so bills still to come are counted.',
      'Press "See how this is worked out" for the line-by-line maths.',
      'Red "Over by X" means you have committed more than you earn this month.',
    ],
    rules: [
      'Safe = expected income - spent so far - fixed still to come - savings - yearly set-aside - emergency top-up. Current month only.',
      'Expected income = the larger of income received this month and your typical monthly income.',
      'Fixed still to come = for each fixed category, max(0, typical amount - spent so far).',
      'Each set-aside deducts the larger of its target and what you already transferred this month. A confirmed salary plan\'s buckets replace the settings for that month.',
      'Per day = safe / days left in the month (at least 1).',
    ],
  },
  {
    id: 'emergency-fund',
    group: 'Insights and patterns',
    title: 'Emergency fund card',
    summary:
      'How many months of fixed bills your reserve would cover.',
    route: '/dashboard',
    howTo: [
      'Tick Emergency fund on the account(s) holding your reserve (Accounts > edit account).',
      'Mark Fixed cost categories.',
      'Set the Emergency fund target (months) in Profile.',
    ],
    rules: [
      'Fund = sum of ticked active accounts\' balances (negative balances count as 0).',
      'Months covered = fund / typical monthly fixed costs, to 1 decimal. Red below 3, amber from 3 up to the target, green at or above the target.',
      'The gap to the target drives the Salary plan\'s Emergency top-up and Safe to spend\'s emergency set-aside.',
    ],
  },
  {
    id: 'net-worth-change',
    group: 'Insights and patterns',
    title: 'Net worth change, explained',
    summary:
      'Why your net worth moved this month, at the bottom of Insights.',
    route: '/insights',
    howTo: [
      'Read "Net worth +/-X in <month>" and the from / to figures.',
      'Under "Why it moved" see Saved from income, Investment growth, Write-offs and Other.',
      'Check "By account", and click a bar in the last 12 months to select a month.',
    ],
    rules: [
      'Net worth = active non-investing account balances (credit and loans negative) + investment holdings at market value + money lent outstanding - money borrowed outstanding.',
      'Investment-account balances are never counted; the holdings are.',
      'The parts add up exactly to the change; anything unexplained is "Other".',
      'The top-bar Net Worth and the Stats page come from the original app and may not use this exact definition.',
    ],
  },
  {
    id: 'stats',
    group: 'Insights and patterns',
    title: 'Stats',
    summary:
      'The original MyFin charts: net worth evolution, projections, expenses, income and year-by-year.',
    route: '/stats',
    howTo: ['Open Stats and switch between the tabs for longer-term charts.'],
    rules: [
      'Stats uses the original rules and does not exclude write-offs or debt principal the way Insights does.',
    ],
  },

  // ---- Debts and wealth ----
  {
    id: 'debts',
    group: 'Debts and wealth',
    title: 'Debts (People and Loans)',
    summary:
      'One place for lending and borrowing with friends and family, and for formal loans with EMIs, without distorting your spending.',
    route: '/debts',
    howTo: [
      'Lent money: Debts > People > Add entry > "I lent money", then person, amount and date. Or use "Mark as loan to / from a person" on a transaction.',
      'When they pay back, Confirm a suggested repayment or press Mark repayment.',
      'Loan: Debts > Loans > Add loan, fill the terms and Save. MyFin builds the schedule.',
      'For each EMI use Match (suggested debit), Link transaction, or Mark paid (paid outside MyFin).',
    ],
    rules: [
      'Lending, borrowing and repayments are excluded from Insights spending and income.',
      'Status: Outstanding, Settled or Overdue (past the due date and not settled). Repayments are suggested, never applied silently.',
      'A loan creates a Loan account opened at minus the principal. If you leave the EMI blank it is calculated with the standard formula.',
      'Matching an EMI makes the debit the interest expense (category "Loan interest") and creates a principal transfer to the loan account. Only the interest counts as spending.',
      'Matching needs an expense within 1 of the EMI and within 45 days of the installment date. An unpaid installment more than 5 days late is flagged missed.',
      'The prepayment what-if shows months and interest saved for an extra payment.',
      'Deleting a loan gives matched debits their full amount back as spending.',
    ],
  },
  {
    id: 'retirement',
    group: 'Debts and wealth',
    title: 'Retirement',
    summary:
      'How much you need to retire and whether you are on track, based on your real spending, corpus and savings.',
    route: '/retirement',
    howTo: [
      'Fill the retirement block in Profile > Financial profile (date of birth is required).',
      'Open Retirement and read the three result tiles: corpus needed, on track to retire at, and extra needed each month.',
      'Drag the What-if sliders to explore. Nothing is saved until you press "Save as my settings".',
    ],
    rules: [
      'Annual spending today = 12 x typical monthly spending (all spending, plus the yearly-cost set-aside, or fixed costs only, as you chose).',
      'Corpus needed = annual spending x (1 + inflation)^years / withdrawal rate, plus the present value of any family support.',
      'Corpus now = ticked active non-investing accounts (negatives count as 0) + ticked assets at market value.',
      '"On track to retire at" is the first age where your projected corpus reaches what is needed, up to age 90.',
      'Retirement accounts may overlap the savings account but never the emergency or sinking accounts.',
    ],
  },
  {
    id: 'investments',
    group: 'Debts and wealth',
    title: 'Investments',
    summary:
      'Assets, buy / sell / income / cost transactions and performance. An original MyFin feature, now feeding goals and retirement.',
    route: '/invest',
    howTo: [
      'Press Add asset to create each holding.',
      'Press Add transaction to record buys and sells.',
      'Use the Summary tab for total invested, current value and returns.',
    ],
    rules: [
      'An asset\'s current value feeds net worth, Goals and Retirement.',
      'Investment-type accounts are never counted there (the holdings are, to avoid double counting) and can never be earmarked.',
    ],
  },

  // ---- Routines ----
  {
    id: 'month-review',
    group: 'Routines',
    title: 'Month-end review',
    summary:
      'A six-step checklist that turns last month\'s data into clean books and next month\'s plan.',
    route: '/review',
    howTo: [
      'Open it from the Dashboard card (1st to 10th of the month) or the Month review menu item.',
      'Work down the steps with each Open button: import stale accounts, sort uncategorised spending, reconcile balances, resolve planned transfers.',
      'Review Insights, then tick "I\'ve reviewed this month in Insights" yourself. It is the only manual step.',
      'Plan next month\'s budget, ideally from the forecast.',
    ],
    rules: [
      'Steps are computed live. A step with nothing to do counts as done.',
      'Reconcile needs a balance check in the month or in the first 10 days of the next month for every freshness-tracked account.',
      'A past month is frozen when it completes, or on first read from day 11 of the next month. Frozen months never change.',
      'A past month first opened from the start of M+3 is shown as Reconstructed from today\'s data and never stored.',
      'Three completed frozen months in a row fire a milestone.',
    ],
  },
  {
    id: 'health',
    group: 'Routines',
    title: 'Financial health',
    summary:
      'A monthly pass or fail checklist of the basics, with a one-line fix hint per check and a score tracked over 12 months.',
    route: '/health',
    howTo: [
      'Open Health and read the score ("N of M passed").',
      'For a failing row, read its hint and press Fix. For a "not set up" row press Set up.',
      'Click a bar in the last 12 months to see a past month.',
    ],
    rules: [
      'Checks: Savings rate, Emergency fund, Yearly costs, Fixed costs, Credit cards, Loan EMIs, Up-to-date data.',
      'Fixed costs pass when typical fixed costs are at most 50% of typical income. Loan EMIs pass at 40% or less.',
      'Credit cards pass when each card\'s owed balance was cleared by transfers within 35 days.',
      'Up-to-date data passes when no tracked account is stale and each has a balance check for the month (or by day 10 of the next).',
      'Checks that are not set up are never counted as failures, so M excludes them.',
      'A past month freezes from day 11 of the next month once card windows have closed, and at the latest 36 days later.',
    ],
  },
  {
    id: 'events',
    group: 'Routines',
    title: 'Events',
    summary:
      'Reminders for birthdays, anniversaries and weddings (with gift budgets) and for money dates like rent, card due dates and renewals, with automatic paid status.',
    route: '/events',
    howTo: [
      'Open Events and look at the suggested events (yearly costs, repeating payments, card due dates). Add the real ones.',
      'Press Add event: name, kind, first date and repeat.',
      'For people events set a gift budget. For money events set payee, category or account, and optionally an amount.',
    ],
    rules: [
      'Monthly and yearly events keep the first date\'s day, clamped to the month\'s last day.',
      'Names must be unique; they become the tag event:<name>.',
      'A money event is marked paid when a counted expense within 5 days of its date matches the payee or category (and within 10% of the amount, when set).',
      'Gift spend = expenses tagged event:<name> from 60 days before to 7 days after, plus manually linked transactions.',
      'The Dashboard Upcoming card shows the next 30 days, plus unpaid items up to 7 days overdue.',
    ],
  },
  {
    id: 'milestones',
    group: 'Routines',
    title: 'Milestones',
    summary:
      'Celebrate real progress. A dismissible banner on the Dashboard, then a timeline on the Milestones page.',
    route: '/milestones',
    howTo: [
      'Press Dismiss on the banner; the milestone stays on the Milestones page.',
      'Open Milestones for the full timeline, newest first.',
    ],
    rules: [
      'Each milestone fires once. Net-worth thresholds fire on upward crossings only.',
      'They are evaluated when the Dashboard loads (cached about 5 minutes). There is no e-mail.',
      'On the first-ever evaluation only the highest net-worth threshold and the latest of each other kind get a banner; the rest go straight to the timeline.',
      'Streaks look only at settled months, so the previous month counts from day 11.',
    ],
  },

  // ---- Settings and safety ----
  {
    id: 'profile',
    group: 'Settings and safety',
    title: 'Profile page',
    summary:
      'Your preferences: language, currency, financial profile, theme, password, tools, backups and the legacy file.',
    route: '/profile',
    howTo: [
      'Open it from the profile icon in the top bar.',
      'Expand the section you need. The Financial profile holds the planning numbers.',
    ],
    rules: [
      'Changing your password logs you out.',
      'Demo accounts cannot change their password.',
      'Stats for Nerds shows record counts and the app version.',
    ],
  },
  {
    id: 'backups',
    group: 'Settings and safety',
    title: 'Encrypted backups',
    summary:
      'One-click, password-protected backups to a folder that a sync app (Google Drive for desktop, Dropbox and so on) uploads.',
    route: '/profile',
    howTo: [
      'In Profile > Encrypted backups, press Back up now.',
      'Choose a password of at least 8 characters and confirm it.',
      'To restore, press Restore on a file and enter its password.',
    ],
    rules: [
      'A forgotten password means the backup cannot be restored. There is no recovery.',
      'Backups are manual only. The newest 30 are kept.',
      'Restoring replaces ALL your current data with the backup\'s contents.',
      'If the server folder is not configured, the buttons are disabled.',
    ],
  },
  {
    id: 'legacy',
    group: 'Settings and safety',
    title: '"If something happens to me" (legacy file)',
    summary:
      'A printable file so your family can find every account, policy, loan and contact. It never stores passwords, PINs or OTPs.',
    route: '/profile',
    howTo: [
      'In Profile > If something happens to me, add insurance policies, key contacts and instructions.',
      'Press Open printable version, then Save as PDF and keep it safe.',
    ],
    rules: [
      'Say where to find things, never the secrets. Entries mentioning a password, PIN, OTP or CVV are rejected.',
      'Loans and people balances are read live from Debts at print time.',
      'Regenerate the file after changes. It is included in backups.',
    ],
  },
  {
    id: 'tools',
    group: 'Settings and safety',
    title: 'Tools',
    summary:
      'Export or import your data, recalculate account balances, or fill the account with mock data.',
    route: '/profile',
    howTo: [
      'Open Profile > Tools.',
      'Export data downloads everything as JSON. Import data restores from a backup file.',
    ],
    rules: [
      'The exported JSON is not encrypted. Prefer Encrypted backups.',
      '"Automatically populate with mock data" resets everything: all your current data will be lost.',
    ],
  },
  {
    id: 'original-pages',
    group: 'Settings and safety',
    title: 'Entities and Tags',
    summary:
      'The original MyFin pages for payees and free labels on transactions.',
    route: '/entities',
    howTo: [
      'Meta > Entities: press Add Entity to name a payee or merchant.',
      'Meta > Tags: press Add Tag for free labels on transactions.',
    ],
    rules: [
      'Entities are optional. Insights groups payments by the description, not by entity.',
      'Rules can assign entities automatically.',
      'Event tags (event:<name>) are created automatically by Events.',
    ],
  },
];
