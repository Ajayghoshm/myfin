import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildQuickPayload,
  type QuickRow,
} from '../src/features/budgets/quick/quickEntryPayload.ts';

const row = (id: string, debit = 0, credit = 0): QuickRow => ({
  category_id: id,
  planned_amount_debit: debit,
  planned_amount_credit: credit,
  expense_items: [],
  income_items: [],
});

describe('buildQuickPayload', () => {
  test('zeroed previously-budgeted row is sent as zero', () => {
    const out = buildQuickPayload([row('1', 0)], { '1': row('1', 50) }, true);
    assert.equal(out.length, 1);
    assert.equal(out[0].planned_value_debit, '0');
    assert.deepEqual(out[0].expense_items, []);
  });
  test('never-budgeted zero row is omitted', () => {
    assert.equal(
      buildQuickPayload([row('1'), row('2', 5)], { '1': row('1') }, true).length,
      1,
    );
  });
  test('create omits zeros', () => {
    assert.equal(buildQuickPayload([row('1', 0)], { '1': row('1', 50) }, false).length, 0);
  });
  test('zeroed row that had items clears stored items', () => {
    const had: QuickRow = {
      ...row('1', 30),
      expense_items: [{ label: 'a', amount: 30 }],
    };
    const out = buildQuickPayload([row('1', 0)], { '1': had }, true);
    assert.deepEqual(out[0].expense_items, []);
    assert.deepEqual(out[0].income_items, []);
    assert.equal(out[0].planned_value_debit, '0');
  });
  test('removing all items and entering a plain amount sends []', () => {
    const had: QuickRow = {
      ...row('1', 30),
      expense_items: [{ label: 'a', amount: 30 }],
    };
    const out = buildQuickPayload([row('1', 45)], { '1': had }, true);
    assert.deepEqual(out[0].expense_items, []);
    assert.equal(out[0].planned_value_debit, '45');
  });
  test('new row and create leave items undefined', () => {
    assert.equal(buildQuickPayload([row('2', 5)], {}, true)[0].expense_items, undefined);
    assert.equal(buildQuickPayload([row('2', 5)], { '2': row('2') }, false)[0].expense_items, undefined);
  });
});
