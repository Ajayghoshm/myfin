# PhonePe statement import — design

Date: 2026-10-26
Status: draft, builder-checked, awaiting user approval

## Intent

The user pays almost everything through PhonePe and tracks each bank account, card and UPI Lite as a separate MyFin account. Every month they download the PhonePe transaction statement as a CSV. Today, getting those rows into MyFin means copying and pasting into the generic import wizard, which only handles one account per import. A PhonePe statement mixes five or more payment sources and includes transfers between the user's own accounts.

The goal: upload the PhonePe CSV once a month, check a review screen, and have every row land as a correctly typed transaction (expense, income or transfer) on the right account, with no duplicates.

## Goals

- In the Import Transactions page, add an **Upload PhonePe statement** option next to the existing paste flow.
- Parse the PhonePe CSV format (sample below).
- Map each payment instrument in the statement ("Paid by XXXXXXXXXXX3300", "UPI Lite", "Paid by 653001XXXXXXXX73", …) to a MyFin account. Remember the mapping per user so the next upload doesn't ask again.
- Classify each row as expense, income or transfer (rules below).
- Run every row through the user's existing MyFin rules (entity, category, essential), as the current import does.
- Show the existing review table (step 2 of the import wizard) before anything is saved.
- Never import the same PhonePe transaction twice, across files and within a file.
- Support repeated, overlapping uploads. The user may upload a statement several times a month (e.g. 1–10 Oct, then 1–20 Oct, then the full month). Each upload imports only the rows not yet in MyFin. If nothing is new, the user sees "No new transactions" instead of an empty review table.

## Non-goals

- Google Drive or any automatic fetching. The user decided on a manual upload.
- PDF statements, other banks and other UPI apps. The parser should sit behind a small interface so another format can be added later, but only PhonePe is built.
- New categorisation logic beyond existing MyFin rules.
- A separate settings screen for managing instrument mappings. The mapping step itself is where mappings are reviewed and changed (see below).

## Anti-goals

- Anything saved without the user seeing the review screen first.
- Duplicate transactions after re-uploading an overlapping or identical statement.
- Self-transfers ("Add money UPI Lite", "Credit card bill paid …") recorded as spending, which would inflate expenses.
- Breaking the existing paste-based import.

## Input format

A CSV exported from the PhonePe app. Structure:

```
Transaction Statement for 9999999999
Duration,"26 Sept, 2026 - 26 Oct, 2026"

Date,Time,Transaction Details,Transaction ID,UTR,Transaction Type,Credit/debit instrument,Amount
"Oct 26, 2026","01:46 pm","Paid to SWIGGY","T2610261346000000000001","100000000001","DEBIT","Paid by XXXXXXXXXXX3300","121"
"Oct 14, 2026","02:42 pm","Received from PERSON A","T2610141442000000000002","100000000002","CREDIT","Credited to XXXXXXXXXXX3300","190"
"Oct 08, 2026","01:03 pm","Add money UPI Lite","W2610081303000000000003","100000000003","DEBIT","Paid by XXXXXXXXXXX3300","4998"
"Oct 12, 2026","05:15 pm","Credit card bill paid XXXXXXXXXXXX2001","NB2610…","100000000004","DEBIT","Paid by XXXXXXXXXXX3300","354"
...

This is an automatically generated statement. ...
Disclaimer : ...
```

Parsing notes:

- Skip everything before the header row (`Date,Time,Transaction Details,…`) and every line after the data that doesn't parse as a data row (the footer and disclaimer).
- Month names include `Sept` (four letters) as well as the usual three-letter forms.
- Amounts are decimal rupees with no thousands separator (`4837.55`, `121`). Keep them as decimal numbers all the way to save. `createTransaction` already converts to the stored integer form (`convertFloatToBigInteger`), so converting in the parser would make amounts 100x too large.
- Descriptions can have trailing or double spaces (`"VEG BASKET "`, `"PERSON  B"`) and emoji (`"PERSON C 🌛"`). Trim the description and collapse repeated spaces; keep the emoji.
- Instrument column: strip the `Paid by ` / `Credited to ` prefix. What remains (`XXXXXXXXXXX3300`, `UPI Lite`, `653001XXXXXXXX73`) is the **instrument key**.
- Transaction IDs have several prefixes (`T`, `D`, `NB`, `W`, `OLEX`, `R…`). Treat them as opaque strings.
- Date/time: combine Date and Time and interpret them in Asia/Kolkata (my call; PhonePe statements are IST).
- A file that doesn't contain the expected header row is rejected with a clear error.

