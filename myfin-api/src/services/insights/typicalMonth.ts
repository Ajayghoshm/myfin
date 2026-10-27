import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import {
  type SalaryRule,
  countsForAnalyticsSql,
  cutoffOf,
  effectiveMonthOf,
  salaryRuleFor,
} from './analyticsRules.js';
import { type YearMonth, monthRangeIST, payeeKeySql, shiftMonth } from './insightsPrimitives.js';

export const BASELINE_MONTHS = 3;
/** ₹10,000 in cents. */
const ONE_OFF_MIN_CENTS = 1_000_000;
/** Key must appear in at least this many baseline months to not be an expense one-off. */
const ONE_OFF_RECURRING_MONTHS = 2;
/** An income row at least this many times the median monthly income is a one-off. */
const INCOME_ONE_OFF_FACTOR = 1.5;

export type TypicalMonth = {
  baselineMonths: number; // 0..3
  incomeCents: number | null;
  spendingCents: number | null;
  fixedCents: number | null;
  flexibleCents: number | null;
  unsortedCents: number | null;
  /** key = category id string; monthly = per baseline month (with data) totals, chronological. */
  byCategory: Map<string, { kind: 'fixed' | 'flexible' | 'income'; avgCents: number; monthly: number[] }>;
  /** Excluded row ids (expense + income one-offs), as decimal strings. */
  oneOffIds: Set<string>;
};

export type Row = {
  id: bigint;
  type: string;
  cents: number;
  date: number;
  categoryId: string | null;
  categoryName: string | null;
  isFixed: boolean;
  fromId: string | null;
  fromName: string | null;
  payeeKey: string;
  /** Linked to a yearly cost: left out of the typical month (the sinking fund covers it). */
  yearlyCost: boolean;
  monthIdx: number; // index into the `months` passed to fetchRows
};

type RawRow = {
  transaction_id: bigint;
  type: string;
  amount: bigint;
  date_timestamp: bigint;
  category_id: bigint | null;
  category_name: string | null;
  is_fixed: number | boolean | null;
  from_id: bigint | null;
  from_name: string | null;
  payee_key: string | null;
  yearly_cost_id: bigint | null;
};

export const ownershipSql = (userId: bigint) => Prisma.sql`FROM transactions
  LEFT JOIN accounts acc_from ON acc_from.account_id = transactions.accounts_account_from_id
  LEFT JOIN accounts acc_to ON acc_to.account_id = transactions.accounts_account_to_id
  LEFT JOIN categories ON categories.category_id = transactions.categories_category_id
  WHERE (acc_from.users_user_id = ${userId} OR acc_to.users_user_id = ${userId})`;

/**
 * Counted rows bucketed by effective month. Fetches from the previous month's cut-off so late
 * salaries that belong to the first month are included; rows outside every month are dropped.
 */
export async function fetchRows(
  userId: bigint,
  months: YearMonth[],
  ranges: Array<{ from: number; to: number }>,
  rule: SalaryRule
): Promise<Row[]> {
  const from =
    rule.salaryCategoryId == null
      ? ranges[0].from
      : Math.min(ranges[0].from, cutoffOf(shiftMonth(months[0], -1), rule));
  const to = ranges[ranges.length - 1].to;
  const raw = await prisma.$queryRaw<RawRow[]>`
    SELECT transactions.transaction_id,
           transactions.type,
           transactions.amount,
           transactions.date_timestamp,
           transactions.categories_category_id AS category_id,
           categories.name                     AS category_name,
           categories.is_fixed                 AS is_fixed,
           transactions.accounts_account_from_id AS from_id,
           acc_from.name                       AS from_name,
           ${payeeKeySql}                      AS payee_key,
           transactions.yearly_cost_id         AS yearly_cost_id
    ${ownershipSql(userId)}
      AND ${countsForAnalyticsSql}
      AND transactions.date_timestamp >= ${from} AND transactions.date_timestamp < ${to}`;

  const rows: Row[] = [];
  for (const r of raw) {
    const date = Number(r.date_timestamp);
    const categoryId = r.category_id == null ? null : r.category_id.toString();
    const eff = effectiveMonthOf({ type: r.type, categoryId, date }, rule);
    const monthIdx = months.findIndex((m) => m.year === eff.year && m.month === eff.month);
    if (monthIdx < 0) continue;
    rows.push({
      id: r.transaction_id,
      type: r.type,
      cents: Number(r.amount),
      date,
      categoryId,
      categoryName: r.category_name,
      isFixed: Number(r.is_fixed) === 1,
      fromId: r.from_id == null ? null : r.from_id.toString(),
      fromName: r.from_name,
      payeeKey: r.payee_key ?? '',
      yearlyCost: r.yearly_cost_id != null,
      monthIdx,
    });
  }
  return rows;
}

