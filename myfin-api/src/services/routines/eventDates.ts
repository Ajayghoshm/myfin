import { IST_OFFSET_SECONDS } from '../insights/insightsPrimitives.js';

/** Pure calendar helpers for event reminders. Dates are IST calendar days as YYYY-MM-DD. */

export const EVENT_KINDS = ['birthday', 'anniversary', 'wedding', 'rent', 'card_due', 'renewal', 'sip', 'other'] as const;
export const PEOPLE_KINDS: readonly string[] = ['birthday', 'anniversary', 'wedding'];
export const EVENT_REPEATS = ['once', 'monthly', 'yearly'] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (date: string) => ({
  y: Number(date.slice(0, 4)),
  m: Number(date.slice(5, 7)),
  d: Number(date.slice(8, 10)),
});
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The IST calendar day of an epoch second. */
export function istDate(epoch: number): string {
  const d = new Date((epoch + IST_OFFSET_SECONDS) * 1000);
  return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/** `day` in the given month, clamped to the month's last day (31st → 30th, 29 Feb → 28 Feb). */
export const clampedDate = (y: number, m: number, day: number) => fmt(y, m, Math.min(day, daysInMonth(y, m)));

/**
 * The event's occurrence dates within [fromDate, toDate] (inclusive), never before its first date.
 * Monthly and yearly events keep the first date's day, clamped to the month's last day, so a month
 * is never skipped.
 */
export function occurrencesBetween(
  event: { date: string; repeat: string },
  fromDate: string,
  toDate: string
): string[] {
  const lo = event.date > fromDate ? event.date : fromDate;
  if (lo > toDate) return [];
  if (event.repeat === 'once') return event.date >= fromDate ? [event.date] : [];
  const start = parts(event.date);
  const from = parts(lo);
  const to = parts(toDate);
  const out: string[] = [];
  const push = (date: string) => {
    if (date >= lo && date <= toDate) out.push(date);
  };
  if (event.repeat === 'monthly') {
    for (let idx = from.y * 12 + from.m - 1; idx <= to.y * 12 + to.m - 1; idx++) {
      push(clampedDate(Math.floor(idx / 12), (idx % 12) + 1, start.d));
    }
  } else if (event.repeat === 'yearly') {
    for (let y = from.y; y <= to.y; y++) push(clampedDate(y, start.m, start.d));
  }
  return out;
}

/** The latest occurrence on or before `date`, or null (searches back up to two years). */
export function lastOccurrenceOnOrBefore(event: { date: string; repeat: string }, date: string): string | null {
  const list = occurrencesBetween(event, addDays(date, -731), date);
  return list.length ? list[list.length - 1] : null;
}

/** The first occurrence on or after `date`, or null (searches up to two years ahead). */
export function nextOccurrenceOnOrAfter(event: { date: string; repeat: string }, date: string): string | null {
  return occurrencesBetween(event, date, addDays(date, 731))[0] ?? null;
}

/** Whether `date` is one of the event's occurrences. */
export const isOccurrence = (event: { date: string; repeat: string }, date: string) =>
  occurrencesBetween(event, date, date).length === 1;
