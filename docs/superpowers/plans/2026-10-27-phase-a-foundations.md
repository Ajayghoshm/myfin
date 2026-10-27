# Phase A (Foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared foundations the later phases need:
- a settings home ("Financial profile");
- one shared "counts for analytics" rule, including month-end salary attribution;
- fixed vs flexible costs (#8);
- balance check and reconciliation (#11);
- data freshness per account (#22);
- encrypted backups to a synced folder (#20).

**Architecture:**
- **API:** a single `user_financial_profile` row per user holds settings. A shared analytics module owns:
  - the "counts" predicate (income/expense, not adjustments);
  - the effective-month rule (salary-category income on or after the cut-off day counts next month).

  Insights, the Transactions list and bulk update all use it.
- **New columns:** categories get `is_fixed`; transactions get `is_adjustment`; accounts get `stale_after_days`.
- **New table:** `balance_checks` records reconciliations.
- **Folder backups:** encrypt the existing full user backup (AES-256-GCM, scrypt) into `BACKUP_DIR`.
- **Web:** new screens follow existing MUI / react-query patterns.

**Tech Stack:** myfin-api: Express 5, Prisma 7 (client at `src/generated/prisma`), MySQL 8.4, joi, vitest, Node `crypto`. myfin-web: React, MUI, react-query, i18next (en/pt/fr), `@nivo`.

**Spec:** `docs/superpowers/specs/2026-10-27-shortlist-designs.md`. Sections #8, #11, #22, #20 and "Cross-cutting decisions" 1, 3, 5, 9, 10 are binding.

## Global Constraints

- **Months and time zone:**
  - IST months via `monthRangeIST` (`myfin-api/src/services/insights/insightsPrimitives.ts`); the web mirror is `myfin-web/src/utils/istMonth.ts`.
  - Days are IST days: `[monthRangeIST(m).from + (d-1)*86400, +86400)`.
- **Counts for analytics:** `type IN ('E','I') AND is_adjustment = false`.
  - Transfers (`T`) and adjustments never count in Insights or any new figure.
  - Existing upstream pages (Budgets, Stats, Dashboard charts) are NOT changed.
- **Effective month:**
  - A row is a "late salary" when its type is `I`, its category is the user's `salary_category_id`, and its date is ≥ the IST midnight of day `salary_cutoff_day` (default 25) of its calendar month.
  - A late salary's effective month is the next month. All other rows use their calendar IST month.
  - With no `salary_category_id` set, nothing shifts.
- **Fixed vs flexible:**
  - fixed = an `E` row whose category has `is_fixed = true`;
  - flexible = an `E` row whose category has `is_fixed = false`;
  - unsorted = an `E` row with no category.
  - The existing `transactions.is_essential` is untouched; it is a separate concept.
- **Drill-down:** every figure must equal the sum of its drill-down rows.
  - Insights links and Transactions URL `month=` use the effective-month rule, through a new `effective_month` API param.
  - Bulk update "select all matching" must send the same filters as the list.
- **Money:** `transactions.amount` and `accounts.current_balance` are integer cents. API responses use decimal currency.
- **Freshness defaults** (days) by account type:

  | Type | Days |
  |---|---|
  | `CHEAC` / `WALLET` / `MEALAC` | 7 |
  | `SAVAC` | 30 |
  | `CREAC` | 35 |
  | `INVAC` / `OTHAC` | 45 |

  A stored `stale_after_days` of `0` means "never"; `null` means "use the type default". Inactive accounts are never stale. Only a transaction date makes an account fresh.
- **Balance check:**
  - The user enters the real balance. For `CREAC` they enter the amount owed (positive); compare it with `-current_balance`.
  - A write-off creates one transaction dated now, with category "Balance adjustment" (auto-created, type `M`, per user) and description "Reconciliation write-off". `is_adjustment = true`. Type `I` when MyFin is lower than real, `E` when higher, for the gap amount.
- **Backups:**
  - File name `myfin-backup-YYYY-MM-DD-HHmm.myfin` (IST).
  - Format: magic `MYFINBK1`, then a version byte `1`, a 16-byte salt, a 12-byte IV, a 16-byte auth tag, then the ciphertext of the UTF-8 JSON from the existing `UserService.backupUser`.
  - Key = scrypt(password, salt, 32, N=2^15, r=8, p=1).
  - Keep the newest 30 `.myfin` files and delete older ones. Password length ≥ 8. The password is never stored or logged.
- **Backup/restore:** every new column and table is included, and older backups restore with defaults.
- **Tests and databases:** tests never touch localhost:3306 / 3307. Integration tests use a throwaway `mysql:8.4` on localhost:3308, with `DATABASE_URL` exported. `myfin-web` has no test runner; verify it with `tsc`, `build` and `biome`.
- **Locales:** en/pt/fr keys are inserted textually (never re-serialised), and the JSON must stay valid.
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `.env` files.

## Review Focus

1. **Salary credited at 23:59 IST on the 24th vs 00:00 IST on the 25th:** only the second shifts to next month, in both Insights and the Transactions drill-down. *(Test in Task 2.)*
2. **Write-off on a credit card where MyFin shows more debt than the bank:** the adjustment direction makes MyFin's owed amount equal the entered amount. *(Test in Task 4.)*
3. **Restoring a backup made before Phase A:** it succeeds with `is_fixed = false`, `stale_after_days = null`, `is_adjustment = false` and no profile row. *(Test in Task 1, extended in later tasks.)*
4. **A wrong backup password or a corrupted file:** a clear 400 error, and the current data is untouched (decryption and validation happen before any delete). *(Test in Task 6.)*
5. **`BACKUP_DIR` unset, missing or read-only:** the list endpoint reports `available: false` with a reason, and the web disables the buttons. Never a 500. *(Test in Task 6.)*

---

### Task 1: Financial profile (settings home) + TZ

**Files:**
- **Modify** `myfin-api/prisma/schema.prisma` to add model `user_financial_profile`:
  - `users_user_id BigInt @id` (FK users, cascade delete);
  - `salary_category_id BigInt?`;
  - `salary_cutoff_day Int @default(25)`;
  - `updated_at BigInt`.

  Then the migration `add_user_financial_profile`.
- **Create** `myfin-api/src/services/financialProfileService.ts`:
  - `getFinancialProfile(userId): Promise<FinancialProfile>` returns defaults when no row exists;
  - `updateFinancialProfile(userId, patch): Promise<FinancialProfile>` upserts, validates that `salary_category_id` belongs to the user (else 401), and requires `salary_cutoff_day` to be 1–28.
- **Create** `myfin-api/src/controllers/financialProfileController.ts`. Add routes `GET /user/financial-profile` and `PUT /user/financial-profile` to the existing `/user` group in `routeDefinitions.ts`. Body: `{ salary_category_id?: number|null, salary_cutoff_day?: number }`.
- **Modify** backup and restore (`myfin-api/src/utils/backupManager.ts`):
  - export the profile row as `financial_profile` (or null);
  - on restore, re-create it, remapping `salary_category_id` through the restored category id map;
  - an old backup without the field gives no row.
- **Modify** `resetDb.ts` and the user-data wipe (`userService.ts`) to delete the profile.
- **Modify** the root `docker-compose.yml` and `myfin-api/docker-compose.yml` to add `TZ=Asia/Kolkata` to the API service environment. Add one line in `myfin-api/README.md` saying that local runs should set `TZ=Asia/Kolkata`.
- **Web:**
  - create `myfin-web/src/services/profile/financialProfileServices.ts` and `financialProfileHooks.ts`;
  - create `myfin-web/src/features/profile/FinancialProfileForm.tsx` (salary category select + cut-off day), placed in `Profile.tsx` near `ChangeCurrencyForm`;
  - add locale keys.
- **Tests:** `myfin-api/__tests__/integration/financialProfile.integration.test.ts`.

**Interfaces:**
- Produces `export type FinancialProfile = { salary_category_id: string | null; salary_cutoff_day: number }` and the two service functions. Later phases add columns to the same table and type.

- [ ] **Step 1: Failing tests.**
  - GET with no row returns `{salary_category_id:null, salary_cutoff_day:25}`.
  - PUT sets both; GET returns them.
  - PUT with another user's category gives 401.
  - `salary_cutoff_day: 29` gives 400.
  - Backup → restore keeps the profile, with the category id remapped to the restored category.
  - Restoring a backup object with `financial_profile` deleted succeeds and gives defaults.
  - The user-data wipe removes the row.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the API pieces.
- [ ] **Step 4:** Run the file plus the full integration and unit suites and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Build the web form; run `npx tsc --noEmit && npm run build` and biome on the touched files.
- [ ] **Step 6: Commit** `feat: financial profile settings (salary category, cut-off day) and IST server time zone`.

### Task 2: Shared analytics rules — counts + effective month

**Files:**
- **Modify** `myfin-api/prisma/schema.prisma`: `transactions.is_adjustment Boolean @default(false)`, via migration `add_transaction_is_adjustment`.
- **Create** `myfin-api/src/services/insights/analyticsRules.ts`:
  ```ts
  export const countsForAnalyticsSql: Prisma.Sql; // "transactions.type IN ('E','I') AND transactions.is_adjustment = false"
  export type SalaryRule = { salaryCategoryId: bigint | null; cutoffDay: number };
  export function salaryRuleFor(userId: bigint): Promise<SalaryRule>; // from the financial profile
  export function effectiveMonthSql(ym: YearMonth, rule: SalaryRule): Prisma.Sql;
  export function effectiveMonthOf(row: { type: string; categoryId: string | null; date: number }, rule: SalaryRule): YearMonth; // TS mirror for row bucketing
  ```
  - `effectiveMonthSql` is a predicate selecting rows whose effective month is `ym`: calendar rows in `[from, to)` that are not late salary, plus late-salary rows dated in `[cutoff(prev), from)`. Here `cutoff(m) = monthRangeIST(m).from + (cutoffDay-1)*86400`. It uses only `transactions.*` columns.
  - With `salaryCategoryId = null` it reduces to the plain range.
- **Modify** `myfin-api/src/services/insights/insightsService.ts`:
  - `fetchRows` uses `countsForAnalyticsSql`;
  - fetch the range `[cutoff(first month - 1), last.to)`;
  - bucket rows by `effectiveMonthOf`;
  - `range` in the response stays the calendar range;
  - add `effective_month: 'YYYY-MM'` to the response.
- **Modify** `myfin-api/src/services/transactionService.ts`: `TransactionFilter` gains `effectiveMonth?: YearMonth` and `excludeAdjustments?: boolean`. `structuredFilterSql` becomes async-free by taking an already-resolved `SalaryRule` on the filter (`salaryRule?: SalaryRule`). Callers resolve the rule first.
- **Modify** `myfin-api/src/controllers/transactionController.ts`: list and bulk filter accept `effective_month` (`YYYY-MM`). The controller resolves `salaryRuleFor(userId)`.
- **Web:**
  - Insights `buildTransactionsLink` keeps `month=`;
  - Transactions maps URL `month=` to API `effective_month=` instead of `date_from`/`date_to`, for the list and for bulk "select all matching";
  - rows that are late salary show a small chip "counted in <next month>". The list response gains `effective_month` per row, computed server-side with the rule.
- **Tests:** extend `insights.integration.test.ts` and `transactionFilters.integration.test.ts`.

**Interfaces:**
- **Consumes:** Task 1 `getFinancialProfile`.
- **Produces:** `countsForAnalyticsSql`, `SalaryRule`, `salaryRuleFor`, `effectiveMonthSql`, `effectiveMonthOf`, `TransactionFilter.effectiveMonth/salaryRule/excludeAdjustments`, and `effective_month` on list rows. Tasks 3, 4 and later phases use these.

- [ ] **Step 1: Failing tests.**
  - With the salary category set and cut-off 25:
    - a salary at 2026-10-24 23:59 IST counts in October income;
    - a salary at 2026-10-25 00:00 IST counts in November income, and October's does not include it;
    - `getFilteredTransactionsByForUser` with `effectiveMonth: Nov` includes it, and with `Oct` doesn't. The sums equal the Insights income for each.
  - An adjustment row (`is_adjustment: true`, type E) is excluded from Insights spending but still listed by an unfiltered Transactions query.
  - With no salary category, nothing shifts.
  - The trend still has 12 entries.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full integration and unit suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web changes; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: shared analytics rules — exclude adjustments, month-end salary counts next month`.

### Task 3: #8 Fixed vs flexible costs

**Files:**
- **Schema:** `categories.is_fixed Boolean @default(false)`, via migration `add_category_is_fixed`.
- **API:**
  - `categoryController.ts` create/update accept `is_fixed` / `new_is_fixed` (optional boolean);
  - `categoryService.createCategory` persists it;
  - backup restore passes `category.is_fixed ?? false`.
- **Shared filter:** `TransactionFilter.costKind?: 'fixed'|'flexible'|'unsorted'`.
  - `fixed` → `transactions.type='E' AND transactions.categories_category_id IN (SELECT category_id FROM categories WHERE is_fixed = 1)`;
  - `flexible` → `transactions.type='E' AND transactions.categories_category_id IN (SELECT … is_fixed = 0)`;
  - `unsorted` → `transactions.type='E' AND transactions.categories_category_id IS NULL`.

  The HTTP param `cost_kind` is added to both list and bulk filters.
- **Insights:**
  - response gains `cost_split: { fixed: number; flexible: number; unsorted: number }`;
  - `typical_cost_split: same | null` (same baseline and one-off rules as typical);
  - each `trend[]` entry gains `fixed`, `flexible`, `unsorted`.
- **Web:**
  - "Fixed cost" switch in the category add/edit dialog; a "Fixed" chip on the Categories list;
  - Insights `FixedFlexibleCard.tsx`: three figures with vs-typical deltas and drill-down links `cost=fixed|flexible` (+ `type=E`); unsorted uses `category=none&type=E`;
  - `TrendChart` toggle "Income vs spending" / "Fixed vs flexible";
  - Transactions URL `cost=` param + chip, passed to the list and bulk filters;
  - locale keys.
- **Tests:** a new `myfin-api/__tests__/integration/fixedCosts.integration.test.ts` (reuse the insights seed pattern).

- [ ] **Step 1: Failing tests.** Seed Jul–Oct as in the insights test, with Family and Insurance marked fixed. Then assert:
  - **October `cost_split`:** fixed 10,500; flexible 550; unsorted 230.
  - **`typical_cost_split`:** fixed 10,000 (insurance one-off excluded); flexible 450; unsorted 70/3.
  - **October trend entry:** fixed 10,500.
  - **Drill-down:** sums for `costKind` fixed/flexible/unsorted with October's effective month equal those figures.
  - **Categories:** create/update round-trips `is_fixed`.
  - **Restore:** of an old backup without `is_fixed` gives false.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the API.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: fixed vs flexible costs (#8)`.

### Task 4: #11 Balance check and reconciliation

**Files:**
- **Schema:** model `balance_checks`:
  - `check_id BigInt @id @default(autoincrement())`;
  - `accounts_account_id BigInt` (FK accounts, cascade);
  - `checked_at BigInt`;
  - `real_balance BigInt` (cents, as entered);
  - `myfin_balance BigInt` (cents, comparable form);
  - `result String @db.VarChar(16)` (`matched|adjusted|open`);
  - `adjustment_transaction_id BigInt?`.

  Migration `add_balance_checks`.
- **Create** `myfin-api/src/services/balanceCheckService.ts`:
  - `listForBalanceCheck(userId)` → active accounts `[{account_id, name, type, myfin_balance, last_check: {checked_at, result, gap}|null}]`, where `myfin_balance` is in comparable form (`-current_balance` for CREAC);
  - `recordCheck(userId, accountId, realBalance)` → `{gap, result}`, storing `matched` when |gap| < 0.01, else `open`;
  - `writeOff(userId, accountId, realBalance)`:
    - creates the adjustment transaction per Global Constraints via `TransactionService.createTransaction` (so balances recalculate);
    - auto-creates the "Balance adjustment" category if missing;
    - stores `adjusted`;
    - returns the new transaction id.
  - Ownership is checked on every call.
- **Controller and routes** under `/accounts`:
  - `GET /balance-check`;
  - `POST /balance-check` `{account_id, real_balance}`;
  - `POST /balance-check/write-off` `{account_id, real_balance}`.
- **Backup/restore:** include `balance_checks` (remap account ids; the adjustment transaction id is set to null on restore). Add it to `resetDb` and the wipe.
- **Web:**
  - a new page `myfin-web/src/features/accounts/BalanceCheck.tsx` at route `/accounts/balance-check`, linked from the Accounts page header. One row per account: MyFin balance, an input for the real balance, the live gap ("matches ✓" / "off by ₹X, MyFin higher|lower"), and a "Save check" button;
  - for a mismatch: "Add missing transaction" opens the existing `AddEditTransactionDialog` with the account preselected and amount = |gap|, type expense if MyFin is higher, income if lower. The gap refreshes after save;
  - "Write it off" asks for confirmation, then calls write-off;
  - the Accounts page shows "Checked <date> · <result>" per account.
- **Tests:** `myfin-api/__tests__/integration/balanceCheck.integration.test.ts`.

- [ ] **Step 1: Failing tests.**
  - **Bank, matching:** a checking account with balance 1,000 and real 1,000 → matched.
  - **Bank, write-off:** real 900 → open, gap −100. Write-off creates an E 100 adjustment, the balance becomes 900, `is_adjustment = true`, and the category "Balance adjustment" exists.
  - **Credit card:** MyFin owes 13,231 (`current_balance` −13,231) and real owed is 13,000. Write-off makes `-current_balance == 13,000`, via an I adjustment of 231.
  - **Insights:** the adjustment is excluded from spending and income.
  - **Ownership:** another user's account gives 401.
  - **Restore:** `balance_checks` restore with remapped account ids.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: balance check and reconciliation (#11)`.

### Task 5: #22 Data freshness per account

**Files:**
- **Schema:** `accounts.stale_after_days Int?`, via migration `add_account_stale_after_days`.
- **API:**
  - account create/update accept `stale_after_days` (null | 0..365);
  - `GET /accounts` rows gain `last_transaction_at: number|null`, `last_balance_check_at: number|null`, `stale_after_days_effective: number|null` (null = never) and `freshness: 'fresh'|'stale'|'never'|'inactive'`, plus `days_since_last_transaction: number|null`;
  - put the computation in `myfin-api/src/services/accountFreshnessService.ts` with `freshnessFor(account, lastTrxAt, nowEpoch)`, unit-testable;
  - backup restore passes `stale_after_days ?? null`.
- **Web:**
  - account dialog field "Mark stale after N days" (blank = default for type, 0 = never);
  - a badge on the Accounts page (Fresh ✓ / Stale ⚠️ "N days");
  - Dashboard card `NeedsUpdatingCard.tsx` listing stale accounts with links to `/transactions/import`, hidden when none;
  - locale keys.
- **Tests:**
  - **unit** (`accountFreshness.test.ts`): type defaults; 0 = never; null = default; inactive → inactive; exactly at the limit → fresh; limit + 1 day → stale; no transactions → stale for active accounts;
  - **integration:** `GET /accounts` fields for one fresh and one stale account.

- [ ] **Step 1:** Write the failing unit and integration tests.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: data freshness per account (#22)`.

### Task 6: #20 Encrypted backups to a synced folder

**Files:**
- **Create** `myfin-api/src/utils/backupCrypto.ts`:
  - `encryptBackup(json: string, password: string): Buffer`;
  - `decryptBackup(buf: Buffer, password: string): string`, which throws `APIError.badRequest('Wrong password or corrupted backup')` on a bad tag, magic or version.
- **Create** `myfin-api/src/services/folderBackupService.ts`:
  - `status()` → `{available: boolean, reason?: string}` (`BACKUP_DIR` unset, missing or not writable);
  - `list()` → `[{file, created_at, size}]`, newest first, with only `myfin-backup-*.myfin` names;
  - `create(userId, password)` → `{file}`: writes atomically (temp file then rename) and prunes to the newest 30;
  - `restore(userId, file, password)`: `file` must be a bare name in the listing (no path separators); decrypts and parses before calling `UserService.restoreUser`.
- **Controller and routes** under `/user`:
  - `GET /folder-backups` → `{available, reason?, backups: [...]}`;
  - `POST /folder-backups` `{password}`;
  - `POST /folder-backups/restore` `{file, password}`.

  The password must be ≥ 8 characters.
- **Config:**
  - add a `BACKUP_DIR` line to `myfin-api/.env.example`;
  - add a commented volume mapping example for `BACKUP_DIR` to the root `docker-compose.yml`;
  - add README notes on Google Drive for desktop paths (macOS `~/Library/CloudStorage/GoogleDrive-<you>/My Drive/MyFin backups`, Windows `G:\My Drive\MyFin backups`) and the rclone/Dropbox alternatives on Linux.
- **Web:** in `Profile.tsx` → a `FolderBackups.tsx` section:
  - "Back up now" asks for a password twice, with the warning "a forgotten password means this backup can't be restored";
  - a list of backups with Restore (password + "replaces all current data" confirmation);
  - disabled with the reason when unavailable;
  - locale keys.
- **Tests:**
  - **unit** (`backupCrypto.test.ts`): round-trip; a wrong password throws; a flipped ciphertext byte throws; a wrong magic throws.
  - **integration** (`folderBackup.integration.test.ts`), using a temp dir set as `process.env.BACKUP_DIR`:
    - create, list, restore round-trip;
    - a wrong password on restore → 400 and the data unchanged;
    - 31 creates leave 30 files;
    - a path-traversal file name → 400;
    - an unset `BACKUP_DIR` → `available:false`.

- [ ] **Step 1:** Write the failing unit and integration tests.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the suites and `tsc`. Expected: PASS.
- [ ] **Step 5:** Web; `tsc`, `build`, `biome`.
- [ ] **Step 6: Commit** `feat: encrypted backups to a synced folder (#20)`.
