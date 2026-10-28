import { describe, expect, it } from 'vitest';
import MonthBackupService, { parseMonth } from '../../src/services/monthBackupService.js';

const trx = (over = {}) => ({
  date_timestamp: 1790000000,
  amount: 1000,
  type: 'E',
  description: 'Paid to X',
  is_essential: false,
  is_adjustment: false,
  external_id: null,
  account_from: { name: 'Bank', type: 'CHEAC' },
  account_to: null,
  category: null,
  entity: null,
  tags: [],
  ...over,
});
const file = (transactions: unknown[] = [trx()]) => ({
  format: 'myfin-month-backup',
  month: '2026-10',
  exported_at: 1,
  transactions,
});

describe('parseMonth', () => {
  it('returns the IST epoch range of the month', () => {
    const { from, to } = parseMonth('2026-10');
    expect(from).toBe(Date.UTC(2026, 9, 1) / 1000 - 19800);
    expect(to).toBe(Date.UTC(2026, 10, 1) / 1000 - 19800);
  });
  it.each(['2026-13', '2026-1', 'x', '', undefined])('rejects %s', (m) => {
    expect(() => parseMonth(m)).toThrow();
  });
});

describe('MonthBackupService.validate', () => {
  it('accepts a well-formed file', () => {
    expect(MonthBackupService.validate(file()).transactions).toHaveLength(1);
  });
  it('rejects a full backup or other json', () => {
    expect(() => MonthBackupService.validate({ apiVersion: '5.5.1', accounts: [] })).toThrow();
    expect(() => MonthBackupService.validate(null)).toThrow();
  });
  it.each([
    ['unknown type', trx({ type: 'Z' })],
    ['negative amount', trx({ amount: -1 })],
    ['fractional amount', trx({ amount: 1.5 })],
    ['no account', trx({ account_from: null })],
    ['bad account type', trx({ account_from: { name: 'A', type: 'NOPE' } })],
    ['bad tags', trx({ tags: 'x' })],
  ])('rejects %s', (_label, t) => {
    expect(() => MonthBackupService.validate(file([t]))).toThrow();
  });
});
