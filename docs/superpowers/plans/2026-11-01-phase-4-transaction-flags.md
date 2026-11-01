# Phase 4: Transaction Flags and Apply Edited Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user mark a transaction as a loan, an investment or an event expense in Add/Edit Transaction and the import review (PhonePe included), and let an edited rule be applied to existing transactions after a preview.

**Architecture:** No schema change. A loan is a Debts record created from the transaction, an event link is a row in `event_occurrence_transactions`, and an investment is a transfer to an INVESTING account (budgets already exclude those from spending). Loan and event flags are applied by one new API service after the transaction exists; the investment flag is a client-side type/account change. Rule re-application is a new service that re-matches server-side.

**Tech Stack:** Express + Joi + Prisma + MySQL (vitest unit and integration), React + MUI + TanStack Query (`node:test` helpers in `myfin-web/tests`).

**Spec:** `docs/superpowers/specs/2026-11-01-phase-4-transaction-flags-design.md`

## Global Constraints

- No schema change, so backup and restore are unchanged. Old backups must still restore; do not bump the major version.
- Investment = transfer: type `MYFIN.TRX_TYPES.TRANSFER` (`'T'`), `account_to_id` an account with type `MYFIN.ACCOUNT_TYPES.INVESTING` (`'INVAC'`). It is excluded from spending and moves both balances once. Only an expense can be marked as an investment; an income row cannot.
- Loan direction comes from the transaction: expense creates `lent`, income creates `borrowed` (`createPeopleDebt` already enforces this). Loan and investment are mutually exclusive on one transaction; an event link may combine with either.
- Repayment is manual; there is no repayment matching.
- A flag that fails on one import row is skipped and reported; the rest of the import goes through.
- Rule re-application runs the whole ruleset in priority order (`RuleService.getRuleForTransaction`), overwrites hand-set categories, skips transfers, skips rows that match no rule, and changes nothing until the user confirms the preview.
- API tests: unit in `myfin-api/__tests__/unit`, integration in `myfin-api/__tests__/integration` (throwaway mysql:8.4 container, one file at a time with `-c vitest.config.integration.ts`). Web tests: `node --test` in `myfin-web/tests` with Node 24.
- Follow neighbouring code style; i18n strings go in en, fr and pt. Commit and push after each task.

## Review Focus

- A loan flag on an income row, or an investment flag on an income row: refused with a clear message, not a 500.
- Marking a transaction that is already linked to an event, or already a debt row: reported as failed for that item; other items still apply.
- An import row skipped as a duplicate (`skipped`) must not be flagged: flags map to created rows only.
- Rule apply with the preview stale (a transaction edited or deleted after the preview): apply re-matches, so it updates only what still matches and counts the rest as skipped.
- Rule apply on a user with zero rules or zero transactions: empty preview, no error.

---

### Task 1: Flag service, endpoint and bulk-import row mapping (API)

**Files:**
- Create: `myfin-api/src/services/transactionFlagService.ts`
- Modify: `myfin-api/src/services/transactionService.ts` (`createTransactionsInBulk` return value)
- Modify: `myfin-api/src/controllers/transactionController.ts`, `myfin-api/src/routes/routeDefinitions.ts` (new route in the transactions group, next to `/auto-cat-trx`)
- Test: `myfin-api/__tests__/integration/transactionFlags.integration.test.ts`

**Interfaces:**
- Consumes: `createPeopleDebt(userId, { kind, name, due_date?, transaction_id })` from `services/debts/debtService.ts`; `createEvent(userId, EventInput)`, `linkTransaction(userId, eventId, date, transactionId)` and `occurrencesBetween` from `services/routines/eventService.ts`.
- Produces:
  ```ts
  export type TransactionFlags = {
    loan?: { name?: string; due_date?: number | null };
    event?: { event_id: string } | { new_event: { name: string; kind?: string } };
  };
  export type FlagItem = { transaction_id: string; flags: TransactionFlags };
  export type FlagResult = {
    applied: number;
    failed: Array<{ transaction_id: string; flag: 'loan' | 'event'; message: string }>;
  };
  export async function applyFlags(userId: bigint, items: FlagItem[]): Promise<FlagResult>;
  ```
  Endpoint `POST /trx/flags` (body `{ items: FlagItem[] }`, max 500 items) returns `FlagResult`. `createTransactionsInBulk` additionally returns `created_by_index: Array<{ index: number; transaction_id: bigint }>` where `index` is the position in `trxList` (skipped duplicates absent), alongside the existing `imported`, `skipped`, `created_ids`.

