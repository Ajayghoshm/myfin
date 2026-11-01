import type { BudgetCategory } from '../../../services/budget/budgetServices.ts';
import {
  type BudgetGroup,
  type BudgetMode,
  budgetMode,
  groupBudgetRows,
  isZeroRow,
} from '../budgetGroups.ts';

// A category seen from one column: the other direction's values are zeroed so
// the shared grouping helpers only look at that column. `source` is the
// untouched category that gets rendered and edited.
export type DirectionRow = BudgetCategory & { source: BudgetCategory };
export type ViewGroup = BudgetGroup<DirectionRow> & {
  mode: BudgetMode;
  showParent: boolean;
};
export type BudgetView = {
  groups: ViewGroup[];
  unassigned: DirectionRow[];
  names: string[];
};

const project = (source: BudgetCategory, isDebit: boolean): DirectionRow =>
  isDebit
    ? {
        ...source,
        planned_amount_credit: 0,
        current_amount_credit: 0,
        income_items: [],
        source,
      }
    : {
        ...source,
        planned_amount_debit: 0,
        current_amount_debit: 0,
        expense_items: [],
        source,
      };

export function buildBudgetView(
  categories: BudgetCategory[],
  isDebit: boolean,
  isOpen: boolean,
  hideEmpty: boolean,
): BudgetView {
  const key = (row: DirectionRow) =>
    Number(
      (isOpen
        ? isDebit
          ? row.initial_planned_amount_debit
          : row.initial_planned_amount_credit
        : isDebit
          ? row.current_amount_debit
          : row.current_amount_credit) ?? 0,
    ) || 0;
  const byKey = (a: DirectionRow, b: DirectionRow) => key(b) - key(a);
  // Closed budgets have always hidden empty rows; the toggle extends it to open ones.
  const hide = hideEmpty || !isOpen;

  const { groups, unassigned } = groupBudgetRows(
    categories.map((category) => project(category, isDebit)),
  );

  const viewGroups: ViewGroup[] = [];
  for (const group of groups) {
    const parentEmpty = isZeroRow(group.parent);
    if (hide && parentEmpty && group.children.every(isZeroRow)) continue;
    const children = group.children
      .filter((child) => !hide || !isZeroRow(child))
      .sort((a, b) => byKey(a, b) || a.name.localeCompare(b.name));
    viewGroups.push({
      parent: group.parent,
      children,
      mode: budgetMode(group),
      showParent: !hide || !parentEmpty,
    });
  }
  const groupKey = (g: ViewGroup) =>
    key(g.parent) + g.children.reduce((sum, c) => sum + key(c), 0);
  viewGroups.sort(
    (a, b) =>
      groupKey(b) - groupKey(a) || a.parent.name.localeCompare(b.parent.name),
  );

  const rows = unassigned.filter((row) => !hide || !isZeroRow(row)).sort(byKey);

  return {
    groups: viewGroups,
    unassigned: rows,
    names: [
      ...viewGroups.flatMap((g) => [
        g.parent.name,
        ...g.children.map((c) => c.name),
      ]),
      ...rows.map((r) => r.name),
    ],
  };
}
