import type { HelpSection } from './helpTypes.ts';
import { MORE_SECTIONS } from './helpSections.ts';

// Route paths are literals here: importing them from RoutesProvider would be a
// circular import (RoutesProvider imports Help, which imports this file).
const ROUTE_ACCOUNTS = '/accounts';
const ROUTE_BALANCE_CHECK = '/accounts/balance-check';
const ROUTE_CATEGORIES = '/categories';
const ROUTE_DEBTS = '/debts';
const ROUTE_EVENTS = '/events';
const ROUTE_IMPORT_TRX = '/transactions/import';
const ROUTE_PROFILE = '/profile';
const ROUTE_REVIEW = '/review';
const ROUTE_RULES = '/rules';
const ROUTE_TRX = '/transactions';
const ROUTE_YEARLY_COSTS = '/yearly-costs';

// English only for now: the guide text is not part of the i18n catalogues yet.
// Source: docs/adoption/myfin-tour-and-guide-source.md (code wins over specs).

export type { HelpSection } from './helpTypes.ts';

export type FirstWeekStep = {
  title: string;
  where: string;
  why: string;
  route: string;
};

export type GlossaryEntry = { term: string; meaning: string };

export const FIRST_WEEK: FirstWeekStep[] = [
  {
    title: 'Create one account per real money place',
    where: 'Accounts > Add Account',
    why: 'Everything hangs off accounts. The Type sets the stale-data reminder, whether the account can be earmarked, and how credit cards show (as amount owed).',
    route: ROUTE_ACCOUNTS,
  },
  {
    title: 'Import your history',
    where: 'Transactions > Import Transactions',
    why: 'Fills every chart. PhonePe users can upload the statement CSV; everyone else can paste from the bank site.',
    route: ROUTE_IMPORT_TRX,
  },
  {
    title: 'Create categories and a few rules',
    where: 'Meta > Categories, Meta > Rules',
    why: 'Uncategorised spending shows as "Not yet sorted" everywhere and is never budgeted. Rules save the most time.',
    route: ROUTE_CATEGORIES,
  },
  {
    title: 'Sort uncategorised expenses',
    where: 'Transactions (search, filters, bulk edit)',
    why: 'Needed for Insights, the forecast and the month review.',
    route: ROUTE_TRX,
  },
  {
    title: 'Mark Fixed cost on whole categories',
    where: 'Meta > Categories',
    why: 'Rent, insurance, EMIs and utilities. Unlocks the fixed vs flexible split, Safe to spend, the emergency fund meter and the forecast.',
    route: ROUTE_CATEGORIES,
  },
  {
    title: 'Fill in the Financial profile',
    where: 'Profile > Financial profile',
    why: 'Salary category and cut-off day, savings target and account, sinking-fund account and emergency-fund months. Many cards depend on these.',
    route: ROUTE_PROFILE,
  },
  {
    title: 'Tick Emergency fund on your reserve account',
    where: 'Accounts > edit account',
    why: 'Unlocks the Emergency fund card and health check.',
    route: ROUTE_ACCOUNTS,
  },
  {
    title: 'Do your first Balance check',
    where: 'Accounts > Balance check',
    why: 'Type your real bank balances and fix any gap. This makes balances trustworthy.',
    route: ROUTE_BALANCE_CHECK,
  },
  {
    title: 'Add yearly costs',
    where: 'Yearly costs',
    why: 'Removes shock months from "typical" and sets a monthly set-aside. Needs the sinking-fund account.',
    route: ROUTE_YEARLY_COSTS,
  },
  {
    title: 'Enter debts and loans',
    where: 'Debts',
    why: 'Keeps lending and loan principal out of spending; EMI interest counts as spending.',
    route: ROUTE_DEBTS,
  },
  {
    title: 'Add events and money dates',
    where: 'Events',
    why: 'Fills the Dashboard "Upcoming (next 30 days)" card.',
    route: ROUTE_EVENTS,
  },
  {
    title: 'Do the first month-end review',
    where: 'Dashboard review card (1st to 10th), Month review',
    why: 'Frozen monthly records start building a history, and milestones begin to fire.',
    route: ROUTE_REVIEW,
  },
];