- [ ] **Step 1: Write failing integration tests** in `transactionFlags.integration.test.ts` (use the neighbouring integration tests' setup): `loan on an expense creates a lent debt linked to the transaction` (debt.kind `'lent'`, `principal` equals the amount, transaction `debt_id` set, `debt_role` `'lend'`); `loan name defaults to the description when none given`; `loan on an income creates a borrowed debt`; `event with event_id links the transaction to the occurrence nearest its date`; `new_event creates an event dated on the transaction day and links it`; `a failing item is reported and the others still apply` (one already-linked transaction plus one good one: `applied` 1, `failed` has one entry with `flag: 'event'`); `a transaction of another user is reported as failed, not changed`; `bulk import returns created_by_index and omits duplicates` (import two rows, one with an existing `external_id`: result has one entry with the second row's index).
- [ ] **Step 2: Run** `npx vitest run -c vitest.config.integration.ts __tests__/integration/transactionFlags.integration.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `applyFlags`** in `transactionFlagService.ts`. Per item, process `loan` then `event`, each in its own try/catch so one failure is recorded in `failed` and does not stop the others. Loan: load the transaction (owned by the user), choose `kind` from its type, default `name` to its description trimmed, call `createPeopleDebt`. Event: resolve the target event (existing id, or `createEvent` with `repeat: 'once'`, `kind` default `'other'`, `date` the transaction's IST day), pick the occurrence date nearest the transaction day using `occurrencesBetween`, then `linkTransaction`.
- [ ] **Step 4: Implement `created_by_index`** in `createTransactionsInBulk` (push `{ index, transaction_id }` where the row is created).
- [ ] **Step 5: Add the Joi schema, controller `applyTransactionFlags` and the route** (same pattern as `importPhonePeCategorize`: `CommonsController.checkAuthSessionValidity`, `validateAsync`, `res.json`).
- [ ] **Step 6: Run the new file and `__tests__/integration/transactions*.test.ts`**. Expected: PASS.
- [ ] **Step 7: Commit** `feat: apply loan and event flags to transactions`

### Task 2: Apply edited rules, preview and confirm (API)

**Files:**
- Create: `myfin-api/src/services/ruleApplyService.ts`
- Modify: `myfin-api/src/controllers/ruleController.ts`, `myfin-api/src/routes/routeDefinitions.ts` (Rules group)
- Test: `myfin-api/__tests__/integration/ruleApply.integration.test.ts`

**Interfaces:**
- Consumes: `RuleService.getRuleForTransaction(userId, description, amount, type, accountsFromId, accountsToId, MYFIN.RULES.MATCHING.IGNORE, MYFIN.RULES.MATCHING.IGNORE, entitiesCache, categoriesCache, dbClient)`.
- Produces:
  ```ts
  export type RuleChange = {
    transaction_id: string; date: number; description: string; amount: number;
    rule_id: string;
    current_category_id: string | null; new_category_id: string | null;
    current_entity_id: string | null; new_entity_id: string | null;
  };
  export async function previewRuleApplication(userId: bigint): Promise<{ changes: RuleChange[]; truncated: boolean }>;
  export async function applyRuleChanges(userId: bigint, transactionIds: bigint[]): Promise<{ updated: number; skipped: number }>;
  ```
  Endpoints `POST /rules/apply-preview` (no body) and `POST /rules/apply` (body `{ transaction_ids: string[] }`, max 2000).

- [ ] **Step 1: Write failing integration tests**: `preview lists only transactions whose category or entity would change`; `preview uses the same priority as import` (two rules match, the higher-priority wins); `preview skips transfers, adjustments and debt rows`; `preview is empty with no rules`; `apply overwrites a hand-set category` (transaction categorized by hand, then the rule applied: category replaced); `apply re-matches server-side` (an id in the list whose transaction no longer matches is counted in `skipped`, not updated); `apply never changes accounts or type`; `apply ignores ids of another user's transactions`; `a rule that assigns only a category leaves entity untouched`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement `previewRuleApplication`**: iterate the user's non-transfer, non-adjustment, non-debt transactions in bounded chunks (reuse the chunked `Promise.all` approach in `phonePeImportService.ts`), call `getRuleForTransaction` with the shared category/entity caches, and include a row only when the rule assigns a category or entity that differs from the stored one. Cap at 2000 rows and set `truncated`.
- [ ] **Step 4: Implement `applyRuleChanges`**: for each owned id, re-run the match and update `categories_category_id`, `entities_entity_id` and `is_essential` only where the rule assigns a value. One database transaction; no balance recalculation is needed.
- [ ] **Step 5: Add controller handlers (Joi, auth check) and the two routes.**
- [ ] **Step 6: Run the new file.** Expected: PASS.
- [ ] **Step 7: Commit** `feat: preview and apply edited rules to existing transactions`

