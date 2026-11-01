import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { selectedIds } from '../src/features/rules/ruleApplySelection.ts';

const changes = [
  { transaction_id: '1' },
  { transaction_id: '2' },
  { transaction_id: '3' },
];

describe('selectedIds', () => {
  test('returns all ids when nothing is excluded', () => {
    assert.deepEqual(selectedIds(changes, new Set()), ['1', '2', '3']);
  });

  test('drops excluded ids', () => {
    assert.deepEqual(selectedIds(changes, new Set(['2'])), ['1', '3']);
  });

  test('returns an empty list when all are excluded', () => {
    assert.deepEqual(selectedIds(changes, new Set(['1', '2', '3'])), []);
  });
});
