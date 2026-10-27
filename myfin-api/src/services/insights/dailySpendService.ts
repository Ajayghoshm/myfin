import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import APIError from '../../errorHandling/apiError.js';
import { structuredFilterSql } from '../transactionService.js';
import { countsForAnalyticsSql } from './analyticsRules.js';
import { IST_OFFSET_SECONDS, dayStartIST } from './insightsPrimitives.js';
import { ownershipSql } from './typicalMonth.js';

export type DailySpend = {
  from: string;
  to: string;
  flexible_only: boolean;
  /** Only days with spending, ascending. */
  days: { date: string; total: number; count: number }[];
  /** Index 0 = Monday … 6 = Sunday: total on that weekday ÷ number of such weekdays in [from, min(to, today IST)]. */
  weekday_avg: number[];
  /** 4 cut points over non-zero day totals (20/40/60/80 %) for 5 shades. */
  quantiles: number[];
};

export const MAX_DAILY_RANGE_DAYS = 400;
const DAY = 86_400;
const money = (cents: number) => Math.round(cents) / 100;

const isoDay = (epochDays: number) => new Date(epochDays * DAY * 1000).toISOString().slice(0, 10);

/** Linear-interpolated quantile of an ascending array. */
const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Validates `from`/`to` (real dates, from ≤ to, ≤ 400 days inclusive); returns start epoch and day count. */
export function validateDailyRange(from: string, to: string): { start: number; days: number } {
  const start = dayStartIST(from);
  const end = dayStartIST(to);
  if (start == null || end == null) throw APIError.badRequest('from and to must be valid dates (YYYY-MM-DD)');
  if (end < start) throw APIError.badRequest('from must not be after to');
  const days = Math.round((end - start) / DAY) + 1;
  if (days > MAX_DAILY_RANGE_DAYS) {
    throw APIError.badRequest(`The range may span at most ${MAX_DAILY_RANGE_DAYS} days`);
  }
  return { start, days };
}

/** Counted expenses per IST calendar day (no salary shift). `to` is inclusive. */
export async function dailySpend(
  userId: bigint,
  from: string,
  to: string,
  flexibleOnly: boolean,
  now: number = Math.floor(Date.now() / 1000)
): Promise<DailySpend> {
  const { start, days: spanDays } = validateDailyRange(from, to);
  const end = start + spanDays * DAY;
  const flexible = flexibleOnly ? structuredFilterSql({ costKind: 'flexible' }) : Prisma.empty;

  const raw = await prisma.$queryRaw<{ day_no: bigint; total: bigint; cnt: bigint }[]>`
    SELECT FLOOR((transactions.date_timestamp + ${IST_OFFSET_SECONDS}) / ${DAY}) AS day_no,
           SUM(transactions.amount) AS total,
           COUNT(*) AS cnt
    ${ownershipSql(userId)}
      AND ${countsForAnalyticsSql}
      AND transactions.type = 'E'
      AND transactions.date_timestamp >= ${start} AND transactions.date_timestamp < ${end}
      ${flexible}
    GROUP BY day_no
    ORDER BY day_no`;

  const days = raw.map((r) => ({
    date: isoDay(Number(r.day_no)),
    total: money(Number(r.total)),
    count: Number(r.cnt),
  }));

  // Weekday averages over the calendar days in [from, min(to, today IST)]; future days are not counted.
  const firstDayNo = Math.floor((start + IST_OFFSET_SECONDS) / DAY);
  const todayNo = Math.floor((now + IST_OFFSET_SECONDS) / DAY);
  const countedDays = Math.max(0, Math.min(spanDays, todayNo - firstDayNo + 1));
  const weekdayCount = new Array<number>(7).fill(0);
  for (let i = 0; i < countedDays; i++) weekdayCount[(firstDayNo + i + 3) % 7] += 1; // epoch day 0 = Thursday
  const weekdayTotal = new Array<number>(7).fill(0);
  for (const r of raw.filter((r) => Number(r.day_no) <= todayNo)) weekdayTotal[(Number(r.day_no) + 3) % 7] += Number(r.total);
  const weekday_avg = weekdayTotal.map((t, i) => (weekdayCount[i] > 0 ? money(t / weekdayCount[i]) : 0));

  const sorted = days.map((d) => d.total).sort((a, b) => a - b);
  const quantiles = sorted.length === 0 ? [] : [0.2, 0.4, 0.6, 0.8].map((q) => money(quantile(sorted, q) * 100));

  return { from, to, flexible_only: flexibleOnly, days, weekday_avg, quantiles };
}
