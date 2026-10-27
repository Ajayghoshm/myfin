import { describe, expect, test } from 'vitest';
import { emiFor, firstEmiDate, prepaymentWhatIf, schedule } from '../../src/services/debts/loanMath.js';

describe('loanMath', () => {
  test('emiFor uses the standard amortisation formula, rounded to the cent', () => {
    expect(emiFor(12000000, 12, 12)).toBe(1066185);
  });

  test('emiFor at 0 % is the principal over the months, rounded up to the cent', () => {
    expect(emiFor(1200000, 0, 10)).toBe(120000);
    expect(emiFor(1000000, 0, 3)).toBe(333334);
  });

  test('schedule splits each EMI into interest and principal and ends at 0', () => {
    const rows = schedule(12000000, 12, 12, emiFor(12000000, 12, 12), '2026-10-05');
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ n: 1, date: '2026-10-05', emi: 1066185, interest: 120000, principal: 946185 });
    expect(rows[0].balance).toBe(12000000 - 946185);
    expect(rows[11].balance).toBe(0);
    expect(rows[11].date).toBe('2027-09-05');
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBe(12000000);
    for (const r of rows) expect(r.emi).toBe(r.interest + r.principal);
  });

  test('schedule at 0 % has no interest', () => {
    const rows = schedule(1200000, 0, 10, emiFor(1200000, 0, 10), '2026-01-31');
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.interest === 0 && r.emi === 120000)).toBe(true);
    expect(rows[9].balance).toBe(0);
  });

  test('schedule clamps the EMI day to the month length and keeps the nominal day', () => {
    const rows = schedule(300000, 0, 3, 100000, '2026-01-31', 31);
    expect(rows.map((r) => r.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  test('firstEmiDate is the start month on the EMI day, clamped', () => {
    expect(firstEmiDate(2026, 2, 31)).toBe('2026-02-28');
    expect(firstEmiDate(2026, 10, 5)).toBe('2026-10-05');
  });

  test('prepaymentWhatIf at 0 % saves whole EMIs and no interest', () => {
    const rows = schedule(1200000, 0, 10, 120000, '2026-01-05');
    expect(prepaymentWhatIf(rows, 2, 240000)).toMatchObject({ months_saved: 2, interest_saved: 0 });
    expect(prepaymentWhatIf(rows, 2, 240000).new_end_date).toBe('2026-08-05');
  });

  test('prepaymentWhatIf at 12 % saves months and interest', () => {
    const rows = schedule(12000000, 12, 12, emiFor(12000000, 12, 12), '2026-10-05');
    const r = prepaymentWhatIf(rows, 3, 2000000);
    expect(r.months_saved).toBeGreaterThanOrEqual(1);
    expect(r.interest_saved).toBeGreaterThan(0);
    expect(Number.isFinite(r.interest_saved)).toBe(true);
  });

  test('prepaymentWhatIf paying off everything saves every remaining EMI', () => {
    const rows = schedule(1200000, 0, 10, 120000, '2026-01-05');
    expect(prepaymentWhatIf(rows, 2, 5000000)).toMatchObject({
      months_saved: 8,
      interest_saved: 0,
      new_end_date: '2026-02-05',
    });
  });
});
