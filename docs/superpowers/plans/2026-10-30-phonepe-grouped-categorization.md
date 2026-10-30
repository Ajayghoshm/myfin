# PhonePe Grouped Categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the PhonePe review step, let the user group rows by payee, fill category/entity/essential once per group (blank rows only), and remember each choice as an auto-categorize rule.

**Architecture:** The API derives a payee per row (`extractPayee`) and returns it with the categorize result. The web review step groups by `type + payee` on the client and applies group edits to blank rows only. On import, the web sends a `payee_rules` list in the same step2 request; the API creates or updates the rules in the same DB transaction as the transactions.

**Tech Stack:** Express + Prisma + Vitest (`myfin-api`), React + MUI + react-i18next (`myfin-web`, no unit-test runner).

**Spec:** `docs/superpowers/specs/2026-10-30-phonepe-grouped-categorization-design.md`

## Global Constraints

- Grouping is PhonePe-only; the generic paste import review is unchanged. The grouped view is an option, not a replacement of the flat table.
- Payee prefixes stripped: "Paid to ", "Received from ", "Requested by ", "Payment to " (case-insensitive); then trim, collapse whitespace, compare case-insensitively.
- Income and expense groups for the same payee stay separate. Transfers (type `T`) are never grouped.
- A group edit fills only blank rows. "Apply to all rows" is the only overwrite. A group whose rows differ shows "mixed".
- Rules reuse the `rules` table: description `CONTAINS` the payee, type `EQ` the group's type. Update an existing pure payee rule instead of adding a second. Store only fields the user set. An untouched group writes no rule.
- Rows with no payee prefix (e.g. "Electricity bill paid 1234567") group by full description and create no rule.
- Rules and transactions are saved in one request and one DB transaction.
- Locale text must exist in both `en.json` and `pt.json` of `myfin-web` (and `myfin-api` if API-facing text is added).
- Follow `myfin-api/AGENTS.md` and `myfin-web/docs/`. No new dependencies.

## Review Focus

- Same payee as expense and income ("Received from X" and "Paid to X") must be two groups, and a rule for one must not match the other.
- "VEG BASKET " and "Veg Basket" must be one group.
- Group edit when the user has already set a different category on one row: that row keeps it.
- Group where every row is deselected (include unchecked): no rule is created.
- Payee shorter than 4 characters: the rule matches on the full cleaned description, not the short name.
- A rule for the payee already exists with a category set; the user sets only the entity on the group: category is kept, entity updated.
- Two `payee_rules` entries with the same payee and type in one request: one rule results, no error.
- Rule creation failing (e.g. category id not owned by the user) rolls back the imported transactions.

---

### Task 1: Payee extraction and categorize result

**Files:**
- Modify: `myfin-api/src/services/importers/phonePeImporter.ts`
- Modify: `myfin-api/src/services/phonePeImportService.ts` (fillData construction near line 173-196, and the `PhonePeCategorizeResult` type near line 28)
- Test: `myfin-api/__tests__/unit/phonePeImporter.test.ts`

**Interfaces:**
- Produces: `extractPayee(description: string): { payee: string; matchText: string | null }` exported from `phonePeImporter.ts`. `matchText` is the payee when it is at least `MIN_PAYEE_RULE_LENGTH` (4) characters, the cleaned full description when the payee is shorter, and `null` when no prefix matched.
- Produces: each `fillData` item from `categorizePhonePeImport` gains `payee: string | null` and `payee_match: string | null`. Both are `null` for transfer rows (type `T`).

- [ ] **Step 1: Write failing unit tests** in `phonePeImporter.test.ts`, describe `extractPayee`:
  - `"Paid to SWIGGY"` → `{ payee: "SWIGGY", matchText: "SWIGGY" }`
  - `"Paid to VEG BASKET "` and `"Payment to veg  basket"` → same lower-cased payee after normalization (assert `.payee.toLowerCase()` equal; `payee` keeps the first-seen casing with whitespace collapsed)
  - `"Received from PERSON E"` → payee `"PERSON E"`
  - `"Requested by PERSON A"` → payee `"PERSON A"`
  - `"Paid to AB"` → `matchText` is `"Paid to AB"`
  - `"Electricity bill paid 1234567"` → `{ payee: "Electricity bill paid 1234567", matchText: null }`
