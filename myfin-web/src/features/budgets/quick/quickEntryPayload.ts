export type QuickItem = { label: string; amount: number; sort_order?: number };
export type QuickRow = {
  category_id: string;
  planned_amount_debit: number;
  planned_amount_credit: number;
  expense_items: QuickItem[];
  income_items: QuickItem[];
};

export const hasPlanned = (row: QuickRow) =>
  row.planned_amount_debit !== 0 ||
  row.planned_amount_credit !== 0 ||
  row.expense_items.length > 0 ||
  row.income_items.length > 0;

// updateBudget upserts per submitted row, so a cleared category must be sent
// as an explicit zero row when it was budgeted in the loaded budget.
export function buildQuickPayload(
  rows: QuickRow[],
  loaded: Record<string, QuickRow>,
  isExisting: boolean,
) {
  return rows
    .filter(
      (r) =>
        hasPlanned(r) ||
        (isExisting && !!loaded[r.category_id] && hasPlanned(loaded[r.category_id])),
    )
    .map((r) => {
      // undefined leaves stored items untouched; [] clears them. On an edit,
      // a row that exists in the loaded budget must send [] when it has none.
      const stored = isExisting && !!loaded[r.category_id];
      const empty = stored ? [] : undefined;
      return {
        category_id: r.category_id,
        planned_value_debit: String(r.planned_amount_debit),
        planned_value_credit: String(r.planned_amount_credit),
        expense_items: r.expense_items.length ? r.expense_items : empty,
        income_items: r.income_items.length ? r.income_items : empty,
      };
    });
}
