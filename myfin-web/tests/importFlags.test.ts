import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  effectiveChoice,
  flagItemsForCreated,
  skippedFlagsFor,
} from '../src/features/transactions/import/importFlags.ts';
import { NO_FLAGS } from '../src/features/transactions/flags/flagsModel.ts';

const loan = { kind: 'loan' as const, loanName: 'Rent', event: null };

describe('flagItemsForCreated', () => {
  test('maps a flagged row to its created transaction id', () => {
    const items = flagItemsForCreated(
      [{ choice: NO_FLAGS }, { choice: loan }],
      [
        { index: 0, transaction_id: '10' },
        { index: 1, transaction_id: '11' },
      ],
    );
    assert.deepEqual(items, [
      { transaction_id: '11', flags: { loan: { name: 'Rent' } } },
    ]);
  });

  test('ignores rows skipped as duplicates', () => {
    const items = flagItemsForCreated(
      [{ choice: loan }, { choice: loan }],
      [{ index: 1, transaction_id: '21' }],
    );
    assert.deepEqual(items, [
      { transaction_id: '21', flags: { loan: { name: 'Rent' } } },
    ]);
  });

  test('ignores rows with no loan or event', () => {
    const items = flagItemsForCreated(
      [{ choice: NO_FLAGS }],
      [{ index: 0, transaction_id: '30' }],
    );
    assert.deepEqual(items, []);
  });

  test('investment rows are not sent (already a transfer)', () => {
    const items = flagItemsForCreated(
      [{ choice: { kind: 'investment', investmentAccountId: 5, event: null } }],
      [{ index: 0, transaction_id: '40' }],
    );
    assert.deepEqual(items, []);
  });

  test('keeps an event on an investment row', () => {
    const event = { event_id: 'e1' };
    const items = flagItemsForCreated(
      [{ choice: { kind: 'investment', investmentAccountId: 5, event } }],
      [{ index: 0, transaction_id: '41' }],
    );
    assert.deepEqual(items, [{ transaction_id: '41', flags: { event } }]);
  });
});

describe('effectiveChoice', () => {
  test('drops a loan mark once the row became a transfer', () => {
    assert.equal(effectiveChoice(loan, 'T').kind, 'none');
    assert.equal(effectiveChoice(loan, 'E').kind, 'loan');
  });

  test('drops an investment mark unless the row is an expense', () => {
    const investment = {
      kind: 'investment' as const,
      investmentAccountId: 5,
      event: null,
    };
    assert.equal(effectiveChoice(investment, 'I').kind, 'none');
    assert.equal(effectiveChoice(investment, 'E').kind, 'investment');
  });
});

describe('skippedFlagsFor', () => {
  test('names each failure by its submitted row', () => {
    const skipped = skippedFlagsFor(
      [{ transaction_id: '51', flag: 'event', message: 'Event not found' }],
      [{ description: 'Dup' }, { description: 'Trip dinner' }],
      [{ index: 1, transaction_id: '51' }],
    );
    assert.deepEqual(skipped, [
      { description: 'Trip dinner', flag: 'event', message: 'Event not found' },
    ]);
  });

  test('an unknown id keeps the message with a blank description', () => {
    const skipped = skippedFlagsFor(
      [{ transaction_id: '99', flag: 'loan', message: 'x' }],
      [{ description: 'A' }],
      [],
    );
    assert.equal(skipped[0].description, '');
  });
});

describe('effectiveChoice events', () => {
  test('drops an event on an income row', () => {
    const choice = { kind: 'none' as const, event: { event_id: 'e1' } };
    assert.equal(effectiveChoice(choice, 'I').event, null);
    assert.deepEqual(effectiveChoice(choice, 'E').event, { event_id: 'e1' });
  });
});
