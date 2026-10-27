import { describe, expect, test } from 'vitest';
import { freshnessFor } from '../../src/services/accountFreshnessService.js';

const DAY = 86400;
const NOW = 1_800_000_000;
const acc = (type: string, stale_after_days: number | null = null, status = 'Ativa') => ({
  type,
  status,
  stale_after_days,
});

describe('freshnessFor', () => {
  test.each([
    ['CHEAC', 7],
    ['WALLET', 7],
    ['MEALAC', 7],
    ['SAVAC', 30],
    ['CREAC', 35],
    ['INVAC', 45],
    ['OTHAC', 45],
  ])('type default for %s is %i days', (type, days) => {
    expect(freshnessFor(acc(type), NOW, NOW).stale_after_days_effective).toBe(days);
  });

  test('0 means never', () => {
    const r = freshnessFor(acc('CHEAC', 0), NOW - 400 * DAY, NOW);
    expect(r.freshness).toBe('never');
    expect(r.stale_after_days_effective).toBeNull();
  });

  test('null uses the type default, stored value overrides it', () => {
    expect(freshnessFor(acc('SAVAC', null), NOW, NOW).stale_after_days_effective).toBe(30);
    expect(freshnessFor(acc('SAVAC', 10), NOW, NOW).stale_after_days_effective).toBe(10);
  });

  test('inactive accounts are inactive, never stale', () => {
    expect(freshnessFor(acc('CHEAC', null, 'Inativa'), null, NOW).freshness).toBe('inactive');
  });

  test('exactly at the limit is fresh, one day more is stale', () => {
    const at = freshnessFor(acc('CHEAC'), NOW - 7 * DAY, NOW);
    expect(at.freshness).toBe('fresh');
    expect(at.days_since_last_transaction).toBe(7);
    const over = freshnessFor(acc('CHEAC'), NOW - 8 * DAY, NOW);
    expect(over.freshness).toBe('stale');
    expect(over.days_since_last_transaction).toBe(8);
  });

  test('no transactions is stale for an active account', () => {
    const r = freshnessFor(acc('CHEAC'), null, NOW);
    expect(r.freshness).toBe('stale');
    expect(r.last_transaction_at).toBeNull();
    expect(r.days_since_last_transaction).toBeNull();
  });
});