## Classification rules

Applied in this order for each row:

1. **Top-up to UPI Lite.** `Transaction Type = DEBIT` and details equal `Add money UPI Lite` → **transfer** from mapped(instrument) to mapped(`UPI Lite`).
2. **Credit card bill.** `DEBIT` and details start with `Credit card bill paid ` → **transfer** from mapped(instrument) to mapped(card key). The card key is the masked number after the prefix (e.g. `XXXXXXXXXXXX2001`) and goes through the same instrument mapping as any other key. It won't necessarily match the masking used in "Paid by" for the same card, so the user may map two keys to one account. That's expected.
3. **CREDIT** → **income** into mapped(instrument).
4. **Any other DEBIT** → **expense** from mapped(instrument). This includes "Paid to …", "Requested by …" (the user paid a collect request), "Electricity bill paid …" and "Payment to NETFLIX".

In the review screen every row stays editable as it is today (accounts, entity, category, description, essential, selected), so a misclassified row can be fixed before saving. The table has no type column; type follows from which accounts are set.

Payments between two of the user's own accounts made through PhonePe (a "Paid to <own name>" DEBIT plus a matching "Received from <own name>" CREDIT) are not detected. They come in as an expense and an income, and the user fixes or deselects them in review. (My call: none appear in the sample, and pairing rows adds a lot of complexity.)

## Flow

1. **Upload.** On the Import Transactions page, the user picks **Upload PhonePe statement** and selects the CSV. The browser reads it as text and sends it to the API, so no multipart upload handling is needed.
2. **Map instruments.** The API parses the file and returns:
   - the distinct instrument keys in the file (including card keys from rule 2 and `UPI Lite` when rule 1 applies), each pre-filled with its saved account mapping if one exists;
   - a count of rows already imported, which will be skipped.

   The web app shows one row per instrument key, with an account dropdown and a sample description to help the user recognise it. Saved mappings are pre-filled but can be changed. When every key is mapped, the user continues and the mappings are saved, replacing any old mapping for that key.

   If every key in the file already has a saved mapping, this step is skipped and the user goes straight to review, because uploads happen often. The user can still click back to the mapping step in the stepper to change a mapping. Only instrument keys that appear in non-duplicate rows count. (My call.)
3. **Auto-categorise.** The API classifies each non-duplicate row, resolves the accounts through the mappings, and runs each row through the existing rule engine (`autoCategorizeTransaction`) with the correct from/to accounts for that row. It returns data in the same shape `ImportTrxStep2` already consumes (`fillData`, `categories`, `entities`, `accounts`), plus each row's PhonePe transaction ID.
4. **Review.** This reuses the existing `ImportTrxStep2` table, which already supports per-row accounts. Each row carries its external ID through to the save call. It needs these changes:
   - The projected balance and the confirmation dialog currently assume a single `selectedAccountId`. On the PhonePe path, show the projected balance for each affected account, or drop the balance line.
   - Show the "N already imported, skipped" notice.
5. **Save.** This uses the existing bulk-create path, extended to store the external ID and to skip, rather than fail on, any row whose external ID already exists for this user. That handles a re-upload in another tab, or a double-click. The step-2 response currently returns a plain string. Change it to `{ imported, skipped }`, keeping the paste flow working (its web code ignores the response body today).
6. **Done.** The existing step 3 screen, with a message adjusted for multiple accounts. Today it names one account.

## Data changes (myfin-api, Prisma migration)

