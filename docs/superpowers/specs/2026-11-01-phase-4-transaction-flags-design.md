# Phase 4: loan, event and investment flags, and applying edited rules

Date: 2026-11-01. Branch: feature/phonepe-import. Backlog items 6, 13 and 12 (see the `next-phase-requirements` memory).

## Intent

When a transaction is entered or imported, the user cannot say what it really is. Real case: money sent to a friend through PhonePe was imported as a plain expense, with no way to mark it as a loan. The same gap exists for investments and for money spent on a family event. Separately, editing a rule only affects transactions that arrive afterwards, so old transactions keep the old category.

## Goals

1. In **Add Transaction** and in the **import review** (including PhonePe), the user can mark a transaction as a loan, as an investment, or link it to an event.
2. Editing a rule can be applied to existing transactions, after a preview.

## Non-goals

- Automatic repayment matching for loans. Repayments are recorded by hand in Debts.
- Per-asset investment tracking. Investments link to a whole investment account only.
- Event tasks or reminders. An event is only a dated thing that expenses link to.
- The savings-and-investing report itself (Phase 5, item 14). This phase only stores the data it will read.

## Anti-goals

- A bulk apply that silently changes data. Nothing changes before the preview is confirmed.
- Anything that stops an old backup from restoring (see Constraints).

## Decisions made with the user

**Loan**
- A "Mark as loan" option on each transaction in Add Transaction and the import review.
- Marking creates a new record in Debts, using what Debts already offers (`createPeopleDebt` accepts a `transaction_id`, and links the transaction with `debt_id` and `debt_role`).
- Repayment is manual.

**Investment**
- A "Mark as investment" option in Add Transaction and the import review.
- The user picks one of their **investment accounts** (account type INVESTING). Not a specific asset.
- It **counts as an investment, not as spending**: excluded from budget and spending totals, and stored as invested money for the Phase 5 savings-and-investing report. No toggle. (The user first said "counts as spending", then corrected it; the later answer stands.)
- The money leaves the source account and the **investment account's balance goes up by the same amount**, so the account reflects what was put in. Net worth must not double-count (the money moved, it was not created).

**Event**
- A "Link to event" option in Add Transaction and the import review.
- The user picks an existing event or creates a new one inline.
- Once linked, the user sees the total spent on the event and, if the event has an amount or gift budget, the comparison against it. Events already have dated occurrences and a transaction link table (`event_occurrence_transactions`), so linking builds on that.
- An event may be a family function or something with a deadline. Both are the existing event model: a name, a date and an optional amount.

**Apply edited rules**
- After a rule edit, the user can run it over existing transactions.
- A preview lists each transaction it would change, with the current and new category, before anything is saved.
- Matching and priority are the same as at import time.
- It **overwrites** categories the user set by hand.

## Constraints

- Old backups must restore. Do not bump the major version. Every new field or table is optional in `BackupData`, defaulted when missing, and written to backup and restore (`myfin-api/src/utils/backupManager.ts`).
- Existing behavior to respect: `budgetService.ts` already treats expenses and income involving INVESTING accounts specially when computing budget amounts. The investment flag must be excluded from spending consistently with that logic.
- Follow the repo's SDD workflow, Sonnet subagents, commit and push after each feature.

## Build order

The three pieces are independent. Build in this order, each with its own plan section and review:

1. **Loan and event flags** (mostly wiring: the services exist; the import review and Add Transaction need the controls, and PhonePe categorize needs to accept and apply the flags).
2. **Investment flag** (new column(s), service, backup and restore, UI).
3. **Apply edited rules** (preview and apply endpoints, UI on the rules page).

## Calls I made (not discussed with the user)

- **Investment storage (decided by the user):** marking a transaction as an investment converts it into a transfer from the source account to the chosen investment account. The existing budget logic already excludes such transfers from spending, and both balances move without double-counting. The builder works out how an import row and an edited transaction are converted and how un-marking converts it back.
- **Loan direction:** derived from the transaction. An expense creates "lent", an income creates "borrowed". This is the existing Debts rule.
- **Loan counterparty name:** defaults to the payee/description, editable in the control.
- **Import flow:** the flags are chosen per row in the review step and applied when the import is confirmed, not afterwards.
- **Rule apply scope:** the preview covers all of the user's transactions the rule matches, with a way to exclude individual rows before confirming.
- **Rule apply runs the whole ruleset** in priority order (the user asked for import-like behavior). The preview lists only rows whose category would change; rows matching no rule are left alone; transfers are skipped.
- **Failed flag on import:** if creating the loan or event link fails for a row, that row's flag is skipped and reported in the import result; the rest of the import goes through.
- **Event link:** a linked transaction attaches to the occurrence nearest its date; a new inline event gets an occurrence on the transaction date.
- **Edit and delete:** deleting a flagged transaction removes only the link; the Debts record stays. Flags can also be changed on an existing transaction, not only at creation and import.
- **Restore:** an `investment_account_id` pointing at an account missing from the backup is set to null.
- **One flag per transaction at most for loan and investment** (they are mutually exclusive). Event linking can combine with either.

## Left to the builder

Column names, API shapes, how the import review UI lays out the three controls, the preview paging, and test layout.
