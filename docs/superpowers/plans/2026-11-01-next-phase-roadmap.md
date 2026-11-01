# Next Phase Roadmap

> **For agentic workers:** This is the index for the next phase. Each phase gets its own detailed plan, written when the phase starts (so it is based on the code as it is then). Execute a phase with superpowers:subagent-driven-development or superpowers:executing-plans.

**Spec:** the saved requirements list (memory file `next-phase-requirements.md`), reproduced in the phase table below. Item numbers match that list.

## Global Constraints

- Old backups must still restore: do not bump the major version in `myfin-api/package.json`; every new field/table is optional in `BackupData` (`myfin-api/src/utils/backupManager.ts`), defaulted when missing, and added to backup + restore.
- Web verification before every commit: `npm run lint` and `npm run build` in `myfin-web` (per `myfin-web/docs/development.md`); API changes also run the API test suite.
- Commit + push after each feature. Use Sonnet for subagents, Opus only for the final review.
- Categories are one level deep (category > subcategory). Existing categories stay top-level.

## Phases (build order)

| # | Phase | Items | Plan |
|---|-------|-------|------|
| 1 | Quick fixes | 1 scroll gap, 8 auth re-check on tab refocus | `2026-11-01-phase-1-quick-fixes.md` (written) |
| 2 | Subcategories + move/merge | 15 subcategories (one level), 10 move + merge (merged-away category deleted; moved category's budgets and transactions follow it) | `2026-11-01-phase-2-subcategories.md` (written) |
| 3 | Budgets | 2 grouping + auto-fill + edit categories ("Unassigned" when no group), 3 whole-category allocation, 4 fewer-click monthly budgeting, 5 templates (auto-fill source), 5a template <-> Insights (last-6-month average, confirm before applying), 11 hide rows where budgeted and spent are both zero (not remembered) | write when phase 2 ships |
| 4 | Transactions | 6 mark as loan (creates a new Debts loan) + link to event (existing or create new), 13 mark as investment (links to an investment account/asset; excluded from budget spending), 12 apply edited rule to existing transactions (overwrite, with preview), all in Add and Import Transaction | write when phase 3 ships |
| 5 | Reports + export | 14 savings-and-investing report (toggle: invested counts as spending or not), 7 per-module JSON export | write when phase 4 ships |

Item 9 (account icon images) is dropped.

## Review Focus

- Restoring a backup made before this phase lands (no new fields) still works.
- A category with transactions and budgets is moved/merged: totals before and after are equal.
- A refocused tab with an expired session never shows a successful-looking action.