- [ ] **Step 2: Run** `npm run test:unit:run -- phonePeImporter` in `myfin-api`. Expected: the new tests fail (`extractPayee` is not exported).
- [ ] **Step 3: Implement `extractPayee`** in `phonePeImporter.ts` using one anchored case-insensitive regex for the four prefixes.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Add `payee` and `payee_match` to fillData** in `phonePeImportService.ts`, computed from `row.description` and `null` when `row.type` is the transfer type. Extend the `PhonePeCategorizeResult` fillData type. Extend the existing categorize integration test (`phonePeImport.integration.test.ts`, "PhonePe import (preview / categorize)") with assertions: the SWIGGY row has `payee: "SWIGGY"`; the "Add money UPI Lite" row has `payee: null`.
- [ ] **Step 6: Run** `npm run build` and `npm run test:unit:run` in `myfin-api`; then `npm run test:integration` (needs Docker). Expected: all pass.
- [ ] **Step 7: Commit**

```bash
git add myfin-api/src myfin-api/__tests__
git commit -m "feat: derive payee and rule match text for PhonePe import rows"
```

---

### Task 2: Payee rule upsert

**Files:**
- Modify: `myfin-api/src/services/ruleService.ts`
- Test: `myfin-api/__tests__/integration/phonePeImport.integration.test.ts` (new describe "payee rules")

**Interfaces:**
- Produces (exported in the default export of `ruleService.ts`):
  `savePayeeRules(userId: bigint, payeeRules: PayeeRuleInput[], dbClient): Promise<number>` returning the count of rules created or updated, where
  `PayeeRuleInput = { match_text: string; type: "E" | "I"; category_id?: bigint | number | null; entity_id?: bigint | number | null; is_essential?: boolean }`.
- Consumes: existing `createRule` in the same file.