const GETTING_STARTED: HelpSection[] = [
  {
    id: 'sign-in',
    group: 'Getting started',
    title: 'Sign in, demo account and first-run setup',
    summary:
      'The Sign In / Sign Up screen, the demo account, and the setup wizard on a fresh install.',
    howTo: [
      'Open the app and Sign In, or Sign Up, or use "Try the demo account" (username demo, password demo).',
      'On a fresh install, follow the four Setup steps: Welcome, Identity, Credentials, Done.',
      'You land on the Dashboard.',
    ],
    rules: [
      'The demo account resets daily and its password cannot be changed.',
      'If the server blocks sign-up you will see "Sign ups are disabled in the API settings".',
      'Password reset sends a one-time code by e-mail, so it needs the server e-mail setup.',
    ],
  },
  {
    id: 'accounts',
    group: 'Getting started',
    title: 'Accounts',
    summary:
      'Every place money lives. Shows balance, status and freshness (Fresh or Stale) so you know which statements to import next.',
    route: ROUTE_ACCOUNTS,
    howTo: [
      'Open Accounts and press Add Account.',
      'Fill Name, Type and optionally Description and Color.',
      'Optionally set "Mark stale after N days" and tick Emergency fund (not offered for Investment, Credit or Loan).',
      'Submit with the paper-plane button.',
    ],
    rules: [
      'Stale limits by type (days since the last transaction): Current account 7, Wallet 7, Meal card 7, Savings 30, Credit 35, Investment 45, Other 45, Loan never. Blank uses the default and 0 means never.',
      'Only a new transaction makes an account Fresh; a balance check does not. Inactive accounts are never flagged.',
      'Credit cards and loans store what you owe as a negative balance.',
      'An account can hold only one earmarked role: Emergency fund, Sinking-fund account or Savings account. Investment, credit card and loan accounts cannot be earmarked.',
      'A loan\'s account cannot be deleted directly; delete the loan instead.',
    ],
  },
  {
    id: 'import',
    group: 'Getting started',
    title: 'Import Transactions (paste and PhonePe)',
    summary:
      'Get statements into MyFin by copy-paste from a bank site, or by uploading a PhonePe CSV that can cover several payment methods at once.',
    route: ROUTE_IMPORT_TRX,
    howTo: [
      'PhonePe: download the CSV in the PhonePe app, press Upload PhonePe statement and choose the file.',
      'In Match accounts, pick a MyFin account for each payment method. It is remembered next time.',
      'In Final adjustments, correct categories and accounts, and untick rows you do not want.',
      'Press Import and confirm. Nothing is saved until then.',
      'Paste: copy the transactions on the bank site, press Continue and allow clipboard access, assign the columns, pick the From account, then review and Import.',
    ],
    rules: [
      'PhonePe re-uploads are safe: rows already imported are skipped, including overlapping date ranges.',
      'Classification: "Add money UPI Lite" and "Credit card bill paid" are transfers, any credit is income, any other debit is expense.',
      'Payments between your own accounts through PhonePe are not detected; untick or fix them in the review.',
      'Your Rules run on every imported row.',
      'The paste flow cannot detect duplicates, so avoid overlapping pastes.',
    ],
  },
  {
    id: 'categories',
    group: 'Getting started',
    title: 'Categories and the Fixed cost switch',
    summary:
      'Categories group income and expenses. The Fixed cost flag marks whole categories as committed costs and powers most planning features.',
    route: ROUTE_CATEGORIES,
    howTo: [
      'Open Meta > Categories and press Add Category (or edit one).',
      'Fill the name and colour.',
      'Switch Fixed cost on for rent, insurance, EMIs and utilities.',
      'Save.',
    ],
    rules: [
      'Fixed is per whole category. Expenses in Fixed categories are fixed, other categorised expenses are flexible, and expenses without a category are "Not yet sorted".',
      'Income and transfers are never in the fixed / flexible split.',
      'The per-transaction Essential flag is a separate, older idea used by Budgets. Essential and Fixed can disagree, which is intended.',
    ],
  },
  {
    id: 'rules',
    group: 'Getting started',
    title: 'Rules (auto-categorization)',
    summary:
      'If a transaction\'s description, amount or accounts match your conditions, MyFin assigns a category, entity or accounts for you.',
    route: ROUTE_RULES,
    howTo: [
      'Open Meta > Rules and press Add Rule.',
      'Under Conditions, match on text such as SWIGGY (Contains, Equals and so on).',
      'Under Result, pick what to assign: Category, Entity, accounts or Essential.',
    ],
    rules: [
      'Rules run on imports and through the Auto-Categorize button in the add-transaction dialog.',
      'They are what makes "Not yet sorted" shrink.',
    ],
  },
  {
    id: 'financial-profile',
    group: 'Getting started',
    title: 'Profile > Financial profile',
    summary:
      'One form holding every number the planning features need. Set these once.',
    route: ROUTE_PROFILE,
    howTo: [
      'Open Profile and expand Financial profile.',
      'Choose the Salary category and Salary cut-off day.',
      'Set the Savings target (Amount or Percent of income) and the Savings account.',
      'Choose the Sinking-fund account and the Emergency fund target (months).',
      'Press Save.',
    ],
    rules: [
      'Defaults: cut-off day 25, emergency target 6 months, top-up 10%, small-spend cut-off 200, retirement age 60, return / inflation / withdrawal rate 10 / 6 / 3.5%.',
      'A salary received on or after the cut-off day counts towards the next month.',
      'A percent savings target must be a whole number from 0 to 100.',
      'The same one-role-per-account rule as Accounts applies to the Savings and Sinking-fund accounts.',
    ],
  },
];

