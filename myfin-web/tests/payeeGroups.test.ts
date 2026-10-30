import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildPayeeGroups,
  fillBlankRows,
  type GroupableTrx,
  groupCategory,
  toPayeeRules,
} from '../src/features/transactions/import/payeeGroups.ts';

const opt = (id: number, label: string) => ({ id: BigInt(id), label });
const FOOD = opt(1, 'Food');
const SHOPPING = opt(2, 'Shopping');
const SWIGGY_ENTITY = opt(10, 'Swiggy');

let nextId = 0;
const trx = (over: Partial<GroupableTrx> = {}): GroupableTrx => ({
  tempId: nextId++,
  selected: true,
  type: 'E' as GroupableTrx['type'],
  payee: 'SWIGGY',
  payeeMatch: 'SWIGGY',
  value: 10,
  essential: false,
  ...over,
});

describe('buildPayeeGroups', () => {
  test('merges case variants, separates income from expense, sorts by count', () => {
    const rows = [
      trx({ payee: 'Veg Basket' }),
      trx({ payee: 'SWIGGY' }),
      trx({ payee: 'Swiggy' }),
      trx({ payee: 'SWIGGY', type: 'I' as GroupableTrx['type'] }),
      trx({ payee: null }),
    ];
    const groups = buildPayeeGroups(rows);
    assert.deepEqual(
      groups.map((g) => [g.key, g.count]),
      [
        ['E:swiggy', 2],
        ['I:swiggy', 1],
        ['E:veg basket', 1],
      ],
    );
  });
});

describe('fillBlankRows', () => {
  test('fills blank rows only and keeps a value the row already has', () => {
    const rows = [trx({ category: SHOPPING }), trx(), trx()];
    const [group] = buildPayeeGroups(rows);
    const next = fillBlankRows(rows, group, { category: FOOD }, false);
    assert.deepEqual(
      next.map((r) => r.category?.label),
      ['Shopping', 'Food', 'Food'],
    );
    assert.equal(groupCategory(next, group).kind, 'mixed');
  });
});

describe('toPayeeRules', () => {
  test('saves the value the user chose even when no row changed', () => {
    // every row already carries a guessed "Shopping"; the user picked "Food"
    const rows = [trx({ category: SHOPPING }), trx({ category: SHOPPING })];
    const groups = buildPayeeGroups(rows);
    const rules = toPayeeRules(rows, groups, { [groups[0].key]: { category: FOOD } });
    assert.equal(rules.length, 1);
    assert.equal(rules[0].category_id, FOOD.id);
  });

  test('saves the chosen value for a mixed group', () => {
    const rows = [trx({ category: SHOPPING }), trx()];
    const groups = buildPayeeGroups(rows);
    const rules = toPayeeRules(rows, groups, { [groups[0].key]: { category: FOOD } });
    assert.equal(rules[0].category_id, FOOD.id);
  });

  test('carries the unanimous values of untouched fields as defaults for a new rule', () => {
    const rows = [
      trx({ entity: SWIGGY_ENTITY, essential: true }),
      trx({ entity: SWIGGY_ENTITY, essential: true }),
    ];
    const groups = buildPayeeGroups(rows);
    const [rule] = toPayeeRules(rows, groups, { [groups[0].key]: { category: FOOD } });
    assert.equal(rule.category_id, FOOD.id);
    assert.equal(rule.entity_id, undefined);
    assert.deepEqual(rule.defaults, { entity_id: SWIGGY_ENTITY.id, is_essential: true });
  });

  test('defaults ignore deselected rows', () => {
    const rows = [
      trx({ entity: SWIGGY_ENTITY }),
      trx({ entity: opt(11, 'Other'), selected: false }),
    ];
    const groups = buildPayeeGroups(rows);
    const [rule] = toPayeeRules(rows, groups, { [groups[0].key]: { category: FOOD } });
    assert.equal(rule.defaults?.entity_id, SWIGGY_ENTITY.id);
  });

  test('a cleared picker saves nothing for that field', () => {
    const rows = [trx()];
    const groups = buildPayeeGroups(rows);
    const rules = toPayeeRules(rows, groups, { [groups[0].key]: { category: undefined } });
    assert.deepEqual(rules, []);
  });

  test('creates no rule for a group with no selected row', () => {
    const rows = [trx({ selected: false })];
    const groups = buildPayeeGroups(rows);
    assert.deepEqual(toPayeeRules(rows, groups, { [groups[0].key]: { category: FOOD } }), []);
  });

  test('creates no rule for a group without match text, or an untouched group', () => {
    const noMatch = [trx({ payee: 'Electricity bill paid 1', payeeMatch: null })];
    const g1 = buildPayeeGroups(noMatch);
    assert.deepEqual(toPayeeRules(noMatch, g1, { [g1[0].key]: { category: FOOD } }), []);
    const rows = [trx()];
    assert.deepEqual(toPayeeRules(rows, buildPayeeGroups(rows), {}), []);
  });

  test('passes the exact-match flag through', () => {
    const rows = [trx({ payee: 'AB', payeeMatch: 'Paid to AB', payeeMatchExact: true })];
    const groups = buildPayeeGroups(rows);
    const [rule] = toPayeeRules(rows, groups, { [groups[0].key]: { category: FOOD } });
    assert.equal(rule.match_text, 'Paid to AB');
    assert.equal(rule.exact, true);
  });
});
