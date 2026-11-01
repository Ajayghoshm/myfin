# Phase 2: Subcategories, Move and Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Categories can have one level of subcategories (e.g. Food > Online, Dine in); a category can be moved under another or merged into another, with its transactions and budgets following.

**Architecture:** Add a nullable self-reference `parent_category_id` to `categories`. Transactions, rules, budgets etc. keep pointing at a category row (parent or sub) exactly as today, so existing data and queries keep working; a parent is simply a category that other rows point to. Moving = changing `parent_category_id` (everything follows because it references the id). Merging re-points every table that references the source category, then deletes it. Roll-ups of sub amounts into the parent for budgets and reports are Phase 3 and 5.

**Tech Stack:** Prisma + MySQL, Express/Joi controllers (`myfin-api`), vitest integration tests (`myfin-api/__tests__/integration`), React/MUI (`myfin-web`), `node:test` for pure web helpers.

**Spec:** `docs/superpowers/plans/2026-11-01-next-phase-roadmap.md` (items 15 and 10).

## Global Constraints

- Old backups must still restore: `parent_category_id` is optional in `BackupData`, defaulting to `null`; do not bump the major version in `myfin-api/package.json`.
- One level only: a category with a parent cannot have children; a parent must itself have no parent.
- Existing categories stay top-level (no data migration beyond adding the column).
- Merged-away category is deleted. Moving a category keeps its budgets and transactions attached to it.
- Never run tests against the real DB. Integration tests need `DATABASE_URL` ending in `/myfin_tests` (put it inline on every vitest command); unit tests mock prisma. Back up the real DB before the dev API restarts with the new migration.
- Run lint (`npm run lint`; in `myfin-web` use `node_modules/.bin/biome lint src`) and build before each commit; commit and push after each task.

## Review Focus

- Merge where source and target both have a row in the same budget: planned amounts are summed, nothing lost, no duplicate-key error.
- Merge or move that would create two levels (source has subs and target is a sub; target is a sub of source): rejected with no changes made.
- Deleting a category that still has subcategories is rejected.
- Restoring a backup made before this phase (no `parent_category_id`) yields all top-level categories.
- Merging a category into itself, or into another user's category, is rejected.

---

### Task 1: Schema and migration

**Files:**
- Modify: `myfin-api/prisma/schema.prisma` (model `categories`, around line 109)
- Create: `myfin-api/prisma/migrations/20261101000000_add_category_parent/migration.sql`

**Interfaces:**
- Produces: `categories.parent_category_id: BigInt | null`, relation fields `parent` / `children`, index `categories_parent_idx`.

- [ ] **Step 1:** Add `parent_category_id BigInt?`, `parent categories? @relation("CategoryParent", fields: [parent_category_id], references: [category_id], onDelete: NoAction, onUpdate: NoAction)`, `children categories[] @relation("CategoryParent")`, and `@@index([parent_category_id], map: "categories_parent_idx")`.
- [ ] **Step 2:** Create the migration SQL (add nullable column, index, foreign key `categories_parent_fk`) by running `npx prisma migrate dev --create-only --name add_category_parent` against a throwaway DB (not the real one), then check the generated SQL only adds that column, index and FK.
- [ ] **Step 3:** Run `npm run build` in `myfin-api` (runs `prisma generate` + `tsc`). Expected: succeeds.
- [ ] **Step 4:** Commit `feat: add parent_category_id to categories`.

---

### Task 2: Category service rules for parents

**Files:**
- Modify: `myfin-api/src/services/categoryService.ts`
- Test: `myfin-api/__tests__/integration/categoryHierarchy.integration.test.ts` (new; set up like `rule.integration.test.ts`: `UserService.createUser` in `beforeEach`)

**Interfaces:**
- Consumes: Task 1 column.
- Produces: `Category.parent_category_id?: bigint | null` on the service `Category` interface; `createCategory` accepts it; `static async setCategoryParent(userId: bigint, categoryId: bigint, parentId: bigint | null, dbClient = prisma): Promise<void>`; `deleteCategory` rejects a category that has subcategories. Validation errors are `APIError.notAcceptable(...)`.

