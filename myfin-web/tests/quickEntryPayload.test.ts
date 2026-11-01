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
    assert.equal(out[0].expense_items, undefined);
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
});
