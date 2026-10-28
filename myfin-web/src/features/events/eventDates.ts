/** IST calendar-day helpers mirroring the API's event schedule (dates are YYYY-MM-DD). */

const IST_OFFSET_SECONDS = 19800;
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();
const clamped = (y: number, m: number, day: number) =>
  fmt(y, m, Math.min(day, daysInMonth(y, m)));

/** The IST calendar day of an epoch second. */
export function istDate(epoch: number): string {
  const d = new Date((epoch + IST_OFFSET_SECONDS) * 1000);
  return fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Occurrence dates in [from, to]; monthly / yearly clamp to the month's last day. */
export function occurrencesBetween(
  event: { date: string; repeat: string },
  from: string,
  to: string,
): string[] {
  const lo = event.date > from ? event.date : from;
  if (lo > to) return [];
  if (event.repeat === 'once') return event.date >= from ? [event.date] : [];
  const [, , startDay] = event.date.split('-').map(Number);
  const startMonth = Number(event.date.slice(5, 7));
  const [fy, fm] = lo.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out: string[] = [];
  const push = (d: string) => {
    if (d >= lo && d <= to) out.push(d);
  };
  if (event.repeat === 'monthly') {
    for (let i = fy * 12 + fm - 1; i <= ty * 12 + tm - 1; i++)
      push(clamped(Math.floor(i / 12), (i % 12) + 1, startDay));
  } else {
    for (let y = fy; y <= ty; y++) push(clamped(y, startMonth, startDay));
  }
  return out;
}
