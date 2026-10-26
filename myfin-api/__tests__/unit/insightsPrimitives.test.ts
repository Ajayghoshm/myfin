import { describe, expect, it } from 'vitest';
import {
  BUSINESS_WORDS,
  PERSON_PREFIX_SQL,
  guessIsPerson,
  monthRangeIST,
  payeeKeySql,
  shiftMonth,
} from '../../src/services/insights/insightsPrimitives.js';

describe('monthRangeIST', () => {
  it('returns IST epoch-second bounds', () => {
    const r = monthRangeIST({ year: 2026, month: 10 });
    expect(r.from).toBe(Date.UTC(2026, 9, 1) / 1000 - 19800);
    expect(r.to).toBe(Date.UTC(2026, 10, 1) / 1000 - 19800);
  });
  it('puts 2026-11-01 00:30 IST in November', () => {
    const epoch = Date.UTC(2026, 10, 1, 0, 30) / 1000 - 19800;
    expect(epoch).toBeGreaterThanOrEqual(monthRangeIST({ year: 2026, month: 11 }).from);
    expect(epoch).toBeGreaterThanOrEqual(monthRangeIST({ year: 2026, month: 10 }).to);
  });
});

describe('shiftMonth', () => {
  it('crosses year boundaries', () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 10 }, -12)).toEqual({ year: 2025, month: 10 });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });
});

describe('guessIsPerson', () => {
  it('guesses', () => {
    expect(guessIsPerson('ACHAN', { hasPersonPrefix: false, hasRoundPaymentOver1000: true })).toBe(true);
    expect(guessIsPerson('SWIGGY', { hasPersonPrefix: true, hasRoundPaymentOver1000: true })).toBe(false);
    expect(
      guessIsPerson('MEMORIES HOSPITALITY SERVICES', { hasPersonPrefix: false, hasRoundPaymentOver1000: true }),
    ).toBe(false);
    expect(guessIsPerson('ABDESH KUMAR', { hasPersonPrefix: false, hasRoundPaymentOver1000: false })).toBe(false);
    expect(guessIsPerson('UTTHARA M', { hasPersonPrefix: true, hasRoundPaymentOver1000: false })).toBe(true);
    expect(guessIsPerson('', { hasPersonPrefix: true, hasRoundPaymentOver1000: true })).toBe(false);
  });
  it('matches whole words only', () => {
    expect(guessIsPerson('CAFEINE RAO', { hasPersonPrefix: true, hasRoundPaymentOver1000: false })).toBe(true);
  });
  it('splits on punctuation as well as whitespace', () => {
    const sig = { hasPersonPrefix: true, hasRoundPaymentOver1000: true };
    expect(guessIsPerson('ABC PVT. LTD.', sig)).toBe(false);
    expect(guessIsPerson('XYZ & CO.', sig)).toBe(false);
  });
  it('has expected business words', () => {
    for (const w of ['PVT', 'LTD', 'CAFE', 'SWIGGY', 'ZOMATO', 'NETFLIX']) expect(BUSINESS_WORDS).toContain(w);
  });
});

describe('SQL fragments', () => {
  it('are Prisma.Sql values', () => {
    expect(payeeKeySql.sql).toContain('REGEXP_REPLACE');
    expect(payeeKeySql.sql).toContain('PAID TO');
    expect(PERSON_PREFIX_SQL.sql).toContain('LIKE');
  });
});
