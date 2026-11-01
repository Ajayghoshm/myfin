// Works on any row with planned/current_amount_debit/credit and optional expense/income items (budget details and matrix rows share these names).
export type BudgetRowLike = {
  category_id: bigint | number | string;
  parent_category_id?: bigint | number | string | null;
  name: string;
  planned_amount_debit?: number;
  planned_amount_credit?: number;
  current_amount_debit?: number;
  current_amount_credit?: number;
  expense_items?: readonly unknown[];
  income_items?: readonly unknown[];
};

export type BudgetGroup<T> = { parent: T; children: T[] };
export type BudgetAmountField =
  | 'planned_debit'
  | 'planned_credit'
  | 'current_debit'
  | 'current_credit';
export type BudgetMode = 'lump' | 'split' | 'empty';

const amount = (row: BudgetRowLike, field: BudgetAmountField): number => {
  const [kind, direction] = field.split('_');
  const key = `${kind}_amount_${direction}` as
    | 'planned_amount_debit'
    | 'planned_amount_credit'
    | 'current_amount_debit'
    | 'current_amount_credit';
  return Number(row[key] ?? 0);
};

const hasItems = (row: BudgetRowLike) =>
  (row.expense_items?.length ?? 0) > 0 || (row.income_items?.length ?? 0) > 0;

const hasPlanned = (row: BudgetRowLike) =>
  amount(row, 'planned_debit') !== 0 ||
  amount(row, 'planned_credit') !== 0 ||
  hasItems(row);

export function groupBudgetRows<T extends BudgetRowLike>(
  rows: T[],
): { groups: BudgetGroup<T>[]; unassigned: T[] } {
  const ids = new Set(rows.map((r) => String(r.category_id)));
  const childrenByParent = new Map<string, T[]>();
  const topLevel: T[] = [];
  for (const row of rows) {
    const parentId =
      row.parent_category_id == null ? null : String(row.parent_category_id);
    if (parentId !== null && ids.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(row);
      childrenByParent.set(parentId, list);
    } else {
      topLevel.push(row);
    }
  }
  const groups: BudgetGroup<T>[] = [];
  const unassigned: T[] = [];
  for (const row of topLevel) {
    const children = childrenByParent.get(String(row.category_id));
    if (children) groups.push({ parent: row, children });
    else unassigned.push(row);
  }
  return { groups, unassigned };
}

export function rolledUp<T extends BudgetRowLike>(
  group: BudgetGroup<T>,
  field: BudgetAmountField,
): number {
  const own = amount(group.parent, field);
  if (field.startsWith('planned') && own !== 0) return own;
  return group.children.reduce((sum, c) => sum + amount(c, field), own);
}

export function budgetMode<T extends BudgetRowLike>(
  group: BudgetGroup<T>,
): BudgetMode {
  if (hasPlanned(group.parent)) return 'lump';
  if (group.children.some(hasPlanned)) return 'split';
  return 'empty';
}

export function isZeroRow(row: BudgetRowLike): boolean {
  return (
    !hasPlanned(row) &&
    amount(row, 'current_debit') === 0 &&
    amount(row, 'current_credit') === 0
  );
}
