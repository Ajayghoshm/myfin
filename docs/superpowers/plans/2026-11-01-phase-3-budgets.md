# Phase 3: Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Budgets understand subcategories (grouped view, whole-category allocation, "Unassigned" section), there is one reusable budget template that can be filled from the last 6 months of Insights data, new months are created from it in one click, a quick-entry screen makes monthly budgeting fewer clicks, and rows with nothing budgeted or spent can be hidden.

**Architecture:** Amounts stay stored exactly as today, per category row (parent or sub), so all existing totals keep summing correctly. Two new rules keep them from double counting: (1) *either/or* — a parent with subcategories is budgeted either as one lump sum on the parent or on its subcategories, never both (enforced when saving); (2) *roll-up is display-only* — the API keeps returning raw per-category planned/actual values (plus `parent_category_id`), and the web adds subcategory values into the parent row for display. The template is three new tables mirroring `budgets_has_categories` / `budget_category_items`, one template per user, applied through the existing `BudgetService.createBudget`.

**Tech Stack:** Prisma + MySQL, Express/Joi, vitest integration tests (`myfin-api`), React/MUI, TanStack Query, `node:test` for pure web helpers (`myfin-web`).

**Spec:** `docs/superpowers/plans/2026-11-01-next-phase-roadmap.md` (items 2, 3, 4, 5, 5a, 11) and the design decisions recorded 2026-11-01: either/or amounts, one template, both one-click-from-template and a quick-entry screen.

## Global Constraints

- Old backups must still restore; template data is optional in `BackupData`; do not bump the major version.
- Money is integer cents in the DB and API internals; the budget save API takes decimal currency (`cat_values_arr`). Keep the invariant: per direction, if breakdown items exist, planned == sum of items (`BudgetAllocationService.directionTotal`).
- Closed budgets stay read-only. Inactive categories cannot be saved into a budget (`save()` returns 403), so any "fill everything" flow must skip them.
- Hide-zero rule: hide a row only when budgeted AND spent are both zero; the toggle is not remembered between visits.
- Mixed sub/parent display: standalone top-level categories (no subcategories) appear under an "Unassigned" heading; parents with subcategories appear as groups.
- Template suggestions use the average of the last 6 months of actual spend and are applied only after the user confirms.
- New literal routes under `/budgets` must be registered before `/:id`.
- Update `myfin-api/src/docs/openApi.ts` for new endpoints and both `src/locales/*.json` files in the API and the web i18n files for new text.
- Never run tests against the real DB: throwaway MySQL (`mysql:8.4` with root grants), `DATABASE_URL=.../myfin_tests` inline on every vitest/prisma command, `-c vitest.config.integration.ts`, one file at a time. Run lint/build before each commit; commit and push after each task.

## Review Focus

- A parent budgeted as a lump sum plus a subcategory amount in the same budget is rejected; the same via the matrix cell endpoint and via the template; moving a category under a parent that would create such a conflict is rejected.
- Budget totals (list, summary, matrix) do not change for existing budgets after this phase (no double counting, no missing rows).
- Creating a month from the template when the month already exists returns a clear error and changes nothing; inactive or deleted categories in the template are skipped, not fatal.
- Deleting or merging a category that is in the template leaves a valid template (no orphan rows, merged amounts summed with the breakdown invariant intact).
- Restoring a pre-phase backup (no template tables) works; a new backup round-trips the template.

---

## Part A: API

### Task 1: Expose `parent_category_id` in budget payloads

**Files:**
- Modify: `myfin-api/src/services/categoryService.ts` (`getAllCategoriesForBudget` SQL, ~line 530), `myfin-api/src/services/budgetService.ts` (private duplicate `getAllCategoriesForUser`, ~line 48), `myfin-api/src/services/budgetMatrixService.ts` (categories `findMany` select)
- Test: `myfin-api/__tests__/integration/budget.integration.test.ts`

**Interfaces:** Produces: every category object in `GET /budgets/:id`, `POST /budgets/step0` and `GET /budgets/matrix` carries `parent_category_id: number | string | null`.

