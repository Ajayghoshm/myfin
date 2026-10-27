import { describe, expect, test } from 'vitest';
import {
  type RetirementInputs,
  corpusNeeded,
  extraMonthlyNeeded,
  onTrackAge,
  projection,
} from '../../src/services/wealth/retirementMath.js';

const base: RetirementInputs = {
  age: 30,
  retirementAge: 60,
  annualSpendingToday: 600000,
  returnPct: 10,
  inflationPct: 6,
  swrPct: 3.5,
  familySupportMonthly: 0,
  familySupportYears: 0,
  currentCorpus: 0,
  monthlyInvestment: 0,
};

describe('retirementMath', () => {
  test('corpus needed without family support', () => {
    const c = corpusNeeded(base);
    expect(Math.round(c.today)).toBe(17142857);
    expect(Math.round(c.future)).toBe(Math.round((600000 / 0.035) * 1.06 ** 30));
  });

  test('family support: closed form and the r == g limit', () => {
    const fam = { ...base, familySupportMonthly: 10000, familySupportYears: 10 };
    const without = corpusNeeded(base).future;
    const a = 12 * 10000 * 1.06 ** 30;
    const withFam = corpusNeeded(fam).future;
    expect(withFam - without).toBeCloseTo((a * (1 - (1.06 / 1.1) ** 10)) / 0.04, 0);
    const limit = corpusNeeded({ ...fam, returnPct: 6 });
    expect(Number.isFinite(limit.future)).toBe(true);
    expect(limit.future - corpusNeeded({ ...base, returnPct: 6 }).future).toBeCloseTo((a * 10) / 1.06, 0);
  });

  test('no NaN or Infinity', () => {
    for (const r of [0, 6, 10]) {
      for (const g of [0, 6]) {
        const i = { ...base, returnPct: r, inflationPct: g, familySupportMonthly: 5000, familySupportYears: 7 };
        const c = corpusNeeded(i);
        expect(Number.isFinite(c.future) && Number.isFinite(c.today)).toBe(true);
        expect(Number.isFinite(extraMonthlyNeeded(i))).toBe(true);
        expect(projection(i).every((p) => Number.isFinite(p.corpus) && Number.isFinite(p.needed))).toBe(true);
      }
    }
  });

  test('projection rows run from the current age to 90', () => {
    const rows = projection({ ...base, currentCorpus: 100, monthlyInvestment: 10 });
    expect(rows[0]).toMatchObject({ age: 30, corpus: 100 });
    expect(rows[1].corpus).toBeCloseTo(100 * 1.1 + 120, 6);
    expect(rows[rows.length - 1].age).toBe(90);
  });

  test('nothing saved: never on track and extra needed', () => {
    expect(onTrackAge(base)).toBeNull();
    expect(extraMonthlyNeeded(base)).toBeGreaterThan(0);
  });

  test('a large corpus is on track now and needs nothing extra', () => {
    const rich = { ...base, currentCorpus: 1e12 };
    expect(onTrackAge(rich)).toBe(30);
    expect(extraMonthlyNeeded(rich)).toBe(0);
  });

  test('extra monthly closes the gap, with and without return', () => {
    for (const returnPct of [10, 0]) {
      const i = { ...base, returnPct, inflationPct: 6 };
      const extra = extraMonthlyNeeded(i);
      const filled = projection({ ...i, monthlyInvestment: extra }).find((p) => p.age === 60);
      expect(filled?.corpus).toBeCloseTo(corpusNeeded(i).future, -1);
    }
  });
});