- `transactions.external_id`: nullable `VARCHAR(64)`, indexed. Stored namespaced as `phonepe:<Transaction ID>:<DEBIT|CREDIT>`, so other sources can be added later without collisions, and a refund or reversal that reuses the original Transaction ID isn't dropped as a duplicate. (My call: it costs nothing and is hard to change once data exists.) Duplicate check: an existing transaction with the same `external_id` whose from or to account belongs to the user. (`transactions` has no `user_id`; ownership goes through accounts, as elsewhere in the codebase.)
- New table `import_instrument_mappings`: `user_id` (FK users), `source` (`'phonepe'`), `instrument_key` (varchar), `account_id` (FK accounts, cascade delete), unique on (`user_id`, `source`, `instrument_key`). If the mapped account was deleted, the key is treated as unmapped.

## API (myfin-api)

New routes under the existing `trxRoutes`, following the controller → service → joi validation pattern of `importTransactionsStep0/1/2`:

- `POST /trxs/import/phonepe/parse` — body `{ csv: string }` → `{ instruments: [{ key, sample_description, account_id | null }], total_rows, duplicate_rows }`.
- `POST /trxs/import/phonepe/categorize` — body `{ csv: string, mappings: [{ key, account_id }] }` → saves the mappings (after checking each account belongs to the user), then returns the step-2 payload. The CSV is sent again rather than cached on the server, so the API stays stateless.
- Existing `POST /trxs/import/step2` — accepts an optional `external_id` per transaction, stores it, and skips duplicates as described above.

The parser is a pure function, `parsePhonePeCsv(text) → ParsedRow[]`, in its own module (e.g. `src/services/importers/phonePeImporter.ts`), with classification as a separate pure function so both can be unit-tested without a database.

## Web (myfin-web)

- `ImportTrxStep0`: add the upload option (file input accepting `.csv`) next to the existing paste flow.
- New step component for instrument mapping, used only on the PhonePe path.
- `ImportTransactions.tsx`: branch the stepper. Paste path: steps as today. PhonePe path: Upload → Map accounts → Review → Done.
- `ImportTrxStep2`: carry `external_id` through to the save request; show "N already imported, skipped" when N > 0.
- New hooks in `services/trx/` following the existing `useImportTransactionsStep*` pattern.
- New strings in `public/locales/en/translation.json` and `public/locales/pt/translation.json`.

## Testing

- Unit (vitest, `myfin-api/__tests__/unit`): the parser against an anonymised fixture based on the sample, covering header and footer skipping, `Sept`, decimals, whitespace, emoji and bad files. Classification covering each rule.
- Integration (`myfin-api/__tests__/integration`): upload → map → save, then re-upload the same file and assert zero new transactions; check that mappings persist between uploads.

## Constraints and context

- Self-hosted via the root `docker-compose.yml`. No new external services or credentials.
- No PhonePe transactions exist in MyFin yet (confirmed by the user). Matching on `external_id` alone is enough; no fuzzy matching against older data is needed.
- Two codebases: `myfin-api/` and `myfin-web/`. Changes go in both.
- All code lives in the user's GitHub repo `github.com/Ajayghoshm/myfin` (the outer repo). Today, `myfin-web/` is untracked there, the old root frontend files show as deleted, and `myfin-api/` is a nested clone of upstream `afaneca/myfin-api`. Before feature work starts, these steps happen on a new branch, and none of them is pushed without the user's go-ahead:
  1. Commit the restructure: the root frontend moves to `myfin-web/`, and `myfin-api/` is added as a plain folder. Its nested `.git` is moved aside rather than deleted, so the link to upstream isn't lost.
  2. Exclude `.env` files and the password-bearing `docker-compose.yml` change from that commit.
- `docker-compose.yml` contains a plain-text Gmail app password. Don't commit it as part of this work.

## Left to the builder

- Exact component layout and copy for the upload and mapping steps, following existing MUI patterns in the import wizard.
- Whether the parser uses a CSV library already in the dependency tree or a small hand-written parser. The quoted fields contain commas, so naive splitting is not acceptable.
- Error message wording.
