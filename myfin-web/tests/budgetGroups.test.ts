import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  budgetConflicts,
  budgetMode,
  clearPlannedRows,
  groupBudgetRows,
  isZeroRow,
  resolveBudgetConflict,
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

describe('conflict resolution', () => {
  const mk = (id: string, parent: string | null, d = 0, items = false) => ({
    category_id: id,
    parent_category_id: parent,
    name: id,
    planned_amount_debit: d,
    planned_amount_credit: 0,
    expense_items: items ? [{ name: 'x', amount: d }] : [],
    income_items: [],
  });
  const rows = {
    p: mk('p', null, 100),
    c1: mk('c1', 'p', 40, true),
    c2: mk('c2', 'p', 0),
    o: mk('o', null, 5),
    oc: mk('oc', 'o', 0),
  };
  const groups = groupBudgetRows(Object.values(rows)).groups;
  const pGroup = groups.find((g) => g.parent.category_id === 'p');
  if (!pGroup) throw new Error('missing group');

  test('budgetConflicts finds only groups with both sides planned', () => {
    assert.deepEqual(
      budgetConflicts(groups).map((g) => g.parent.name),
      ['p'],
    );
  });

  test('keeping the parent clears children and their items only', () => {
    const { rows: next, clearedIds } = resolveBudgetConflict(
      rows,
      pGroup,
      'parent',
    );
    assert.deepEqual(clearedIds.sort(), ['c1', 'c2']);
    assert.equal(next.c1.planned_amount_debit, 0);
    assert.deepEqual(next.c1.expense_items, []);
    assert.equal(next.p, rows.p);
    assert.equal(next.o, rows.o);
    assert.equal(rows.c1.planned_amount_debit, 40);
  });

  test('keeping the children clears the parent only', () => {
    const { rows: next } = resolveBudgetConflict(rows, pGroup, 'children');
    assert.equal(next.p.planned_amount_debit, 0);
    assert.deepEqual(next.p.income_items, []);
    assert.equal(next.c1, rows.c1);
    assert.equal(next.o, rows.o);
  });

  test('clearPlannedRows ignores unknown ids', () => {
    assert.deepEqual(clearPlannedRows(rows, ['nope']), rows);
  });
});
