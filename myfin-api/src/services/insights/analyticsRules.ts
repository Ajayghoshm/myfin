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

/**
 * Write-offs (#17): balance adjustments that are not debt bookkeeping (loan opening / manual
 * principal rows carry a debt_id), on an account that counts in net worth (active, not investing).
 * Only uses `transactions.*` (plus a subquery), so the list filter can reuse it as the drill-down.
 */
export const writeOffRowSql: Prisma.Sql = Prisma.sql`transactions.type IN ('E','I') AND transactions.is_adjustment = true AND transactions.debt_id IS NULL
  AND COALESCE(transactions.accounts_account_from_id, transactions.accounts_account_to_id) IN
    (SELECT wo_acc.account_id FROM accounts wo_acc WHERE wo_acc.type <> ${MYFIN.ACCOUNT_TYPES.INVESTING} AND wo_acc.status = ${MYFIN.ACCOUNT_STATUS.ACTIVE})`;

/**
 * Prisma `where` mirror of `countsForAnalyticsSql` minus the type check (callers pick E or I):
 * not an adjustment and no debt role other than interest.
 */
export const countingRowWhere = {
  is_adjustment: false,
  OR: [{ debt_role: null }, { debt_role: 'interest' }],
} satisfies Prisma.transactionsWhereInput;

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

/**
 * Savings target as a percent of income (same rule as the web `targetPercent`). 'percent' mode: the
 * value itself (0 -> null). 'amount' mode: value / income x 100, using the month's income, or the
 * typical income when the month has none; null when there is no base. Amounts are in currency.
 */
export function targetPercent(
  mode: 'amount' | 'percent',
  value: number,
  monthIncome: number,
  typicalIncome: number | null
): number | null {
  if (!value) return null;
  if (mode === 'percent') return value;
  const base = monthIncome > 0 ? monthIncome : typicalIncome;
  if (!base || base <= 0) return null;
  return (value / base) * 100;
}
