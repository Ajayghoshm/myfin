import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyInvestment,
  clearInvestmentFields,
  canMarkInvestment,
  canMarkLoan,
  NO_FLAGS,
  toApiFlags,
} from '../src/features/transactions/flags/flagsModel.ts';

describe('flagsModel', () => {
  test('canMarkLoan true for expense and income, false for transfer', () => {
    assert.equal(canMarkLoan('E'), true);
    assert.equal(canMarkLoan('I'), true);
    assert.equal(canMarkLoan('T'), false);
  });

  test('canMarkInvestment true only for expense', () => {
    assert.equal(canMarkInvestment('E'), true);
    assert.equal(canMarkInvestment('I'), false);
    assert.equal(canMarkInvestment('T'), false);
  });

  test('toApiFlags maps loan, event id and new event', () => {
    assert.deepEqual(
      toApiFlags({
        kind: 'loan',
        loanName: 'Rent advance',
        event: { event_id: '7' },
      }),
      { loan: { name: 'Rent advance' }, event: { event_id: '7' } },
    );
    assert.deepEqual(
      toApiFlags({ kind: 'none', event: { new_event: { name: 'Trip' } } }),
      { event: { new_event: { name: 'Trip' } } },
    );
    assert.deepEqual(toApiFlags(NO_FLAGS), {});
  });

  test('toApiFlags omits loan when kind is investment', () => {
    assert.deepEqual(
      toApiFlags({ kind: 'investment', loanName: 'x', investmentAccountId: 3 }),
      {},
    );
  });

  test('applyInvestment turns an expense into a transfer to the chosen account', () => {
    assert.deepEqual(
      applyInvestment(
        { type: 'E', account_to_id: undefined },
        { kind: 'investment', investmentAccountId: 9 },
      ),
      { type: 'T', account_to_id: 9 },
    );
  });

  test('applyInvestment leaves the transaction unchanged for kind none', () => {
    const trx = { type: 'E' as const, account_to_id: 4 };
    assert.deepEqual(applyInvestment(trx, NO_FLAGS), trx);
  });

  test('toApiFlags gives an empty loan for a blank name and trims names', () => {
    assert.deepEqual(toApiFlags({ kind: 'loan', loanName: '   ' }), {
      loan: {},
    });
    assert.deepEqual(toApiFlags({ kind: 'loan' }), { loan: {} });
    assert.deepEqual(toApiFlags({ kind: 'loan', loanName: '  Bob  ' }), {
      loan: { name: 'Bob' },
    });
  });

  test('applyInvestment leaves the transaction unchanged without an account id', () => {
    const trx = { type: 'E' as const, account_to_id: 4 };
    assert.deepEqual(applyInvestment(trx, { kind: 'investment' }), trx);
  });

  test('clearInvestmentFields drops category and essential for an investment', () => {
    const trx = { category_id: 7n, is_essential: true, amount: 5 };
    const choice = { kind: 'investment' as const, investmentAccountId: 3, event: null };
    assert.deepEqual(clearInvestmentFields(trx, choice), {
      category_id: undefined,
      is_essential: false,
      amount: 5,
    });
  });

  test('clearInvestmentFields leaves other rows untouched', () => {
    const trx = { category_id: 7n, is_essential: true };
    assert.equal(clearInvestmentFields(trx, NO_FLAGS), trx);
    assert.equal(
      clearInvestmentFields(trx, { kind: 'investment', event: null }),
      trx,
    );
  });
});
