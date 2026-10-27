import { Prisma } from '../../generated/prisma/client.js';
import { MYFIN } from '../../consts.js';
import { getFinancialProfile } from '../financialProfileService.js';
import { IST_OFFSET_SECONDS, type YearMonth, monthRangeIST, shiftMonth } from './insightsPrimitives.js';

const DAY_SECONDS = 86_400;

/**
 * Rows that count in analytics: income and expenses, never transfers, balance adjustments or debt
 * principal (lending, borrowing, repayments, loan disbursements). Only an EMI's interest part counts.
 */
export const countsForAnalyticsSql: Prisma.Sql = Prisma.sql`transactions.type IN ('E','I') AND transactions.is_adjustment = false AND (transactions.debt_role IS NULL OR transactions.debt_role = 'interest')`;

export type SalaryRule = { salaryCategoryId: bigint | null; cutoffDay: number };

/** `cutoffDay` is unused while `salaryCategoryId` is null. */
export const NO_SALARY_RULE: SalaryRule = { salaryCategoryId: null, cutoffDay: 25 };

export async function salaryRuleFor(userId: bigint): Promise<SalaryRule> {
  const profile = await getFinancialProfile(userId);
  return {
    salaryCategoryId: profile.salary_category_id == null ? null : BigInt(profile.salary_category_id),
    cutoffDay: profile.salary_cutoff_day,
  };
}

/** Epoch second of IST midnight on the cut-off day of month `ym`. */
export const cutoffOf = (ym: YearMonth, rule: SalaryRule): number =>
  monthRangeIST(ym).from + (rule.cutoffDay - 1) * DAY_SECONDS;

/**
 * Predicate (no leading AND) selecting rows whose effective month is `ym`: calendar rows of `ym`
 * that are not late salary, plus late-salary rows of the previous month. Only uses `transactions.*`.
 */
export function effectiveMonthSql(ym: YearMonth, rule: SalaryRule): Prisma.Sql {
  const { from, to } = monthRangeIST(ym);
  if (rule.salaryCategoryId == null) {
    return Prisma.sql`(transactions.date_timestamp >= ${from} AND transactions.date_timestamp < ${to})`;
  }
  const isSalary = Prisma.sql`(transactions.type = ${MYFIN.TRX_TYPES.INCOME} AND transactions.categories_category_id <=> ${rule.salaryCategoryId})`;
  const prevCutoff = cutoffOf(shiftMonth(ym, -1), rule);
  return Prisma.sql`((transactions.date_timestamp >= ${from} AND transactions.date_timestamp < ${to}
      AND NOT (${isSalary} AND transactions.date_timestamp >= ${cutoffOf(ym, rule)}))
    OR (${isSalary} AND transactions.date_timestamp >= ${prevCutoff} AND transactions.date_timestamp < ${from}))`;
}

/** TS mirror of `effectiveMonthSql`, for bucketing rows that were fetched with raw SQL. */
export function effectiveMonthOf(
  row: { type: string; categoryId: string | null; date: number },
  rule: SalaryRule
): YearMonth {
  const d = new Date((row.date + IST_OFFSET_SECONDS) * 1000);
  const calendar = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  const late =
    rule.salaryCategoryId != null &&
    row.type === MYFIN.TRX_TYPES.INCOME &&
    row.categoryId === rule.salaryCategoryId.toString() &&
    row.date >= cutoffOf(calendar, rule);
  return late ? shiftMonth(calendar, 1) : calendar;
}

export const formatYearMonth = (ym: YearMonth): string =>
  `${ym.year}-${String(ym.month).padStart(2, '0')}`;