const isE = (r: Row) => r.type === MYFIN.TRX_TYPES.EXPENSE;
const isI = (r: Row) => r.type === MYFIN.TRX_TYPES.INCOME;
const total = (rows: Row[]) => rows.reduce((s, r) => s + r.cents, 0);

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Typical month from already-fetched rows; `baselineIdx` are the `monthIdx` values of the baseline
 * months. Also returns the one-off rows and the cleaned baseline rows for callers that need them.
 */
export function computeTypical(rows: Row[], baselineIdx: number[]) {
  const baseline = rows.filter((r) => baselineIdx.includes(r.monthIdx) && !r.yearlyCost);

  // Expense one-offs: big payments to a payee seen in fewer than 2 baseline months.
  const monthsByKey = new Map<string, Set<number>>();
  for (const r of baseline) {
    if (!r.payeeKey) continue;
    const seen = monthsByKey.get(r.payeeKey) ?? new Set<number>();
    seen.add(r.monthIdx);
    monthsByKey.set(r.payeeKey, seen);
  }
  const expenseOneOffs = baseline.filter(
    (r) =>
      isE(r) &&
      r.cents >= ONE_OFF_MIN_CENTS &&
      r.payeeKey !== '' &&
      (monthsByKey.get(r.payeeKey)?.size ?? 0) < ONE_OFF_RECURRING_MONTHS
  );

  // Income one-offs: a single I row >= 1.5 x the median of the monthly income totals
  // (over baseline months that have any income).
  const incomeByMonth = new Map<number, number>();
  for (const r of baseline) if (isI(r)) incomeByMonth.set(r.monthIdx, (incomeByMonth.get(r.monthIdx) ?? 0) + r.cents);
  const incomeOneOffs: Row[] = [];
  if (incomeByMonth.size > 0) {
    const limit = INCOME_ONE_OFF_FACTOR * median([...incomeByMonth.values()]);
    for (const r of baseline) if (isI(r) && r.cents >= limit) incomeOneOffs.push(r);
  }

  const oneOffRows = [...expenseOneOffs, ...incomeOneOffs];
  const oneOffRowIds = new Set(oneOffRows.map((r) => r.id));
  const baselineClean = baseline.filter((r) => !oneOffRowIds.has(r.id));
  const oneOffIds = new Set([...oneOffRowIds].map((id) => id.toString()));

  const monthIdxs = [...new Set(baseline.map((r) => r.monthIdx))].sort((a, b) => a - b);
  const n = monthIdxs.length;

  const typical: TypicalMonth = {
    baselineMonths: n,
    incomeCents: null,
    spendingCents: null,
    fixedCents: null,
    flexibleCents: null,
    unsortedCents: null,
    byCategory: new Map(),
    oneOffIds,
  };
  if (n > 0) {
    const avg = (c: number) => Math.round(c / n);
    const E = baselineClean.filter(isE);
    typical.incomeCents = avg(total(baselineClean.filter(isI)));
    typical.spendingCents = avg(total(E));
    typical.fixedCents = avg(total(E.filter((r) => r.categoryId != null && r.isFixed)));
    typical.flexibleCents = avg(total(E.filter((r) => r.categoryId != null && !r.isFixed)));
    typical.unsortedCents = avg(total(E.filter((r) => r.categoryId == null)));

    const perCat = new Map<string, { kind: 'fixed' | 'flexible' | 'income'; byMonth: Map<number, number> }>();
    for (const r of baselineClean) {
      if (r.categoryId == null) continue;
      const kind = isI(r) ? 'income' : r.isFixed ? 'fixed' : 'flexible';
      const e = perCat.get(r.categoryId) ?? { kind, byMonth: new Map<number, number>() };
      e.byMonth.set(r.monthIdx, (e.byMonth.get(r.monthIdx) ?? 0) + r.cents);
      perCat.set(r.categoryId, e);
    }
    for (const [id, e] of perCat) {
      const monthly = monthIdxs.map((m) => e.byMonth.get(m) ?? 0);
      typical.byCategory.set(id, { kind: e.kind, avgCents: avg(monthly.reduce((s, c) => s + c, 0)), monthly });
    }
  }
  return { baselineN: n, oneOffRows, baselineClean, typical };
}

/** The user's typical month for `ym`: average of the 3 effective months before it that have data. */
export async function typicalMonth(userId: bigint, ym: YearMonth): Promise<TypicalMonth> {
  const months = Array.from({ length: BASELINE_MONTHS }, (_, i) => shiftMonth(ym, i - BASELINE_MONTHS));
  const rule = await salaryRuleFor(userId);
  const rows = await fetchRows(userId, months, months.map(monthRangeIST), rule);
  return computeTypical(
    rows,
    months.map((_, i) => i)
  ).typical;
}
