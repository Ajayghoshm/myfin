import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyInvestment,
  clearInvestmentFields,
  groupFlagChoices,
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
  describe('groupFlagChoices', () => {
    const rows = [
      { tempId: 1, type: 'E' as const, fromAccountId: 10n },
      { tempId: 2, type: 'I' as const, fromAccountId: null },
      { tempId: 3, type: 'T' as const, fromAccountId: 10n },
    ];

    test('loan applies to expense and income rows only', () => {
      const { choices, marked } = groupFlagChoices(rows, {
        kind: 'loan',
        loanName: 'Bob',
        event: null,
      });
      assert.equal(marked, 2);
      assert.equal(choices.get(1)?.kind, 'loan');
      assert.equal(choices.get(1)?.loanName, 'Bob');
      assert.equal(choices.get(2)?.kind, 'loan');
      assert.equal(choices.get(3)?.kind, 'none');
    });

    test('investment applies to expenses not paid from the target', () => {
      const choice = {
        kind: 'investment' as const,
        investmentAccountId: 10,
        event: null,
      };
      const two = [
        ...rows,
        { tempId: 4, type: 'E' as const, fromAccountId: 11n },
      ];
      const { choices, marked } = groupFlagChoices(two, choice);
      assert.equal(marked, 1);
      assert.equal(choices.get(1)?.kind, 'none');
      assert.equal(choices.get(2)?.kind, 'none');
      assert.equal(choices.get(3)?.kind, 'none');
      assert.equal(choices.get(4)?.kind, 'investment');
    });

    test('event is not applied to income rows', () => {
      const event = { event_id: 'e1' };
      const { choices, marked } = groupFlagChoices(rows, {
        kind: 'none',
        event,
      });
      assert.equal(marked, 2);
      assert.deepEqual(choices.get(1)?.event, event);
      assert.equal(choices.get(2)?.event, null);
      assert.deepEqual(choices.get(3)?.event, event);
    });

    test('empty group and cleared choice', () => {
      assert.equal(groupFlagChoices([], NO_FLAGS).marked, 0);
      assert.equal(groupFlagChoices(rows, NO_FLAGS).marked, 0);
    });
  });
});
