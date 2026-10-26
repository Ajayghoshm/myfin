# PhonePe Statement Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user upload a PhonePe statement CSV (repeatedly, with overlapping date ranges) and import only the new rows as correctly typed transactions on the right MyFin accounts, after a review screen.

**Architecture:** A pure parser/classifier module in `myfin-api` turns the CSV into rows with an `external_id`. A service checks those IDs against existing transactions, resolves payment instruments to accounts through a new per-user mapping table, and runs each row through the existing rule engine. Two new endpoints feed a new PhonePe branch of the existing web import wizard. That branch goes Upload → Map accounts (skipped when everything is known) → existing review table → Done. The existing bulk-save endpoint is extended to store `external_id` and skip duplicates.

**Tech Stack:** myfin-api: Node, Express 5, Prisma 6 (MySQL), joi, dayjs, vitest. myfin-web: React, MUI, react-query, i18next, Vite.

**Spec:** `docs/superpowers/specs/2026-10-26-phonepe-statement-import-design.md`

## Global Constraints

- External ID format: `phonepe:<Transaction ID>:<DEBIT|CREDIT>`. Column `transactions.external_id VARCHAR(64) NULL`, indexed.
- Mapping table `import_instrument_mappings`, unique on (`user_id`, `source`, `instrument_key`), `source = 'phonepe'`, FK to accounts with cascade delete.
- Amounts stay decimal rupees until `createTransaction` (which calls `convertFloatToBigInteger`). Never multiply by 100 elsewhere.
- Dates: `Date` + `Time` columns are interpreted in `Asia/Kolkata`. Store a unix timestamp in seconds (as `DateTimeUtils.getCurrentUnixTimestamp()` does).
- Description: trim and collapse runs of whitespace to one space. Keep emoji.
- Instrument key: the instrument column with its `Paid by ` / `Credited to ` prefix stripped.
- Transfers: details exactly `Add money UPI Lite` → from instrument to `UPI Lite`. Details starting with `Credit card bill paid ` → from instrument to the masked card number after the prefix. Other `CREDIT` rows → income. Other `DEBIT` rows → expense.
- Type codes: `MYFIN.TRX_TYPES` — `I` income, `E` expense, `T` transfer.
- Nothing is saved without the review step. Re-uploading never creates duplicates.
- Paste-based import must keep working unchanged.
- Never commit `.env` files, `.idea/`, `node_modules/`, or the root `docker-compose.yml` SMTP change. Never push without the user's go-ahead.

## Review Focus

1. **Statement exported from a different PhonePe version, or header text with extra spaces or a BOM.** Find the header row by trimming and removing a leading `﻿` before comparing. A file with no header row gets a 400 with a clear message, never a 500. (Test in Task 2.)
2. **Row whose instrument was mapped to an account that has since been deleted.** The key is treated as unmapped and the mapping step appears again. (Test in Task 3.)
3. **The same file uploaded in two tabs, or Import double-clicked.** The save step skips rows whose `external_id` already exists, inside the same DB transaction. (Test in Task 4.)
4. **Statement larger than Express's default 100 KB JSON body limit** (about 600+ rows). The PhonePe routes accept up to 5 MB. (Test in Task 3.)
5. **Mapping or categorize request naming another user's account.** Reject it with notAuthorized. (Test in Task 3.)

---

### Task 1: Put the restructured codebase on a branch in the user's GitHub repo

**Files:**
- Outer repo `/Users/ajayghoshm/myfin` (remote `github.com/Ajayghoshm/myfin`).
- Move `/Users/ajayghoshm/myfin/myfin-api/.git` to `/Users/ajayghoshm/myfin-api.git.bak`. Move it; do not delete it.

- [ ] **Step 1:** In the outer repo, `git checkout -b feature/phonepe-import`.
- [ ] **Step 2:** `mv myfin-api/.git ../myfin-api.git.bak`, then `ls -a myfin-api` shows no `.git`.
- [ ] **Step 3:** Add a root `.gitignore` with `node_modules`, `.env`, `.idea`, `dist`, `.DS_Store`. Keep `!.env.example` and `!.env.test` (the test env holds only local test DB credentials and is tracked upstream).
- [ ] **Step 4:** Stage the move: `git add -A -- . ':!docker-compose.yml'`. Then `git status --short | grep -E '\.env$|\.idea|node_modules|docker-compose.yml$'` should list only `docker-compose.yml` as unstaged-modified. Also confirm `myfin-api/docker-compose.yml` has no secrets (`git diff --cached myfin-api/docker-compose.yml`).
- [ ] **Step 5:** Commit: `chore: move frontend to myfin-web and vendor myfin-api`. Do not push.