### Task 3: Flags control in Add/Edit Transaction (web)

**Files:**
- Create: `myfin-web/src/features/transactions/flags/TransactionFlagsControl.tsx`, `myfin-web/src/features/transactions/flags/flagsModel.ts`
- Modify: `myfin-web/src/features/transactions/AddEditTransactionDialog.tsx`, `myfin-web/src/services/trx/trxServices.ts`, `myfin-web/src/services/trx/trxHooks.ts`, `myfin-web/src/locales/{en,fr,pt}` (the directory the neighbouring `budgets` strings live in)
- Test: `myfin-web/tests/flagsModel.test.ts`

**Interfaces:**
- Produces (`flagsModel.ts`, pure, no React):
  ```ts
  export type FlagChoice = {
    kind: 'none' | 'loan' | 'investment';
    loanName?: string;
    investmentAccountId?: number;
    event?: { event_id: string } | { new_event: { name: string } } | null;
  };
  export const NO_FLAGS: FlagChoice;
  export function canMarkLoan(trxType: 'E' | 'I' | 'T'): boolean;        // expense or income
  export function canMarkInvestment(trxType: 'E' | 'I' | 'T'): boolean;   // expense only
  export function toApiFlags(choice: FlagChoice): { loan?: ...; event?: ... };   // matches TransactionFlags from Task 1
  export function applyInvestment(
    trx: { type: 'E' | 'I' | 'T'; account_to_id?: number },
    choice: FlagChoice
  ): { type: 'E' | 'I' | 'T'; account_to_id?: number };   // investment: type 'T', account_to_id the chosen account; none: unchanged
  ```
  `useApplyTransactionFlags()` hook posting to `POST /trx/flags` and invalidating the transactions list query.

