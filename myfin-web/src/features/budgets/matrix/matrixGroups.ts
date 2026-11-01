import type {
  BudgetMatrixCategory,
  BudgetMatrixValue,
} from '../../../services/budget/budgetServices.ts';
import {
  type BudgetGroup,
  type BudgetMode,
  type BudgetRowLike,
  budgetMode,
  groupBudgetRows,
  isZeroRow,
} from '../budgetGroups.ts';

export type ValuesByBudget = Map<string, Map<string, BudgetMatrixValue>>;
export type MatrixGroup = {
  parent: BudgetMatrixCategory;
  children: BudgetMatrixCategory[];
};
export type MatrixLayoutRow = {
  category: BudgetMatrixCategory;
  role: 'parent' | 'child' | 'unassigned';
  group?: MatrixGroup;
  // Render a group header row before this row.
  header?: MatrixGroup;
  // Render the "Unassigned" heading before this row.
  unassignedHeading?: boolean;
};

// Category metadata (it holds parent_category_id) merged with one budget's
// values, seen from one direction, so the shared grouping helpers can read it.
const mergedRow = (
  category: BudgetMatrixCategory,
  value: BudgetMatrixValue | undefined,
  isExpense: boolean,
): BudgetRowLike => ({
  category_id: category.category_id,
  parent_category_id: category.parent_category_id,
  name: category.name,
  planned_amount_debit: isExpense ? (value?.planned_amount_debit ?? 0) : 0,
  current_amount_debit: isExpense ? (value?.current_amount_debit ?? 0) : 0,
  planned_amount_credit: isExpense ? 0 : (value?.planned_amount_credit ?? 0),
  current_amount_credit: isExpense ? 0 : (value?.current_amount_credit ?? 0),
  expense_items: isExpense ? value?.expense_items : undefined,
  income_items: isExpense ? undefined : value?.income_items,
});

export const mergedGroupForBudget = (
  group: MatrixGroup,
  budgetId: bigint,
  isExpense: boolean,
  valuesByBudget: ValuesByBudget,
): BudgetGroup<BudgetRowLike> => {
  const values = valuesByBudget.get(budgetId.toString());
  const row = (c: BudgetMatrixCategory) =>
    mergedRow(c, values?.get(c.category_id.toString()), isExpense);
  return { parent: row(group.parent), children: group.children.map(row) };
};

export const matrixGroupMode = (
  group: MatrixGroup,
  budgetId: bigint,
  isExpense: boolean,
  valuesByBudget: ValuesByBudget,
): BudgetMode =>
  budgetMode(mergedGroupForBudget(group, budgetId, isExpense, valuesByBudget));

export function buildMatrixLayout(params: {
  categories: BudgetMatrixCategory[];
  budgetIds: bigint[];
  valuesByBudget: ValuesByBudget;
  isExpense: boolean;
  query: string;
  hideEmpty: boolean;
}): MatrixLayoutRow[] {
  const { categories, budgetIds, valuesByBudget, isExpense, hideEmpty } =
    params;
  const query = params.query.trim().toLocaleLowerCase();
  const matches = (c: BudgetMatrixCategory) =>
    !query ||
    `${c.name} ${c.description || ''}`.toLocaleLowerCase().includes(query);

  const planned = (c: BudgetMatrixCategory) =>
    budgetIds.reduce((sum, id) => {
      const v = valuesByBudget
        .get(id.toString())
        ?.get(c.category_id.toString());
      return (
        sum +
        ((isExpense ? v?.planned_amount_debit : v?.planned_amount_credit) || 0)
      );
    }, 0);
  const empty = (c: BudgetMatrixCategory) =>
    budgetIds.every((id) =>
      isZeroRow(
        mergedRow(
          c,
          valuesByBudget.get(id.toString())?.get(c.category_id.toString()),
          isExpense,
        ),
      ),
    );
  const byPlanned = (a: BudgetMatrixCategory, b: BudgetMatrixCategory) =>
    planned(b) - planned(a) || a.name.localeCompare(b.name);

  const grouped = groupBudgetRows(categories);
  const rows: MatrixLayoutRow[] = [];

  const groups = grouped.groups
    .map(({ parent, children }) => ({
      parent,
      children,
      total: planned(parent) + children.reduce((s, c) => s + planned(c), 0),
    }))
    .sort(
      (a, b) => b.total - a.total || a.parent.name.localeCompare(b.parent.name),
    );
  for (const g of groups) {
    const group: MatrixGroup = {
      parent: g.parent,
      children: [...g.children].sort(byPlanned),
    };
    const parentMatches = matches(group.parent);
    const children = group.children.filter(
      (c) => (parentMatches || matches(c)) && !(hideEmpty && empty(c)),
    );
    const showParent = parentMatches && !(hideEmpty && empty(group.parent));
    if (!showParent && children.length === 0) continue;
    const groupRows: MatrixLayoutRow[] = [
      ...(showParent
        ? [{ category: group.parent, role: 'parent' as const, group }]
        : []),
      ...children.map((category) => ({
        category,
        role: 'child' as const,
        group,
      })),
    ];
    groupRows[0].header = group;
    rows.push(...groupRows);
  }

  const unassigned = grouped.unassigned
    .filter((c) => matches(c) && !(hideEmpty && empty(c)))
    .sort(byPlanned);
  unassigned.forEach((category, index) => {
    rows.push({
      category,
      role: 'unassigned',
      unassignedHeading: index === 0 && rows.length > 0,
    });
  });
  return rows;
}