- [ ] **Step 1: Write failing integration tests** (use the file's `createAccount`/user setup helpers):
  - creating: `savePayeeRules` with `{ match_text: "SWIGGY", type: "E", category_id }` creates one rule with description operator `CONTAINS`, value `SWIGGY`, type operator `EQ`, type value `E`, and the category assigned; `RuleService.getRuleForTransaction` for `"Paid to SWIGGY"` type `E` returns it, and for `"Received from SWIGGY"` type `I` returns nothing.
  - updating: a second call with `{ match_text: "swiggy", type: "E", entity_id }` leaves exactly one rule, keeps the category, sets the entity.
  - essential is stored only when `is_essential` is present.
  - duplicates in one call (`"Veg Basket"` and `"VEG BASKET"`, type `E`) produce one rule.
  - a `category_id` that belongs to another user throws a bad-request error and creates nothing.
- [ ] **Step 2: Run** `npm run test:integration` in `myfin-api`. Expected: the new tests fail.
- [ ] **Step 3: Implement `savePayeeRules`.** An existing "pure payee rule" is one whose description operator is `CONTAINS`, whose value equals `match_text` ignoring case, whose type operator is `EQ` with the same type, and whose other matcher operators are empty. Compare in JS, not SQL. Update only the fields present in the input; otherwise `createRule`. Validate category/entity ownership with the same helpers the rules controller uses for `assign_category_id`/`assign_entity_id`.
- [ ] **Step 4: Run** the integration tests again. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add myfin-api/src myfin-api/__tests__
git commit -m "feat: create or update payee rules from import choices"
```

---

### Task 3: Step2 import accepts payee rules atomically

**Files:**
- Modify: `myfin-api/src/controllers/transactionController.ts` (`importTrxStep2Schema` and `importTransactionsStep2`, near line 374-390)
- Modify: `myfin-api/src/services/transactionService.ts` (new function next to `createTransactionsInBulk`, line 481)
- Modify: `myfin-api/src/docs/openApi.ts` (the `/trxs/import/step2` request body)
- Test: `myfin-api/__tests__/integration/phonePeImport.integration.test.ts` (describe "saving")

**Interfaces:**
- Consumes: `RuleService.savePayeeRules` (Task 2), `createTransactionsInBulk`.
- Produces: `TransactionService.importTransactionsWithPayeeRules(userId: bigint, trxList: CreateTransactionType[], payeeRules: PayeeRuleInput[]): Promise<{ imported: number; skipped: number; created_ids: bigint[] }>`. Both steps run inside one `performDatabaseRequest`. The request body gains an optional `payee_rules` JSON string; absent or empty behaves exactly as today.

- [ ] **Step 1: Write failing integration tests:**
  - importing the fixture rows with a `payee_rules` entry for SWIGGY returns `imported` as before, and a rule exists afterward.
  - a `payee_rules` entry with another user's `category_id` throws and no transactions are stored (count unchanged).
  - no `payee_rules` argument: behavior unchanged (existing tests keep passing).
- [ ] **Step 2: Run** `npm run test:integration`. Expected: new tests fail.
- [ ] **Step 3: Implement** `importTransactionsWithPayeeRules`, wire it in the controller (parse `payee_rules` with `JSON.parse` like `trx_list`; validate shape with Joi), and document `payee_rules` in `openApi.ts`.
- [ ] **Step 4: Run** `npm run build`, `npm run check`, `npm run test:integration`. Expected: pass.
- [ ] **Step 5: Commit**

```bash
git add myfin-api/src myfin-api/__tests__
git commit -m "feat: save payee rules in the same transaction as the import"
```

---

### Task 4: Web types, request payload and grouping helpers

**Files:**
- Modify: `myfin-web/src/services/trx/trxServices.ts` (fillData type used by `ImportTransactionsStep1Response`/PhonePe categorize response; `importTransactionsStep2` at line 262)
- Modify: `myfin-web/src/services/trx/trxHooks.ts` (`useImportTransactionsStep2`, line 255)
- Create: `myfin-web/src/features/transactions/import/payeeGroups.ts`

**Interfaces:**
- Produces in `trxServices.ts`: `export type PayeeRule = { match_text: string; type: 'E' | 'I'; category_id?: bigint; entity_id?: bigint; is_essential?: boolean }`. `importTransactionsStep2(list: AddTransactionRequest[], payeeRules?: PayeeRule[])` sends `payee_rules: JSON.stringify(payeeRules)` only when the list is non-empty. `useImportTransactionsStep2` mutation takes `{ list, payeeRules }`.
- Produces in `payeeGroups.ts`, pure functions (no React):
  - `type GroupableTrx = { tempId: number; selected: boolean; type: 'E' | 'I'; payee?: string | null; payeeMatch?: string | null; category?: IdLabelPair; entity?: IdLabelPair; essential: boolean }`
  - `buildPayeeGroups(rows: GroupableTrx[]): PayeeGroup[]` where `PayeeGroup = { key: string; payee: string; type: 'E' | 'I'; matchText: string | null; rowIds: number[]; count: number }`, key is `${type}:${payee.toLowerCase()}`, rows with no payee are excluded, sorted by `count` descending then payee.
  - `groupFieldValue<T>(rows: GroupableTrx[], group: PayeeGroup, pick: (r: GroupableTrx) => T | undefined): { kind: 'none' } | { kind: 'single'; value: T } | { kind: 'mixed' }`
  - `fillBlankRows(rows: GroupableTrx[], group: PayeeGroup, patch: Partial<Pick<GroupableTrx, 'category' | 'entity' | 'essential'>>, overwrite: boolean): GroupableTrx[]` returns new rows; without `overwrite` it sets a field only where the row's value is blank (`essential` counts blank when `false`).
  - `toPayeeRules(rows: GroupableTrx[], groups: PayeeGroup[], touched: Record<string, { category?: boolean; entity?: boolean; essential?: boolean }>): PayeeRule[]` emits one rule per touched group with a non-null `matchText` and at least one selected row; the fields are the group's `single` values for the touched fields only.
- Consumes: `IdLabelPair` from `../AddEditTransactionDialog.tsx`.

- [ ] **Step 1: Add the types and payload change**; update the one existing caller of the step2 hook in `ImportTrxStep2.tsx` to the new `{ list, payeeRules: undefined }` shape so the build stays green.
- [ ] **Step 2: Implement `payeeGroups.ts`** per the signatures above.
- [ ] **Step 3: Verify** with `npm run lint` and `npm run build` in `myfin-web`. Expected: both succeed. (The web app has no unit-test runner and adding one is out of scope; the pure functions are exercised through the manual run in Task 5.)
- [ ] **Step 4: Commit**

```bash
git add myfin-web/src
git commit -m "feat: payee grouping helpers and payee_rules request payload"
```

---

### Task 5: Grouped review view

**Files:**
- Modify: `myfin-web/src/features/transactions/import/ImportTrxStep2.tsx` (state at line ~291, `fillData` mapping at line ~345, `importTransactions` at line ~695, render at line ~740)
- Create: `myfin-web/src/features/transactions/import/ImportTrxStep2PayeeGroups.tsx`
- Modify: `myfin-web/src/locales/en.json` and `pt.json` (find the locale directory in `myfin-web`; keys under `importTransactions`)

**Interfaces:**
- Consumes: everything produced in Task 4; `fillData` items carry `payee`/`payee_match`/`type` from Task 1.
- Produces: `ImportTrxStep2PayeeGroups` props: `{ groups: PayeeGroup[]; transactions: ImportedTrx[]; categoryOptions; entityOptions; filterCategoryOptions; filterEntityOptions; onGroupChange: (group: PayeeGroup, patch, overwrite: boolean) => void; children?: (group) => ReactNode }`. It renders one line per group (payee, count, total amount, category/entity pickers showing "mixed" where applicable, essential checkbox, an "Apply to all rows" button) and an expand control that shows that group's rows in the existing flat table component.

- [ ] **Step 1: Extend `ImportedTrx`** with `type`, `payee`, `payeeMatch` mapped from `fillData`, and add `touched` group state (`Record<string, {category?: boolean; entity?: boolean; essential?: boolean}>`) plus a `groupByPayee` boolean.
- [ ] **Step 2: Show a "Group by payee" switch** only when at least one row has a payee (PhonePe import). When on, render `ImportTrxStep2PayeeGroups` in place of the flat table; when off, the current table. Rows and edits live in the one `transactions` state, so switching keeps edits.
- [ ] **Step 3: Wire `onGroupChange`** to `fillBlankRows` (or the overwrite variant for "Apply to all rows") and mark the field touched. Reuse the existing category/entity `useCreatableOptions` resolve flow so new categories can be created from a group line. Transfers get no group line.
- [ ] **Step 4: In `importTransactions`**, pass `payeeRules: toPayeeRules(transactions, groups, touched)`.
- [ ] **Step 5: Add locale keys** (switch label, "mixed", "apply to all rows", count/total label) to both locale files.
- [ ] **Step 6: Verify** `npm run lint` and `npm run build`. Then run the app (use the `run` skill), import `myfin-api/__tests__/unit/fixtures/phonepe-statement.csv`, and check: groups sorted by count; filling SWIGGY fills its blank rows only; an individually overridden row keeps its value; "mixed" shows; "Apply to all rows" overwrites; switching the toggle keeps edits; transfers are absent from the groups; after import, a rule exists for each touched group and re-importing a statement with the same payee arrives pre-filled; deselecting all rows of a group creates no rule. Report anything not verified.
- [ ] **Step 7: Commit**

```bash
git add myfin-web/src
git commit -m "feat: group PhonePe review rows by payee and remember choices as rules"
```