- [ ] **Step 1: Failing tests** (names, with assertions): `creates a subcategory under a top-level category`; `rejects a parent that itself has a parent` (throws); `rejects giving a parent to a category that has subcategories`; `rejects a parent owned by another user`; `rejects a category as its own parent`; `setCategoryParent(null) makes a subcategory top-level`; `delete is rejected while subcategories exist, allowed once they are moved`; `moving a category keeps its transactions` (transaction's `categories_category_id` unchanged).
- [ ] **Step 2:** Run `DATABASE_URL=<.../myfin_tests> npx vitest run --config vitest.config.integration.ts __tests__/integration/categoryHierarchy.integration.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the validation in a private `assertValidParent(userId, categoryId | undefined, parentId, dbClient)` used by `createCategory` and `setCategoryParent`; add the children check to `deleteCategory`.
- [ ] **Step 4:** Re-run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat: category parents with one-level validation`.

---

### Task 3: Merge categories

**Files:**
- Modify: `myfin-api/src/services/categoryService.ts`
- Test: `myfin-api/__tests__/integration/categoryHierarchy.integration.test.ts`

**Interfaces:**
- Consumes: `setCategoryParent`.
- Produces: `static async mergeCategories(userId: bigint, sourceId: bigint, targetId: bigint): Promise<void>` — one `prisma.$transaction`.

Re-point from source to target in: `transactions.categories_category_id`, `rules.assign_category_id`, `yearly_costs.category_id`, `planned_transactions.categories_category_id`, `debt_payments.original_category_id`, `events.category_id`, `user_financial_profile.salary_category_id`, and `budgets_has_categories` (+ `budget_category_items`). For a budget where both have a row: add source's `planned_amount_credit`, `planned_amount_debit`, `current_amount` into the target row, move the source's breakdown items to the target row, delete the source row. Where only the source has a row: create the target row with the same amounts, move the items, delete the source row. Subcategories of the source become subcategories of the target (only valid if target is top-level; otherwise reject). Finally delete the source category.

- [ ] **Step 1: Failing tests:** `merge moves transactions, rules, events and planned transactions to the target`; `merge sums planned amounts when both categories have a row in the same budget`; `merge moves budget when only the source has a row`; `merge moves breakdown items`; `source category no longer exists after merge`; `subcategories of the source are re-parented to the target`; `rejects merging into itself`; `rejects target owned by another user`; `rejects when source has subcategories and target is a subcategory`; `rejects when target is a subcategory of the source`; `failed merge changes nothing` (counts before == after).
- [ ] **Step 2:** Run the file. Expected: FAIL.
- [ ] **Step 3:** Implement `mergeCategories` in a single transaction following the list above.
- [ ] **Step 4:** Run the file. Expected: PASS.
- [ ] **Step 5:** Commit `feat: merge categories`.

---

### Task 4: API endpoints

**Files:**
- Modify: `myfin-api/src/controllers/categoryController.ts`, `myfin-api/src/routes/routeDefinitions.ts` (Categories block, ~line 338)
- Test: extend `categoryHierarchy.integration.test.ts` only if controllers are already tested that way; otherwise rely on Tasks 2-3 service tests and verify by calling the endpoints.

**Interfaces:**
- Produces: `POST /cats` and `PUT /cats` accept `parent_category_id` / `new_parent_category_id` (number | null, optional); `POST /cats/merge` with body `{ source_category_id: number, target_category_id: number }` returns `'Categories successfully merged!'`. `GET /cats` already returns every column, so it includes `parent_category_id`.

- [ ] **Step 1:** Add the Joi fields (`joi.number().allow(null).optional()`) and call `setCategoryParent` from `updateCategory` when the field is present; add `mergeCategories` handler and the `{ method: 'post', path: '/merge', handlerName: 'mergeCategories' }` route.
- [ ] **Step 2:** `npm run build` and `npm run lint` in `myfin-api`. Expected: succeed.
- [ ] **Step 3:** Commit `feat: category parent and merge endpoints`.

---

### Task 5: Backup and restore

**Files:**
- Modify: `myfin-api/src/utils/backupManager.ts` (category restore ~line 875)
- Test: `myfin-api/__tests__/integration/backupRoundTrip.integration.test.ts`

**Interfaces:**
- Consumes: `categories` rows already include `parent_category_id` in backups via `findMany`.

- [ ] **Step 1: Failing tests:** `round trip keeps subcategory parents`; `restoring a backup whose categories have no parent_category_id gives top-level categories`.
- [ ] **Step 2:** Run the backup test file (inline `DATABASE_URL`). Expected: FAIL on the first.
- [ ] **Step 3:** After all categories are created (the `categoryIdMap` is complete), update each restored category whose backup row has a non-null `parent_category_id` to `categoryIdMap.get(parent)`; treat a missing field as `null`. Keep `parent_category_id` optional in the backup type.
- [ ] **Step 4:** Run the backup test file plus `categoryHierarchy`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: include category parents in backup and restore`.

---

### Task 6: Web category tree helper

**Files:**
- Modify: `myfin-web/src/services/category/categoryServices.ts` (`Category.parent_category_id?: bigint | null`; `AddCategoryRequest.parent_category_id?`; `EditCategoryRequest.new_parent_category_id?`; `mergeCategories(sourceId: bigint, targetId: bigint)` calling `POST /cats/merge`)
- Create: `myfin-web/src/services/category/categoryTree.ts`
- Test: `myfin-web/tests/categoryTree.test.ts` (`node:test`, like `payeeGroups.test.ts`; run `node --test tests/categoryTree.test.ts`)

**Interfaces:**
- Produces: `buildCategoryTree(categories: Category[]): Array<{ category: Category; children: Category[] }>` (parents sorted by name, children sorted by name, orphaned/invalid parents treated as top-level); `categoryLabel(category: Category, all: Category[]): string` returning `Food › Online` for a subcategory and `Food` for a top-level one.

- [ ] **Step 1: Failing tests:** `groups subcategories under their parent`; `top-level categories with no children have empty children`; `a category whose parent is missing is treated as top-level`; `categoryLabel joins parent and child with " › "`.
- [ ] **Step 2:** Run `node --test tests/categoryTree.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the two functions.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat: category tree helpers`.

---

### Task 7: Categories page shows the tree and edits parents

**Files:**
- Modify: `myfin-web/src/features/categories/Categories.tsx`, `myfin-web/src/services/category/AddEditCategoryDialog.tsx`, translation files (follow `docs/frontend-guidelines.md` for i18n keys)

- [ ] **Step 1:** In the Add/Edit dialog add an optional "Parent category" select listing only top-level categories (excluding the category being edited, and hidden/disabled when the edited category has subcategories); empty means top-level, which is also how a category is moved back to top-level. Send `parent_category_id` / `new_parent_category_id`.
- [ ] **Step 2:** In `Categories.tsx` render `buildCategoryTree` output: each parent followed by its indented subcategories.
- [ ] **Step 3:** Run `node_modules/.bin/biome lint src` and `npm run build`. Expected: succeed. In the browser: create Food, create Online and Dine in under it, move an existing category under Food, move it back; a category with subcategories cannot be given a parent; deleting Food while it has subcategories shows the API error.
- [ ] **Step 4:** Commit `feat: subcategories in the categories page`.

---

### Task 8: Merge dialog

**Files:**
- Create: `myfin-web/src/features/categories/MergeCategoryDialog.tsx`
- Modify: `myfin-web/src/features/categories/Categories.tsx` (a "Merge into..." action per category), `myfin-web/src/services/category/CategoryHooks.tsx` (`useMergeCategories`, invalidating categories, budgets and transactions queries)

- [ ] **Step 1:** Dialog: the source is fixed; pick a target (using `categoryLabel`, excluding the source); a confirmation line states the source will be deleted and all its transactions and budgets move to the target; confirm calls `mergeCategories`.
- [ ] **Step 2:** Lint + build. In the browser: merge two categories that both have budget amounts and confirm the target shows the combined amounts; confirm the source is gone and error messages from the API (e.g. two-level conflict) are shown.
- [ ] **Step 3:** Commit `feat: merge categories dialog`.

---

### Task 9: Show "Parent › Sub" wherever categories are picked

**Files:**
- Modify (category dropdowns): `myfin-web/src/features/transactions/Transactions.tsx`, `myfin-web/src/features/transactions/BulkEditTransactionsDialog.tsx`, `myfin-web/src/features/events/Events.tsx`, `myfin-web/src/features/yearlyCosts/YearlyCosts.tsx`, `myfin-web/src/features/profile/FinancialProfileForm.tsx`, `myfin-web/src/features/transactions/import/ImportTrxStep2.tsx`, and the rule and add-transaction forms found by `grep -rn "useGetCategories" myfin-web/src`

- [ ] **Step 1:** Wherever an option label is built from `category.name`, use `categoryLabel(category, allCategories)`; keep the option value as `category_id`, and sort by label so subcategories sit under their parent.
- [ ] **Step 2:** Lint + build. In the browser: open the add-transaction form, the import review step and a rule: subcategories appear as `Food › Online` and can be selected.
- [ ] **Step 3:** Commit `feat: show subcategories as Parent › Sub in category pickers`.