### Task 2: PhonePe CSV parser and classifier (pure functions)

**Files:**
- Create: `myfin-api/src/services/importers/phonePeImporter.ts`
- Create: `myfin-api/__tests__/unit/fixtures/phonepe-statement.csv` (anonymised sample: keep the header lines, footer and disclaimer. Include at least one row of each kind: Paid to, Requested by, Received from (CREDIT), Add money UPI Lite, Credit card bill paid, a `Sept` date, a decimal amount, double-spaced and trailing-space names, an emoji name.)
- Test: `myfin-api/__tests__/unit/phonePeImporter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PhonePeRow = {
    externalId: string;          // `phonepe:${txnId}:${direction}`
    date: number;                // unix seconds, Asia/Kolkata
    description: string;         // cleaned
    amount: number;              // decimal rupees, positive
    direction: 'DEBIT' | 'CREDIT';
    instrumentKey: string;       // e.g. 'XXXXXXXXXXX3300', 'UPI Lite'
  };
  export type ClassifiedPhonePeRow = PhonePeRow & {
    type: 'I' | 'E' | 'T';
    fromKey: string | null;
    toKey: string | null;
  };
  export function parsePhonePeCsv(text: string): PhonePeRow[];   // throws APIError.badRequest if header row missing
  export function classifyPhonePeRow(row: PhonePeRow): ClassifiedPhonePeRow;
  export function instrumentKeysOf(rows: ClassifiedPhonePeRow[]): string[]; // distinct non-null fromKey/toKey, first-seen order
  ```

- [ ] **Step 1: Write failing tests.**
  - `parsePhonePeCsv(fixture)` returns one entry per data row. It ignores the `Transaction Statement for…` and `Duration` lines and the footer.
  - The row `"Oct 26, 2026","01:46 pm","Paid to SWIGGY","T2610261346425001911421",…,"DEBIT","Paid by XXXXXXXXXXX3300","121"` →
    - `externalId` is `'phonepe:T2610261346425001911421:DEBIT'`
    - `amount` is `121`
    - `instrumentKey` is `'XXXXXXXXXXX3300'`
    - `description` is `'Paid to SWIGGY'`
    - `date` is `dayjs.tz('2026-10-26 13:46', 'Asia/Kolkata').unix()`
  - `"Sept 30, 2026","09:33 pm"` parses to 30 Sep 2026, 21:33 IST.
  - `"12:48 am"` → hour 0.
  - `"4837.55"` → `4837.55` exactly.
  - `"Paid to PERSON  B"` → `'Paid to PERSON B'`.
  - `"Paid to VEG BASKET "` → `'Paid to VEG BASKET'`.
  - `"Paid to PERSON C 🌛"` keeps the emoji.
  - `"Paid by UPI Lite"` → `'UPI Lite'`.
  - `"Credited to XXXXXXXXXXX3300"` → `'XXXXXXXXXXX3300'`.
  - Text with a leading BOM still parses.
  - `'foo,bar\n1,2'` throws an `APIError` with code 400.
  - `classifyPhonePeRow`:
    - `Add money UPI Lite` / DEBIT / `XXXXXXXXXXX3300` → `{type:'T', fromKey:'XXXXXXXXXXX3300', toKey:'UPI Lite'}`.
    - `Credit card bill paid XXXXXXXXXXXX2001` → `{type:'T', fromKey:'XXXXXXXXXXX3300', toKey:'XXXXXXXXXXXX2001'}`.
    - CREDIT → `{type:'I', fromKey:null, toKey:instrument}`.
    - `Requested by PERSON A` / DEBIT → `{type:'E', fromKey:instrument, toKey:null}`.
  - `instrumentKeysOf` returns distinct keys, including transfer targets.
