import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  budgetMode,
  groupBudgetRows,
  isZeroRow,
  rolledUp,
} from '../src/features/budgets/budgetGroups.ts';

type Row = {
  category_id: number | string;
  parent_category_id?: number | string | null;
  name: string;
  planned_amount_debit?: number;
  planned_amount_credit?: number;
  current_amount_debit?: number;
  current_amount_credit?: number;
  expense_items?: unknown[];
  income_items?: unknown[];
};

const row = (
  id: number,
  name: string,
  parent: number | null = null,
  extra: Partial<Row> = {},
): Row => ({
  category_id: id,
  parent_category_id: parent,
  name,
  planned_amount_debit: 0,
  planned_amount_credit: 0,
  current_amount_debit: 0,
  current_amount_credit: 0,
  ...extra,
});

describe('groupBudgetRows', () => {
  test('groups parents with children and puts standalone categories in unassigned', () => {
    const { groups, unassigned } = groupBudgetRows([
      row(1, 'Food'),
      row(2, 'Online', 1),
      row(3, 'Rent'),
      row(4, 'Dining', '1'),
      row(5, 'Orphan', 99),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].parent.name, 'Food');
    assert.deepEqual(
      groups[0].children.map((c) => c.name),
      ['Online', 'Dining'],
    );
    assert.deepEqual(
      unassigned.map((r) => r.name),
      ['Rent', 'Orphan'],
    );
  });
});

describe('rolledUp', () => {
  test('rolledUp adds children to the parent for actual', () => {
    const [g] = groupBudgetRows([
      row(1, 'Food', null, { current_amount_debit: 10 }),
      row(2, 'Online', 1, { current_amount_debit: 5 }),
      row(3, 'Dining', 1, { current_amount_debit: 7 }),
    ]).groups;
    assert.equal(rolledUp(g, 'current_debit'), 22);
    assert.equal(rolledUp(g, 'current_credit'), 0);
  });

  test("rolledUp planned returns lump sum when parent has an amount, else the children's sum", () => {
    const lump = groupBudgetRows([
      row(1, 'Food', null, { planned_amount_debit: 100 }),
      row(2, 'Online', 1),
    ]).groups[0];
    assert.equal(rolledUp(lump, 'planned_debit'), 100);
    const split = groupBudgetRows([
      row(1, 'Food'),
      row(2, 'Online', 1, { planned_amount_debit: 30 }),
      row(3, 'Dining', 1, { planned_amount_debit: 20 }),
    ]).groups[0];
    assert.equal(rolledUp(split, 'planned_debit'), 50);
  });
});

describe('budgetMode', () => {
  test('budgetMode detects lump, split and empty', () => {
    const mk = (p: Partial<Row>, c: Partial<Row>) =>
      groupBudgetRows([row(1, 'P', null, p), row(2, 'C', 1, c)]).groups[0];
    assert.equal(budgetMode(mk({ planned_amount_credit: 5 }, {})), 'lump');
    assert.equal(budgetMode(mk({}, { planned_amount_debit: 5 })), 'split');
    assert.equal(budgetMode(mk({}, {})), 'empty');
  });
});

describe('isZeroRow', () => {
  test('isZeroRow is false when planned or current is non-zero or items exist', () => {
    assert.equal(isZeroRow(row(1, 'A')), true);
    assert.equal(isZeroRow(row(1, 'A', null, { planned_amount_debit: 1 })), false);
    assert.equal(isZeroRow(row(1, 'A', null, { current_amount_credit: 1 })), false);
    assert.equal(isZeroRow(row(1, 'A', null, { income_items: [{}] })), false);
  });
});
