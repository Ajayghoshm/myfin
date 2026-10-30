# PhonePe import: grouped categorization by payee — design

Date: 2026-10-30
Status: draft, builder-checked, awaiting user approval

## Intent

After uploading a PhonePe statement, the review screen (step 2 of the import wizard) lists every new row. Rows that match one of the user's auto-categorize rules arrive with category, entity and essential flag filled in. The rest are blank, and the user fills them in row by row, even when the same payee appears many times (e.g. "Paid to SWIGGY" six times in a month).

The goal: let the user fill those blanks per payee instead of per row, and remember each choice so the same payee is already filled in on the next import.

## Goals

- In the PhonePe review step, add a **Group by payee** option.
- When on, rows are grouped by normalized payee name. Each group is one line showing the payee, the number of transactions and the total amount.
- Groups are ordered by transaction count, highest first.
- On a group line the user can set **category**, **entity** and **essential flag** once. The values apply to every row in the group.
- The user can expand a group and override any single row.
- Rows already filled by an existing rule show their values on the group line. A group counts as done when all its rows have a category.
- Choices made on a group are **remembered**: on saving the import, a rule is created for each group the user set, so the payee is auto-filled in future imports (and in the generic paste import).
- Transfer rows (credit card bill, "Add money UPI Lite") are not grouped. They keep their current handling.

## Non-goals

- Changing how rules are matched or the rules screen.
- Grouping in the generic paste/CSV import. This is PhonePe only.
- Grouping by payment method or other fields. Payee only (the user's decision).
- Suggesting categories automatically beyond what existing rules already do.

## Anti-goals

- A group choice silently overwriting a category the user already set on an individual row, or one an existing rule filled in, without the user asking for it.
- Creating duplicate or conflicting rules (a second "SWIGGY" rule when one exists).
- Anything saved before the user confirms the review screen, including the new rules.
- Breaking the existing ungrouped review table. Grouping is an option, not a replacement.

## Payee name

Derived from the cleaned description by removing a leading "Paid to ", "Received from ", "Requested by " or "Payment to ", then trimming, collapsing whitespace and comparing case-insensitively. So "VEG BASKET " and "Veg Basket" are one group. (Decided by the assistant, not the user: the exact list of prefixes; the builder should check it against the sample CSV and extend it if other prefixes appear.)

Rows with descriptions that carry no payee (e.g. "Electricity bill paid 1234567") form a group named by the full description.

## Group edits and existing values

Decided by the user: setting a value on a group line fills **only the rows that are blank** for that field. Rows that already have a value, from a rule or from the user's own edit, keep it. If the rows in a group have different values for a field, the group line shows "mixed" for it. An explicit "apply to all rows" action on the group line overwrites every row; nothing overwrites without it. A row overridden individually keeps its value when the group is edited later.

Assistant's call (not yet confirmed by the user): income rows ("Received from X") are grouped like expenses, but income and expense groups for the same payee stay separate, since a payee can be both. Transfers are not grouped.

## Remembering choices

Assistant's calls, to be marked as such when handed over:

- The rule matches on the payee name, case-insensitive, with the existing description `CONTAINS` matcher. Use the full "Paid to <name>" text if the name is short enough to match unrelated descriptions (the builder sets the threshold).
- If a rule for that payee already exists, update it instead of adding a second one.
- A group the user did not change writes no rule. A rule stores only the fields the user set on the group line.
- Groups with no payee (e.g. "Electricity bill paid 1234567") are grouped by full description but create no rule, because the reference changes each month.
- Rules are sent in the same save request as the transactions, so both succeed or neither does.
- The grouping toggle keeps the user's edits when switched off and on.

Remembering reuses the existing `rules` table and the existing matching in `ruleService` (description `CONTAINS` the payee name, assigning category, entity and essential flag). This matches how rules already work: the description of a PhonePe row contains the payee name, so a "contains" rule will match it on later imports. The rule is created when the import is confirmed, not when the group is edited.

Open for the builder to settle:

- If a rule already matches the payee, update it rather than adding a second one.
- Rule matching is by "contains", so a short payee name could match unrelated descriptions. The builder should decide whether to match on the full "Paid to <name>" text instead.
- Whether rules are created for groups of a single transaction (assistant's suggestion: only create a rule when the user explicitly sets a value on the group line, whatever the count).

## Where the change lives

- Web: [ImportTrxStep2.tsx](../../../myfin-web/src/features/transactions/import/ImportTrxStep2.tsx) is the review table. The grouped view is a new mode of it for PhonePe imports.
- API: rule creation uses `createRule` in [ruleService.ts](../../../myfin-api/src/services/ruleService.ts). The final save step for the import needs a way to receive the rules to create, or a separate call made right after a successful save.
- Locale strings go in both `en.json` and `pt.json` on each side, per the repo guidelines.

## Constraints

- Follow the repo's AGENTS.md and the frontend guidelines in `myfin-web/docs/`.
- Keep the existing PhonePe import tests passing; add tests for payee normalization and for rule creation.

## Left to the builder

- UI details of the group line and expand/collapse behavior, as long as it fits the existing grid.
- Whether grouping is computed on the client or the server. Client side seems enough since the rows are already there.
- Wording of labels.