- [ ] **Step 1: Failing tests:** `getBudget returns parent_category_id for subcategories and null for top-level`; `step0 categories include parent_category_id`; `matrix categories include parent_category_id`.
- [ ] **Step 2:** Run `budget.integration.test.ts`. Expected: FAIL on the three.
- [ ] **Step 3:** Add `parent_category_id` to the SELECT / `select`. Do not change any amount logic.
- [ ] **Step 4:** Run the file plus `budgetBreakdown`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: expose category parent in budget payloads`.

### Task 2: Either/or rule

**Files:**
- Modify: `myfin-api/src/services/budgetAllocationService.ts` (`save`, ~line 96), `myfin-api/src/services/categoryService.ts` (`setCategoryParent`)
- Test: `myfin-api/__tests__/integration/budgetBreakdown.integration.test.ts` or a new `budgetHierarchy.integration.test.ts`

**Interfaces:** Produces: saving planned > 0 (or any items) on a category whose parent has planned > 0 or items in the same budget — or on a parent while any of its subcategories has planned > 0 or items in that budget — throws `APIError.badRequest` with rationale `BUDGET_CATEGORY_CONFLICT` (same style as `BUDGET_BREAKDOWN_CONFLICT`). `setCategoryParent` rejects (406) a move that would leave any budget with both a parent and one of its subcategories budgeted, with a message telling the user to clear one first.

- [ ] **Step 1: Failing tests:** `rejects budgeting a subcategory when its parent has an amount in that budget`; `rejects budgeting a parent when a subcategory has an amount`; `allows a parent lump sum when subcategory rows are zero`; `allows budgeting only subcategories`; `zero amounts never conflict`; `a conflict in another budget does not block this one`; `matrix cell update (PUT /budgets/:id) enforces the same rule`; `moving a category under a parent is rejected when both are budgeted in some budget`; `moving is allowed when only one of them is budgeted`.
- [ ] **Step 2:** Run the file. Expected: FAIL.
- [ ] **Step 3:** In `save`, inside the existing transaction after the category checks, load the category's parent and children rows for this budget and apply the rule. Reuse the existing error helper used for `BUDGET_BREAKDOWN_CONFLICT`. Add the move check to `setCategoryParent`.
- [ ] **Step 4:** Run the new file, `budget`, `budgetBreakdown`, `categoryHierarchy`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: budget amounts are either on a parent or on its subcategories`.

### Task 3: Template tables and service

**Files:**
- Modify: `myfin-api/prisma/schema.prisma`; create migration `myfin-api/prisma/migrations/20261101010000_add_budget_template/migration.sql`
- Create: `myfin-api/src/services/budgetTemplateService.ts`
- Modify: `myfin-api/src/services/categoryService.ts` (`deleteCategory`, `mergeCategories`), `myfin-api/__tests__/integration/utils/resetDb.ts`, `myfin-api/src/services/userService.ts` (`deleteAllUserData`, before categories are deleted)
- Test: `myfin-api/__tests__/integration/budgetTemplate.integration.test.ts`

**Interfaces:**
- Tables: `budget_templates(template_id PK, users_user_id UNIQUE FK users, updated_at BigInt)`, `budget_template_rows(template_id, categories_category_id, planned_amount_credit BigInt, planned_amount_debit BigInt; PK(template_id, categories_category_id))`, `budget_template_items(item_id PK, template_id, categories_category_id, direction budget_item_direction, label VarChar(255), amount BigInt, sort_order Int; composite FK to rows, onDelete Cascade)`.
- Produces in `BudgetTemplateService`:
  - `get(userId: bigint): Promise<{ rows: TemplateRow[]; updated_at: number | null }>` with `TemplateRow = { category_id; planned_value_debit; planned_value_credit; expense_items: Item[]; income_items: Item[] }` in decimal currency (same shape as one `cat_values_arr` element), `{ rows: [], updated_at: null }` when none.
  - `replace(userId: bigint, rows: TemplateRowInput[]): Promise<void>` — validates ownership, active status, the items invariant and the Task 2 either/or rule; replaces the whole template in one transaction.
  - `fromBudget(userId: bigint, budgetId: bigint): Promise<void>` — copies a budget's non-zero rows and items into the template.
  - `createBudgetFromTemplate(userId: bigint, month: number, year: number): Promise<{ budget_id: bigint; skipped_category_ids: bigint[] }>` — 409 if the month already has a budget; skips inactive/missing categories; calls `BudgetService.createBudget`.
