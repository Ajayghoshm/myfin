import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { IST_OFFSET_SECONDS, type YearMonth, monthRangeIST, shiftMonth } from '../insights/insightsPrimitives.js';

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

/** Days of M+1 during which M's balance checks still count; M settles at the start of day 11. */
export const GRACE_DAYS = 10;

/** Start of day 11 (IST) of the month after `ym`: from then on M is settled. */
export const graceEnd = (ym: YearMonth): number => monthRangeIST(shiftMonth(ym, 1)).from + GRACE_DAYS * 86_400;

/**
 * Decides, for a past month that has no frozen row yet, whether the freshly computed `data` is to be
 * frozen now. Task-specific: health freezes from day 11 of M+1; the review also when complete.
 */
export type FreezePolicy<T> = (data: T, now: number) => boolean;

/** Freeze on the first read on/after day 11 (IST) of M+1. */
export const freezeAfterGrace =
  (ym: YearMonth): FreezePolicy<unknown> =>
  (_data, now) =>
    now >= graceEnd(ym);

/**
 * The current (or a future) month is always computed live and never stored. For a past month, a
 * frozen row is returned as is, forever. Otherwise `compute()` runs; when `shouldFreeze(data, now)`
 * holds (default: always, once the month has ended) the result is stored frozen (`frozen_at = now`),
 * else it is returned live and nothing is stored.
 *
 * Freezing REPLACES any stored, unfrozen row's data with `compute()`'s output, so a `compute` for a
 * kind that keeps manual inputs in that row must read and merge them itself.
 *
 * Two concurrent first reads both end up returning the one stored row (unique PK; on conflict the
 * stored row is re-read).
 */
export async function getOrFreeze<T>(
  userId: bigint,
  ym: YearMonth,
  kind: MonthlyRecordKind,
  compute: () => Promise<T>,
  now: number = nowSeconds(),
  shouldFreeze: FreezePolicy<T> = () => true
): Promise<{ data: T; frozen: boolean }> {
  if (!isPastMonth(ym, now)) return { data: await compute(), frozen: false };

  const where = { users_user_id: userId, month: monthKey(ym), kind };
  const key = { users_user_id_month_kind: where };
  const existing = await prisma.monthly_records.findUnique({ where: key });
  if (existing?.frozen_at != null) return { data: existing.data as T, frozen: true };

  const data = await compute();
  if (!shouldFreeze(data, now)) return { data, frozen: false };
  const json = data as unknown as Prisma.InputJsonValue;
  const frozenAt = BigInt(now);
  if (existing) {
    // A row kept while the month was live (manual inputs): freeze it unless someone beat us to it.
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
  return { data: stored.data as T, frozen: stored.frozen_at != null };
}

export default { getOrFreeze, monthOfIST, monthKey, isPastMonth, graceEnd, freezeAfterGrace, GRACE_DAYS };
