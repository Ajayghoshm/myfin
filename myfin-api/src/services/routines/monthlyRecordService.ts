import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { IST_OFFSET_SECONDS, type YearMonth } from '../insights/insightsPrimitives.js';

export type MonthlyRecordKind = 'health' | 'review';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The IST calendar month containing `epoch`. */
export function monthOfIST(epoch: number): YearMonth {
  const d = new Date((epoch + IST_OFFSET_SECONDS) * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** YYYYMM key of a month, as stored in `monthly_records.month`. */
export const monthKey = (ym: YearMonth): number => ym.year * 100 + ym.month;

/** True when `ym` ended before `now` (IST). */
export const isPastMonth = (ym: YearMonth, now: number): boolean => monthKey(ym) < monthKey(monthOfIST(now));

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string })?.code === 'P2002' || /Unique constraint|Duplicate entry/i.test(String(err));

/**
 * The current (or a future) month is computed live and never stored. A past month is computed once,
 * on its first read after it ends, and frozen: a frozen row is returned as is, forever. Two
 * concurrent first reads both end up returning the one stored row.
 */
export async function getOrFreeze<T>(
  userId: bigint,
  ym: YearMonth,
  kind: MonthlyRecordKind,
  compute: () => Promise<T>,
  now: number = nowSeconds()
): Promise<{ data: T; frozen: boolean }> {
  if (!isPastMonth(ym, now)) return { data: await compute(), frozen: false };

  const where = { users_user_id: userId, month: monthKey(ym), kind };
  const key = { users_user_id_month_kind: where };
  const existing = await prisma.monthly_records.findUnique({ where: key });
  if (existing?.frozen_at != null) return { data: existing.data as T, frozen: true };

  const data = await compute();
  const json = data as unknown as Prisma.InputJsonValue;
  const frozenAt = BigInt(nowSeconds());
  if (existing) {
    // A row kept while the month was current (manual inputs): freeze it unless someone beat us to it.
    await prisma.monthly_records.updateMany({ where: { ...where, frozen_at: null }, data: { data: json, frozen_at: frozenAt } });
  } else {
    try {
      await prisma.monthly_records.create({ data: { ...where, data: json, frozen_at: frozenAt } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A concurrent first read stored it; freeze it if it isn't yet (it was a live row).
      await prisma.monthly_records.updateMany({ where: { ...where, frozen_at: null }, data: { data: json, frozen_at: frozenAt } });
    }
  }
  const stored = await prisma.monthly_records.findUniqueOrThrow({ where: key });
  return { data: stored.data as T, frozen: true };
}

export default { getOrFreeze, monthOfIST, monthKey, isPastMonth };