- `deleteCategory` removes the category's template rows; `mergeCategories` merges template rows exactly as it merges budget rows (sum amounts, keep the items invariant with a balancing item).

- [ ] **Step 1: Failing tests:** `get returns empty template for a new user`; `replace then get round-trips amounts and items`; `replace rejects another user's category`; `replace rejects inactive category`; `replace rejects the either/or conflict`; `replace rejects items that do not match planned totals when both given` (same rule as budgets); `fromBudget copies non-zero rows and items`; `createBudgetFromTemplate creates a budget with the template amounts`; `createBudgetFromTemplate returns 409 for an existing month and changes nothing`; `createBudgetFromTemplate skips inactive categories and reports them`; `deleting a category removes its template rows`; `merging categories sums template rows and keeps planned == item sum`; `deleteAllUserData removes the template`.
- [ ] **Step 2:** Add the models and generate the migration against a throwaway DB (`prisma migrate dev --create-only`, check it only creates the three tables). Run the new test file. Expected: FAIL.
- [ ] **Step 3:** Implement the service and the delete/merge/reset hooks. Keep the diff in existing files to the real hunks (no reformatting).
- [ ] **Step 4:** Run `budgetTemplate`, `categoryHierarchy`, `budget`, `backupRoundTrip`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: single budget template`.

### Task 4: Template endpoints

**Files:**
- Modify: `myfin-api/src/controllers/budgetController.ts`, `myfin-api/src/routes/routeDefinitions.ts` (Budgets block, ~line 309-334), `myfin-api/src/docs/openApi.ts`

**Interfaces:** Produces: `GET /budgets/template` → `{ rows, updated_at }`; `PUT /budgets/template` body `{ rows: TemplateRowInput[] }`; `POST /budgets/template/from-budget` body `{ budget_id }`; `POST /budgets/from-template` body `{ month, year }` → `{ budget_id, skipped_category_ids }`. All registered before `/:id`.

- [ ] **Step 1:** Add Joi schemas (same field rules as `cat_values_arr` items; money as numbers) and handlers calling `BudgetTemplateService`; register the four routes before `/:id`; document them in `openApi.ts`.
- [ ] **Step 2:** `npm run build` and the focused integration files for budgets. Expected: succeed. Verify a route-order test or request proves `GET /budgets/template` is not captured by `/:id`.
- [ ] **Step 3:** Commit `feat: budget template endpoints`.

### Task 5: Template suggestions from Insights

**Files:**
- Modify: `myfin-api/src/services/insights/typicalMonth.ts` (make the baseline length a parameter; default stays 3), `myfin-api/src/services/budgetTemplateService.ts`, controller + route + `openApi.ts`
- Test: `myfin-api/__tests__/integration/budgetTemplate.integration.test.ts` and `typicalMonth.integration.test.ts`

**Interfaces:** Produces `BudgetTemplateService.suggestions(userId: bigint): Promise<Array<{ category_id: bigint; level: 'parent' | 'category'; current_debit: number; current_credit: number; suggested_debit: number; suggested_credit: number }>>` and `GET /budgets/template/suggestions`. Suggested values are the average of the last 6 completed months (average over months that have data, as `computeTypical` does), in decimal currency. For a category whose template amount sits on a parent (lump sum), suggest on the parent using its own plus its subcategories' averages; otherwise suggest per category row.

- [ ] **Step 1: Failing tests:** `suggestions use the last 6 months average`; `months without data do not drag the average down` (same rule as existing typical month); `parent lump sum template gets one rolled-up suggestion on the parent`; `subcategory template gets per-subcategory suggestions`; `uncategorised spending is ignored`; `typicalMonth default baseline is still 3 months` (existing behavior unchanged).
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Add an optional `months` argument to `typicalMonth` (default 3) and implement `suggestions` on top of `fetchRows`/`computeTypical`; do not apply anything.
- [ ] **Step 4:** Run both files plus `forecast`, `insights`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: template suggestions from the last 6 months`.