export const HELP_SECTIONS: HelpSection[] = [
  ...GETTING_STARTED,
  ...MORE_SECTIONS,
];

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'Counted rows',
    meaning:
      'The income and expenses that count in Insights and the planning cards. Not counted: transfers between your accounts, balance write-offs, planned transfers, money lent or borrowed and repayments, loan payouts, and the principal part of an EMI. The interest part of an EMI does count.',
  },
  {
    term: 'Effective month',
    meaning:
      'The month a transaction is credited to for analysis. Normally its calendar month, but a salary received on or after the salary cut-off day counts for the next month.',
  },
  {
    term: 'Typical month',
    meaning:
      'The average of up to the 3 previous months that have data, with one-off items and yearly-cost payments removed.',
  },
  {
    term: 'One-off',
    meaning:
      'A large expense (10,000 or more) to a payee that did not recur, or an income at least 1.5 times your median monthly income. Left out of the typical month only.',
  },
  {
    term: 'Fixed / Flexible / Not yet sorted',
    meaning:
      'Fixed: expenses in categories flagged Fixed cost. Flexible: other categorised expenses. Not yet sorted: no category.',
  },
  {
    term: 'Essential',
    meaning:
      'An older per-transaction flag used by Budgets. Independent of Fixed.',
  },
  {
    term: 'Adjustment / write-off',
    meaning:
      'A transaction MyFin creates so a balance matches reality, in the category "Balance adjustment". Never counted as income or spending.',
  },
  {
    term: 'Planned transaction',
    meaning:
      'A future transfer from a confirmed salary plan. It changes nothing until you mark it done or match it to the real one.',
  },
  {
    term: 'Earmarked account',
    meaning:
      'An account with a job: Emergency fund, Sinking fund or Savings. One job per account.',
  },
  {
    term: 'Sinking fund',
    meaning:
      'A savings account where you set aside 1/12 of each yearly cost every month.',
  },
  {
    term: 'Safe to spend',
    meaning:
      'What is left this month after bills still to come and savings set-asides: expected income - spent - fixed still to come - set-asides.',
  },
  {
    term: 'Freshness',
    meaning:
      'Whether an account has had a transaction recently enough for its type. Fresh or Stale.',
  },
  {
    term: 'Balance check',
    meaning:
      'Comparing MyFin\'s balance with the bank\'s. Stored per account as matched, adjusted or open.',
  },
  {
    term: 'Frozen month',
    meaning:
      'A past month\'s health score or review that has been saved and no longer changes. Freezes from day 11 of the following month.',
  },
  {
    term: 'Net worth',
    meaning:
      'Active non-investing account balances (credit and loans negative) + investment holdings at market value + money lent outstanding - money borrowed outstanding.',
  },
  {
    term: 'Savings rate',
    meaning:
      '(income - spending) / income. It meets the target when the whole-number rounded values compare, so 19.6% meets 20%.',
  },
  {
    term: 'Drill-down',
    meaning:
      'Clicking a figure to open Transactions filtered to exactly the rows behind it.',
  },
];