- [ ] **Step 2:** `npm run test:unit:run -- phonePeImporter`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Use a small quote-aware line parser: fields are `"`-quoted and may contain commas. Use dayjs with the `utc`, `timezone` and `customParseFormat` plugins (already in the `dayjs` dependency). Before parsing, replace `Sept` with `Sep`, then use the format `MMM DD, YYYY hh:mm a`. A data row must have 8 fields and a parseable date. Stop collecting rows at the first non-blank line after the header that is not a data row.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): add PhonePe statement parser and classifier`.

### Task 3: Schema, mapping storage, preview and categorize endpoints

**Files:**
- Modify: `myfin-api/prisma/schema.prisma`:
  - add `external_id String? @db.VarChar(64)` and `@@index([external_id])` to `transactions`;
  - add model `import_instrument_mappings { mapping_id BigInt @id @default(autoincrement()), users_user_id BigInt, source String @db.VarChar(32), instrument_key String @db.VarChar(64), accounts_account_id BigInt, @@unique([users_user_id, source, instrument_key]) }`, with relations to `users` and to `accounts` (`onDelete: Cascade`);
  - add the back-relations on `users` and `accounts`.
- Create: the migration via `npm run db:migrate -- --name add_phonepe_import` (directory `prisma/migrations/<ts>_add_phonepe_import`).
- Modify: `myfin-api/__tests__/integration/utils/resetDb.ts`: add `prisma.import_instrument_mappings.deleteMany()` before `accounts.deleteMany()`.
- Modify: `myfin-api/src/services/userService.ts` (the user-data wipe around lines 328–395): delete the user's mappings before accounts.
- Create: `myfin-api/src/services/phonePeImportService.ts`.
- Modify: `myfin-api/src/controllers/transactionController.ts`: add `importPhonePePreview` and `importPhonePeCategorize`, with joi schemas, following the `importTransactionsStep1` pattern.
- Modify: `myfin-api/src/routes/router.ts`: add `trxRoutes.post("/import/phonepe/preview", …)` and `trxRoutes.post("/import/phonepe/categorize", …)`.
- Modify: `myfin-api/src/app.ts`: before the generic `app.use("/", express.json())`, add `app.use("/trxs/import", express.json({ limit: '5mb' }))`. Check the `trxs` route prefix in `router.ts`.
- Test: `myfin-api/__tests__/integration/phonePeImport.integration.test.ts`

**Interfaces:**
- Consumes: `parsePhonePeCsv`, `classifyPhonePeRow`, `instrumentKeysOf` (Task 2), and `TransactionService.autoCategorizeTransaction` (existing).
- Produces, in `phonePeImportService.ts`:
  ```ts
  export function getExistingExternalIds(userId: bigint, ids: string[], dbClient?): Promise<Set<string>>;
  //   transactions whose external_id ∈ ids AND (from or to account belongs to userId)
  export type PhonePePreview = {
    instruments: Array<{ key: string; sample_description: string; account_id: bigint | null }>;
    total_rows: number; duplicate_rows: number; new_rows: number;
  };
  export function previewPhonePeImport(userId: bigint, csv: string): Promise<PhonePePreview>;
  //   instruments: only keys used by NEW rows; account_id null when unmapped or the mapped account no longer belongs to the user
  //   a row repeating an earlier row's externalId within the same file counts as a duplicate (categorize drops it too)
  export function categorizePhonePeImport(
    userId: bigint, csv: string, mappings: Array<{ key: string; account_id: bigint }>
  ): Promise<{ fillData: Array<RuleInstructions & { external_id: string }>; categories; entities; accounts; duplicate_rows: number }>;
  //   checks every account_id belongs to user (else APIError.notAuthorized), upserts mappings,
  //   throws APIError.badRequest if any key of a new row stays unmapped,
  //   then autoCategorizeTransaction(userId, description, amount, type, fromAccount, toAccount, date, caches) per new row;
  //   categories/entities/accounts in the same shape importTransactionsStep1 returns.
  ```
  - HTTP: `POST /trxs/import/phonepe/preview` with body `{ csv: string }` → `PhonePePreview`. `POST /trxs/import/phonepe/categorize` with body `{ csv: string, mappings: string }` (JSON-encoded, like `trx_list`) → the categorize result.

- [ ] **Step 1:** Edit the schema and run `npm run db:migrate -- --name add_phonepe_import`. Expected: the migration is created and `prisma generate` succeeds.
- [ ] **Step 2: Write failing integration tests.** The setup creates a user and accounts `bank3300`, `upiLite` and `card2001`.
  - `previewPhonePeImport(fixture)` → `duplicate_rows` is 0, `new_rows` equals the row count, and every instrument has `account_id: null`.
  - `categorizePhonePeImport` with all keys mapped:
    - The UPI Lite top-up row has `selectedAccountFromID = bank3300` and `selectedAccountToID = upiLite`, with type `T`.
    - The SWIGGY row has type `E`, from `bank3300`, amount `121`.
    - The CREDIT row has type `I`, to `bank3300`.
    - Every item has an `external_id`.
  - After a categorize call, `previewPhonePeImport` shows the saved `account_id` for each key.
  - After deleting `card2001` (via `AccountService`), that key shows `account_id: null`.
  - `categorizePhonePeImport` with an account of a second user → rejects with code 403/401 (whatever `notAuthorized` uses).
  - `categorizePhonePeImport` with one key missing → rejects with 400.
  - Through the controller or supertest if available, otherwise by asserting the `app.ts` middleware order: a 300 KB CSV body is accepted.
- [ ] **Step 3:** `npm run test:integration phonePeImport`. Expected: FAIL.
- [ ] **Step 4:** Implement the service, controller, routes and body limit as specified above.
- [ ] **Step 5:** `npm run test:integration phonePeImport`, then `npm run test:unit:run`. Expected: all PASS.
- [ ] **Step 6:** Commit: `feat(api): PhonePe import preview/categorize with instrument mappings`.

### Task 4: Save with `external_id`, skip duplicates, report counts

**Files:**
- Modify: `myfin-api/src/services/transactionService.ts`:
  - `CreateTransactionType` gains `external_id?: string`, and `createTransaction` writes it;
  - `createTransactionsInBulk` returns `{ imported: number; skipped: number }`. Before the loop it calls `getExistingExternalIds` with the list's non-empty `external_id`s, using `prismaTx`, and skips those rows plus repeats within the list.
- Modify: `myfin-api/src/controllers/transactionController.ts` `importTransactionsStep2`: respond `res.json({ imported, skipped })`.
- Test: extend `myfin-api/__tests__/integration/phonePeImport.integration.test.ts`.

**Interfaces:**
- Consumes: `getExistingExternalIds` (Task 3).
- Produces: `POST /trxs/import/step2` → `{ imported: number; skipped: number }`. Each `trx_list` item may carry `external_id`.

- [ ] **Step 1: Write failing tests.**
  - Categorize the fixture, map it into `CreateTransactionType[]`, and call `createTransactionsInBulk`. `imported` equals the row count and `skipped` is 0. Account balances move as expected for the top-up row: bank3300 down 4998, upiLite up 4998.
  - Calling it again with the same list → `{imported: 0, skipped: N}`.
  - `previewPhonePeImport` on the same fixture → `new_rows: 0`.
  - A fixture containing the first file's rows plus 2 new rows → `new_rows: 2`.
  - Items with no `external_id` (the paste path) are always imported.
- [ ] **Step 2:** `npm run test:integration phonePeImport`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement as specified.
- [ ] **Step 4:** `npm run test:integration` (whole suite, to confirm the paste path and other tests still pass). Expected: PASS.
- [ ] **Step 5:** Commit: `feat(api): store external_id on import and skip duplicates`.

### Task 5: Web — upload, mapping step and wizard branch

myfin-web has no test runner. Each step is verified with `npm run build` (tsc + vite) and a manual run against the API.

**Files:**
- Modify: `myfin-web/src/services/trx/trxServices.ts`: add the types `PhonePePreviewResponse`, `PhonePeCategorizeRequest {csv: string; mappings: {key: string; account_id: bigint}[]}`, and `PhonePeCategorizeResponse = ImportTransactionsStep1Response & { fillData: (RuleInstructions & {external_id: string})[]; duplicate_rows: number }`. Add `importPhonePePreview(csv)` and `importPhonePeCategorize(req)` (mappings JSON-stringified, like `trx_list`). Add `external_id?: string` to `AddTransactionRequest`. The `importTransactionsStep2` response type becomes `{ imported: number; skipped: number }`.
- Modify: `myfin-web/src/services/trx/trxHooks.ts`: add `useImportPhonePePreview()` and `useImportPhonePeCategorize()` mutations, following `useImportTransactionsStep1`.
- Modify: `myfin-web/src/features/transactions/import/ImportTrxStep0.tsx`: add an **Upload PhonePe statement** button (hidden `<input type="file" accept=".csv">`). It reads the file with `File.text()` and calls a new prop `onPhonePeFile(csv: string)`.
- Create: `myfin-web/src/features/transactions/import/ImportTrxPhonePeMapping.tsx`, with props `{ csv: string; preview: PhonePePreviewResponse; onNext: (result: ImportTrxStep1Result) => void }`.
  - It renders one row per instrument: the key, `sample_description`, and an account `Autocomplete` pre-filled from `account_id`. Account options come from `useImportTransactionsStep0()`.
  - Continue is disabled until every row has an account. On Continue it calls categorize and passes the result to `onNext`.
- Modify: `myfin-web/src/features/transactions/import/ImportTransactions.tsx`: add `flow: 'paste' | 'phonepe'` state.
  - PhonePe steps: `[step0Label, phonePeMappingLabel, step2Label, step3Label]`.
  - On file: call preview.
    - If `new_rows === 0`, show the snackbar `importTransactions.noNewTransactions` and stay on step 0.
    - Else, if every instrument has `account_id`, call categorize directly and go to step 2.
    - Else go to the mapping step.
  - The mapping step stays clickable in the stepper when the PhonePe flow is active.
- Modify: `myfin-web/public/locales/en/translation.json` and `pt/translation.json`, keys under `importTransactions`:
  - `uploadPhonePe`: "Upload PhonePe statement"
  - `phonePeMappingLabel`: "Match accounts"
  - `phonePeMappingText`: "Choose which MyFin account each PhonePe payment method belongs to. We'll remember it for next time."
  - `noNewTransactions`: "No new transactions in this statement."
  - `skippedDuplicates`: "{{count}} transactions were already imported and have been skipped."
  - `invalidPhonePeFile`: "This doesn't look like a PhonePe statement CSV."
  - `step3TextMulti`: "{{count}} new transactions have successfully been imported. Good job!"
  - Add Portuguese translations of each.

- [ ] **Step 1:** Add the services, hooks and types. Run `npm run build`. Expected: success.
- [ ] **Step 2:** Add the Step0 upload button, the mapping component and the wizard branch. Show a 400 from preview as the `invalidPhonePeFile` snackbar. Run `npm run build`. Expected: success.
- [ ] **Step 3:** Commit: `feat(web): PhonePe upload and account matching step`.

### Task 6: Web — review and done steps for the multi-account flow

**Files:**
- Modify: `myfin-web/src/features/transactions/import/ImportTrxStep1.tsx`: make `ImportTrxStep1Result.selectedAccountId` optional (`selectedAccountId?: bigint`), and add `duplicateRows?: number`.
- Modify: `myfin-web/src/features/transactions/import/ImportTrxStep2.tsx`:
  - `ImportedTrx` gains `externalId?: string`, filled from `fillData[i].external_id`, and is sent as `external_id` in `importTransactions()`.
  - When `selectedAccountId` is undefined, omit the confirmation dialog's `alert` (the balance line).
  - When `duplicateRows > 0`, show `importTransactions.skippedDuplicates` above the table.
  - Call `onNext` with `nrOfTrxImported` from the response's `imported`, not from `filteredTransactions.length`.
- Modify: `myfin-web/src/features/transactions/import/ImportTrxStep3.tsx`: when `accountName` is empty, use `importTransactions.step3TextMulti`.

**Interfaces:**
- Consumes: `PhonePeCategorizeResponse` (Task 5) and the step2 response `{imported, skipped}` (Task 4).

- [ ] **Step 1:** Implement as specified. Run `npm run build`. Expected: success.
- [ ] **Step 2: Manual check.** Run the API (`npm run start:dev` in myfin-api) and the web app (`npm run dev` in myfin-web), against a local DB with migrations applied (`npm run db:deploy`).
  1. Upload the fixture. The mapping step shows all keys. Map them, review, import. The done screen shows the count.
  2. Upload the same file again → "No new transactions".
  3. Upload a file with 2 extra rows → it skips straight to review with 2 rows and the skipped notice.
  4. The paste flow still imports into a single account, with the balance line shown.
- [ ] **Step 3:** Commit: `feat(web): multi-account review and done for PhonePe import`.