- [ ] **Step 1: Write failing tests** in `flagsModel.test.ts`: `canMarkLoan true for expense and income, false for transfer`; `canMarkInvestment true only for expense`; `toApiFlags maps loan, event id and new event`; `toApiFlags omits loan when kind is investment`; `applyInvestment turns an expense into a transfer to the chosen account`; `applyInvestment leaves the transaction unchanged for kind none`.
- [ ] **Step 2: Run** `node --test tests/flagsModel.test.ts` (as `budgetGroups.test.ts` is run). Expected: FAIL.
- [ ] **Step 3: Implement `flagsModel.ts`.**
- [ ] **Step 4: Implement `TransactionFlagsControl`**: a collapsed "Mark as…" section with a loan toggle (name field defaulting to the description), an investment toggle (account picker listing only INVESTING accounts, disabled with a hint when the user has none or the type is not expense), and a "Link to event" picker (existing events from the events query, plus "Create new event" with a name field). Loan and investment are mutually exclusive in the control.
- [ ] **Step 5: Wire into `AddEditTransactionDialog.tsx`**: on submit, `applyInvestment` runs before the existing create/update call; after a successful create of a new transaction, call `useApplyTransactionFlags` with the new id when loan or event is set. For an existing transaction the control shows loan and event only (investment toggles via the dialog's own type/account fields). Add i18n keys in en, fr and pt.
- [ ] **Step 6: Run `node --test tests/flagsModel.test.ts` and `npm run build`** (type check). Expected: PASS.
- [ ] **Step 7: Commit** `feat: mark loan, investment and event in add transaction`

### Task 4: Flags in the import review, including PhonePe (web)

**Files:**
- Modify: `myfin-web/src/features/transactions/import/ImportTrxStep2.tsx` (row controls and save), `ImportTrxStep2PayeeGroups.tsx` (group-level apply if the group view is the one shown for PhonePe), `ImportTrxStep3.tsx` (report skipped flags), `myfin-web/src/services/trx/trxHooks.ts` (`useImportTransactionsStep2` result type to include `created_by_index`)
- Test: `myfin-web/tests/importFlags.test.ts`

**Interfaces:**
- Consumes: `FlagChoice`, `applyInvestment`, `toApiFlags` from Task 3; `created_by_index` from Task 1.
- Produces (`myfin-web/src/features/transactions/import/importFlags.ts`, pure):
  ```ts
  export function flagItemsForCreated(
    rows: Array<{ choice: FlagChoice }>,
    createdByIndex: Array<{ index: number; transaction_id: string }>
  ): Array<{ transaction_id: string; flags: ReturnType<typeof toApiFlags> }>;
  ```
  Returns an item only for created rows whose choice has a loan or an event; duplicates and unflagged rows produce nothing.

- [ ] **Step 1: Write failing tests** in `importFlags.test.ts`: `maps a flagged row to its created transaction id`; `ignores rows skipped as duplicates` (missing from `createdByIndex`); `ignores rows with no loan or event`; `investment rows are not sent (already a transfer)`.
- [ ] **Step 2: Run** `node --test tests/importFlags.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `importFlags.ts`.**
- [ ] **Step 4: Add a per-row flags control to the review table** (compact: an icon button opening `TransactionFlagsControl` in a popover); keep the choice in the same per-row state the review already uses for category edits. Before the save request, apply `applyInvestment` to each row's payload so investment rows go out as transfers.
- [ ] **Step 5: After the save succeeds**, call the flags hook with `flagItemsForCreated(...)` if non-empty; pass any `failed` entries to Step 3 and list them there ("N flags could not be applied") with each message. A failure of the flags call itself must not undo or hide the successful import.
- [ ] **Step 6: Run both web test files and `npm run build`.** Expected: PASS.
- [ ] **Step 7: Commit** `feat: loan, investment and event flags in the import review`

### Task 5: Apply to existing transactions from the rules page (web)

**Files:**
- Create: `myfin-web/src/features/rules/ApplyRulesDialog.tsx`
- Modify: `myfin-web/src/features/rules/Rules.tsx`, `myfin-web/src/features/rules/AddEditRuleDialog.tsx` (offer the action after a successful save), `myfin-web/src/services/rules/` (service and hook; follow the existing rules service files), locale files
- Test: `myfin-web/tests/ruleApplySelection.test.ts` with a pure helper `myfin-web/src/features/rules/ruleApplySelection.ts`

**Interfaces:**
- Produces:
  ```ts
  export function selectedIds(changes: Array<{ transaction_id: string }>, excluded: Set<string>): string[];
  ```
- Consumes: `POST /rules/apply-preview` and `POST /rules/apply` from Task 2.

- [ ] **Step 1: Write failing tests**: `selectedIds returns all ids when nothing is excluded`; `selectedIds drops excluded ids`; `selectedIds returns an empty list when all are excluded`.
- [ ] **Step 2: Run** `node --test tests/ruleApplySelection.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the helper.**
- [ ] **Step 4: Implement `ApplyRulesDialog`**: loads the preview, shows a table (date, description, amount, current category, new category), a checkbox per row to exclude, a "truncated" notice when `truncated`, an empty state when there are no changes, and a confirm button showing the count that posts `selectedIds`. After success show "N updated, M skipped" and invalidate the transactions query.
- [ ] **Step 5: Add an "Apply rules to existing transactions" button on the Rules page and an "Apply now" prompt after saving a rule.** Add i18n keys in en, fr and pt.
- [ ] **Step 6: Run all web tests and `npm run build`.** Expected: PASS.
- [ ] **Step 7: Commit** `feat: apply edited rules to existing transactions`

### Task 6: Docker rebuild and manual checks

- [ ] **Step 1: Rebuild** with `docker compose up -d --build` (no migrations this phase) and confirm the three containers are healthy.
- [ ] **Step 2: Record in the `next-phase-requirements` memory** that Phase 4 is built, with the manual browser checks still pending: mark a PhonePe row as loan, as investment and link it to an event; the same in Add Transaction; the rules preview and apply on a copy of real data.
