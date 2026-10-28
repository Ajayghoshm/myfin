import { describe, expect, test } from 'vitest';
import { addDays, daysBetween, occurrencesBetween } from '../../src/services/routines/eventDates.js';

describe('occurrencesBetween', () => {
  test('a yearly event on 29 Feb falls on 28 Feb in non-leap years and 29 Feb in leap years', () => {
    const e = { date: '2024-02-29', repeat: 'yearly' };
    expect(occurrencesBetween(e, '2026-01-01', '2026-12-31')).toEqual(['2026-02-28']);
    expect(occurrencesBetween(e, '2027-01-01', '2028-12-31')).toEqual(['2027-02-28', '2028-02-29']);
  });

  test('a monthly event on the 31st clamps to the last day and never skips a month', () => {
    const e = { date: '2026-01-31', repeat: 'monthly' };
    expect(occurrencesBetween(e, '2026-11-01', '2026-12-31')).toEqual(['2026-11-30', '2026-12-31']);
    expect(occurrencesBetween(e, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  test('nothing before the first occurrence; bounds are inclusive', () => {
    const e = { date: '2026-10-15', repeat: 'monthly' };
    expect(occurrencesBetween(e, '2026-09-01', '2026-11-15')).toEqual(['2026-10-15', '2026-11-15']);
    expect(occurrencesBetween(e, '2026-11-16', '2026-12-14')).toEqual([]);
  });

  test('once: a single occurrence on its date', () => {
    const e = { date: '2026-11-02', repeat: 'once' };
    expect(occurrencesBetween(e, '2026-10-28', '2026-11-27')).toEqual(['2026-11-02']);
    expect(occurrencesBetween(e, '2026-11-03', '2027-11-27')).toEqual([]);
  });

  test('yearly across a year boundary', () => {
    const e = { date: '1960-01-05', repeat: 'yearly' };
    expect(occurrencesBetween(e, '2026-12-20', '2027-01-10')).toEqual(['2027-01-05']);
  });

  test('day helpers', () => {
    expect(addDays('2026-10-28', 5)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-28', '2026-11-02')).toBe(5);
  });
});
