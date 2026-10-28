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
 * Lets a kind that keeps manual inputs in its row fold the stored (locked, unfrozen) data into the
 * freshly computed data just before the freeze decision and write. `stored` is null when no row exists.
 */
export type MergeBeforeWrite<T> = (stored: unknown | null, computed: T) => T;

/**
 * The current (or a future) month is always computed live and never stored. For a past month, a
 * frozen row is returned as is, forever. Otherwise `compute()` runs; when `shouldFreeze(data, now)`
 * holds (default: always, once the month has ended) the result is stored frozen (`frozen_at = now`),
 * else it is returned live and nothing is stored.
 *
 * The freeze write happens in a transaction holding a row lock (`SELECT … FOR UPDATE`) on the
 * month's row, the same lock manual writers take, so a manual input committed while `compute()` ran
 * is never lost: `mergeBeforeWrite(stored, computed)` runs under the lock, and `shouldFreeze` is
 * judged on its result.
 *
 * Two concurrent first reads both end up returning the one stored row (unique PK; the loser waits on
 * the lock and finds it frozen).
 */
export async function getOrFreeze<T>(
  userId: bigint,
  ym: YearMonth,
  kind: MonthlyRecordKind,
  compute: () => Promise<T>,
  now: number = nowSeconds(),
  shouldFreeze: FreezePolicy<T> = () => true,
  mergeBeforeWrite: MergeBeforeWrite<T> = (_stored, computed) => computed
): Promise<{ data: T; frozen: boolean }> {
  if (!isPastMonth(ym, now)) return { data: await compute(), frozen: false };

  const where = { users_user_id: userId, month: monthKey(ym), kind };
  const key = { users_user_id_month_kind: where };
  const existing = await prisma.monthly_records.findUnique({ where: key });
  if (existing?.frozen_at != null) return { data: existing.data as T, frozen: true };

  const computed = await compute();
  // Lock an existing row, never a gap: two transactions locking the same missing row and then both
  // inserting would deadlock. So a row that is about to be frozen is first ensured (empty placeholder).
  if (!existing && shouldFreeze(mergeBeforeWrite(null, computed), now)) await ensureRow(userId, where.month, kind);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM monthly_records WHERE users_user_id = ${userId} AND month = ${where.month} AND kind = ${kind} FOR UPDATE`;
    const row = await tx.monthly_records.findUnique({ where: key });
    if (row?.frozen_at != null) return { data: row.data as T, frozen: true };
    const data = mergeBeforeWrite(row?.data ?? null, computed);
    if (!shouldFreeze(data, now)) return { data, frozen: false };
    const json = data as unknown as Prisma.InputJsonValue;
    if (!row) await tx.monthly_records.create({ data: { ...where, data: json, frozen_at: BigInt(now) } });
    else await tx.monthly_records.update({ where: key, data: { data: json, frozen_at: BigInt(now) } });
    return { data, frozen: true };
  });
}

/** Inserts an empty unfrozen row unless one exists (a concurrent insert is fine). */
async function ensureRow(userId: bigint, month: number, kind: MonthlyRecordKind): Promise<void> {
  await prisma.monthly_records.createMany({
    data: [{ users_user_id: userId, month, kind, data: {} }],
    skipDuplicates: true,
  });
}

/**
 * Runs `write` while holding the row lock on a month's record (the row is created empty when
 * missing). `write` gets the stored row and returns the new data, or throws to abort; a frozen row
 * is passed through so the writer can reject it.
 */
export async function withRecordLock(
  userId: bigint,
  ym: YearMonth,
  kind: MonthlyRecordKind,
  write: (stored: { data: unknown; frozen: boolean }) => Prisma.InputJsonValue
): Promise<void> {
  const where = { users_user_id: userId, month: monthKey(ym), kind };
  const key = { users_user_id_month_kind: where };
  await ensureRow(userId, where.month, kind);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM monthly_records WHERE users_user_id = ${userId} AND month = ${where.month} AND kind = ${kind} FOR UPDATE`;
    const row = await tx.monthly_records.findUniqueOrThrow({ where: key });
    const data = write({ data: row.data, frozen: row.frozen_at != null });
    await tx.monthly_records.update({ where: key, data: { data } });
  });
}

export default { getOrFreeze, withRecordLock, monthOfIST, monthKey, isPastMonth, graceEnd, freezeAfterGrace, GRACE_DAYS };