### Task 6: Backup and restore of the template

**Files:**
- Modify: `myfin-api/src/utils/backupManager.ts` (`BackupData`, `createBackup` ~line 356, `restoreBackup` after categories are linked ~line 1027), `myfin-api/__tests__/integration/backupRoundTrip.integration.test.ts`

**Interfaces:** Produces optional `budget_templates`, `budget_template_rows`, `budget_template_items` in `BackupData` (absent in old backups).

- [ ] **Step 1: Failing tests:** `round trip keeps the budget template with items`; `a backup without template data restores with no template`; `restore rejects a template whose items do not match planned totals` (validated before the wipe, like budgets).
- [ ] **Step 2:** Run `backupRoundTrip`. Expected: FAIL.
- [ ] **Step 3:** Export the three tables in `createBackup`; validate, then restore after categories exist, remapping category ids via `categoryIdMap`; treat missing arrays as empty. Keep the diff to real hunks.
- [ ] **Step 4:** Run `backupRoundTrip`, `folderBackup`, `budgetBreakdown`, `budgetTemplate`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: include the budget template in backup and restore`.

---

## Part B: Web

### Task 7: Budget grouping and roll-up helpers

**Files:**
- Create: `myfin-web/src/features/budgets/budgetGroups.ts`
- Test: `myfin-web/tests/budgetGroups.test.ts` (`node:test`; run with Node 24, `node --test tests/budgetGroups.test.ts`)
- Modify: `myfin-web/src/services/budget/budgetServices.ts` (`parent_category_id` on budget category types; template endpoint calls and types; query keys)

**Interfaces:** Produces:
- `groupBudgetRows<T extends { category_id; parent_category_id?; name }>(rows: T[]): { groups: Array<{ parent: T; children: T[] }>; unassigned: T[] }` — a parent with at least one child (in the data) is a group; a top-level row with no children goes to `unassigned`; rows whose parent is missing are treated as top-level.
- `rolledUp(group, field: 'planned_debit' | 'planned_credit' | 'current_debit' | 'current_credit'): number` — parent's own value plus children's (planned shows the lump sum or the children's sum; actual always own + children).
- `budgetMode(group): 'lump' | 'split' | 'empty'` — whether the parent or its children carry the planned amount (drives which inputs are enabled).
- `isZeroRow(row): boolean` — budgeted and spent both zero and no breakdown items.

- [ ] **Step 1: Failing tests:** `groups parents with children and puts standalone categories in unassigned`; `rolledUp adds children to the parent for actual`; `rolledUp planned returns lump sum when parent has an amount, else the children's sum`; `budgetMode detects lump, split and empty`; `isZeroRow is false when planned or current is non-zero or items exist`.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement the functions and add the service types/calls for `GET/PUT /budgets/template`, `POST /budgets/template/from-budget`, `POST /budgets/from-template`, `GET /budgets/template/suggestions` with matching hooks and query keys (`QUERY_KEY_GET_BUDGET_TEMPLATE`, ...).
- [ ] **Step 4:** Run the test, `biome lint` on touched files, `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit `feat: budget grouping helpers and template service calls`.

### Task 8: Grouped budget details, whole-category allocation, hide-zero

**Files:**
- Modify: `myfin-web/src/features/budgets/details/BudgetDetails.tsx` (category ordering ~lines 171-221), `BudgetCategoryRow.tsx`, `myfin-web/src/features/budgets/matrix/BudgetMatrix.tsx` (`categoriesByDirection` ~line 671), i18n files

- [ ] **Step 1:** In both screens render `groupBudgetRows` output: a group header row per parent showing the rolled-up planned/actual, indented subcategory rows, then an "Unassigned" section for standalone categories. Parent input is enabled only in `lump`/`empty` mode and child inputs only in `split`/`empty` mode, with a short hint when disabled ("budgeted per subcategory" / "budgeted on the whole category"). Saving surfaces the API's `BUDGET_CATEGORY_CONFLICT` message through `apiErrorMessage`.
- [ ] **Step 2:** Add a "Hide empty rows" toggle (default off, not persisted) using `isZeroRow`; works for open, closed and new budgets and in the matrix; a group hides only when the parent and all its children are zero rows.
- [ ] **Step 3:** `biome lint` on touched files and `npm run build` succeed. Manual browser checks (list them in the report): lump-sum on Food, then split into Online/Dine in; the other mode's inputs disable; roll-up actuals match the transactions; hide-empty works in details and matrix.
- [ ] **Step 4:** Commit `feat: grouped budget screens with whole-category allocation and hide empty rows`.

### Task 9: Template screen and Insights suggestions

**Files:**
- Create: `myfin-web/src/features/budgets/template/BudgetTemplate.tsx`; Modify: `myfin-web/src/providers/RoutesProvider.tsx` (route `/budgets/template`), `BudgetList.tsx` (entry button), i18n files

- [ ] **Step 1:** Template page: grouped category grid (same grouping and modes as Task 8) editing planned debit/credit; rows that carry breakdown items show the total read-only with an "edit via a budget, then Save as template" note; Save calls `PUT /budgets/template`; "Save a budget as template" picker calls `from-budget`.
- [ ] **Step 2:** "Suggest from last 6 months" button: fetch suggestions, show current vs suggested per category with a checkbox each (default checked for changed rows), applying only on "Apply selected" (updates the grid; the user still presses Save).
- [ ] **Step 3:** Lint/build. Manual checks: create a template, reload and see it, apply a suggestion, an empty template shows an empty state.
- [ ] **Step 4:** Commit `feat: budget template screen with insight suggestions`.

### Task 10: One-click month from template and auto-fill

**Files:**
- Modify: `myfin-web/src/features/budgets/list/BudgetList.tsx`, `details/BudgetDetails.tsx`, `matrix/BudgetMatrix.tsx` (`AddMonthDialog`, ~line 399), i18n files

- [ ] **Step 1:** BudgetList: "New month from template" button (month defaults to the next month without a budget) that calls `from-template` and opens the new budget; shows the skipped-category count if any; shows the API's 409 message if the month exists.
- [ ] **Step 2:** `AddMonthDialog`: add "Template" as a clone source; `BudgetDetails` new-budget screen: "Fill from template" action that pre-fills the form from the template (skipping inactive categories).
- [ ] **Step 3:** Lint/build. Manual checks: one click creates a month; duplicate month error is shown; fill-from-template on the new-budget screen fills the right rows.
- [ ] **Step 4:** Commit `feat: create budget months from the template`.

### Task 11: Quick-entry screen

**Files:**
- Create: `myfin-web/src/features/budgets/quick/BudgetQuickEntry.tsx`; Modify: `RoutesProvider.tsx` (route `/budgets/quick`), `BudgetList.tsx` (entry), i18n files

- [ ] **Step 1:** One compact screen for one month (month picker; creates the budget on first save if the month has none, otherwise edits it): grouped table with columns Category | Template | Last month | Planned (input) | Actual; Tab moves down the Planned column; a single Save (`createBudget` or `updateBudget` with the whole `cat_values_arr`, skipping inactive categories and omitting rows left at zero); "Fill from template", "Hide empty rows" and an "Edit categories" link to the Categories page; closed budgets are read-only.
- [ ] **Step 2:** Lint/build. Manual checks: enter a whole month with the keyboard only; save; reopen in the details screen and see the same numbers; an either/or conflict shows the API message.
- [ ] **Step 3:** Commit `feat: quick-entry screen for monthly budgets`.
