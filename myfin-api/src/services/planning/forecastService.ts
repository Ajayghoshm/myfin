import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import APIError from '../../errorHandling/apiError.js';
import { formatYearMonth, salaryRuleFor } from '../insights/analyticsRules.js';
import { IST_OFFSET_SECONDS, type YearMonth, monthRangeIST, shiftMonth } from '../insights/insightsPrimitives.js';
import { fetchRows, typicalMonth } from '../insights/typicalMonth.js';
import BudgetService from '../budgetService.js';

/** ₹100 in cents. */
const ROUND_CENTS = 10_000;
const SEASON_MIN = 0.5;
const SEASON_MAX = 1.5;

export type ForecastLine = {
  category_id: string | null;
  name: string;
  kind: 'fixed' | 'flexible' | 'income';
  amount: number;
  yearly_costs: number;
  seasonal_factor: number | null;
};

export type Forecast = {
  month: string;
  income: number;
  total: number;
  low: number;
  high: number;
  unsorted: number;
  categories: ForecastLine[];
};

export type ForecastMode = 'create' | 'replace' | 'fill_empty';

export type BudgetCompareRow = {
  category_id: string;
  name: string;
  current_debit: number;
  current_credit: number;
  forecast_debit: number;
  forecast_credit: number;
  has_breakdown: boolean;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const round100 = (cents: number) => Math.round(cents / ROUND_CENTS) * ROUND_CENTS;
const currency = (cents: number) => cents / 100;
const YEARLY_NAME = 'Yearly costs';

export function parseForecastMonth(month: string): YearMonth {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month ?? '');
  if (!m) throw APIError.badRequest('month must be YYYY-MM');
  return { year: Number(m[1]), month: Number(m[2]) };
}

const currentMonthIST = (now: number): YearMonth => {
  const d = new Date((now + IST_OFFSET_SECONDS) * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
};

const sdOf = (values: number[]): number => {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
};

/** Same-season factors for flexible categories; empty when last year lacks data in any of the 4 months. */
async function seasonalFactors(userId: bigint, target: YearMonth): Promise<Map<string, number>> {
  const factors = new Map<string, number>();
  const tMinus12 = shiftMonth(target, -12);
  const months = [-3, -2, -1, 0].map((d) => shiftMonth(tMinus12, d));
  const rule = await salaryRuleFor(userId);
  const rows = await fetchRows(userId, months, months.map(monthRangeIST), rule);
  for (let i = 0; i < 4; i++) if (!rows.some((r) => r.monthIdx === i)) return factors;

  const perCat = new Map<string, number[]>();
  for (const r of rows) {
    if (r.type !== MYFIN.TRX_TYPES.EXPENSE || r.yearlyCost || r.categoryId == null) continue;
    const arr = perCat.get(r.categoryId) ?? [0, 0, 0, 0];
    arr[r.monthIdx] += r.cents;
    perCat.set(r.categoryId, arr);
  }
  for (const [id, arr] of perCat) {
    const avg = (arr[0] + arr[1] + arr[2]) / 3;
    if (avg <= 0) continue;
    factors.set(id, Math.min(SEASON_MAX, Math.max(SEASON_MIN, arr[3] / avg)));
  }
  return factors;
}

export async function forecast(
  userId: bigint,
  month: YearMonth,
  now: number = nowSeconds()
): Promise<Forecast> {
  const typical = await typicalMonth(userId, currentMonthIST(now));
  const factors = await seasonalFactors(userId, month);
  const yearly = await prisma.yearly_costs.findMany({
    where: { users_user_id: userId, active: true, due_month: month.month },
  });
  const yearlyByCat = new Map<string | null, number>();
  for (const y of yearly) {
    const key = y.category_id == null ? null : y.category_id.toString();
    yearlyByCat.set(key, (yearlyByCat.get(key) ?? 0) + Number(y.amount));
  }

  const ids = new Set<string>([...typical.byCategory.keys(), ...[...yearlyByCat.keys()].filter((k): k is string => k != null)]);
  const cats = ids.size
    ? await prisma.categories.findMany({
        where: { users_user_id: userId, category_id: { in: [...ids].map((i) => BigInt(i)) } },
        select: { category_id: true, name: true, is_fixed: true },
      })
    : [];
  const catInfo = new Map(cats.map((c) => [c.category_id.toString(), c]));

  const lines: ForecastLine[] = [];
  const sds: number[] = [];
  let income = 0;
  for (const id of ids) {
    const t = typical.byCategory.get(id);
    const info = catInfo.get(id);
    if (!info) continue;
    if (t?.kind === 'income') {
      const amount = round100(t.avgCents);
      income += amount;
      lines.push({ category_id: id, name: info.name, kind: 'income', amount: currency(amount), yearly_costs: 0, seasonal_factor: null });
      continue;
    }
    const kind: 'fixed' | 'flexible' = t ? (t.kind as 'fixed' | 'flexible') : info.is_fixed ? 'fixed' : 'flexible';
    const factor = t && kind === 'flexible' ? (factors.get(id) ?? null) : null;
    const base = t ? t.avgCents * (factor ?? 1) : 0;
    const yc = yearlyByCat.get(id) ?? 0;
    if (t) sds.push(sdOf(t.monthly));
    lines.push({
      category_id: id,
      name: info.name,
      kind,
      amount: currency(round100(base + yc)),
      yearly_costs: currency(yc),
      seasonal_factor: factor,
    });
  }
  const uncategorised = yearlyByCat.get(null) ?? 0;
  if (uncategorised > 0) {
    lines.push({
      category_id: null,
      name: YEARLY_NAME,
      kind: 'fixed',
      amount: currency(round100(uncategorised)),
      yearly_costs: currency(uncategorised),
      seasonal_factor: null,
    });
  }
  const order = { fixed: 0, flexible: 1, income: 2 } as const;
  lines.sort((a, b) => order[a.kind] - order[b.kind] || b.amount - a.amount || a.name.localeCompare(b.name));

  const total = lines.filter((l) => l.kind !== 'income').reduce((s, l) => s + Math.round(l.amount * 100), 0);
  const spread = round100(Math.sqrt(sds.reduce((s, v) => s + v * v, 0)));
  return {
    month: formatYearMonth(month),
    income: currency(income),
    total: currency(total),
    low: currency(total - spread),
    high: currency(total + spread),
    unsorted: currency(round100(typical.unsortedCents ?? 0)),
    categories: lines,
  };
}

type Wanted = { debit?: number; credit?: number; name: string };

/** Budgetable forecast values per category (currency units); uncategorised lines are left out. */
function wantedByCategory(f: Forecast): Map<string, Wanted> {
  const out = new Map<string, Wanted>();
  for (const l of f.categories) {
    if (l.category_id == null) continue;
    const w = out.get(l.category_id) ?? { name: l.name };
    if (l.kind === 'income') w.credit = l.amount;
    else w.debit = l.amount;
    out.set(l.category_id, w);
  }
  return out;
}

async function existingBudget(userId: bigint, ym: YearMonth) {
  return prisma.budgets.findFirst({
    where: { users_user_id: userId, month: ym.month, year: ym.year },
    select: { budget_id: true },
  });
}

export async function budgetCompare(
  userId: bigint,
  month: YearMonth,
  now: number = nowSeconds()
): Promise<{ budget_id: string | null; rows: BudgetCompareRow[] }> {
  const f = await forecast(userId, month, now);
  const budget = await existingBudget(userId, month);
  const alloc = budget
    ? await prisma.budgets_has_categories.findMany({
        where: { budgets_budget_id: budget.budget_id, budgets_users_user_id: userId },
        include: { _count: { select: { breakdown_items: true } } },
      })
    : [];
  const byCat = new Map(alloc.map((a) => [a.categories_category_id.toString(), a]));
  const rows: BudgetCompareRow[] = [];
  for (const [id, w] of wantedByCategory(f)) {
    const a = byCat.get(id);
    rows.push({
      category_id: id,
      name: w.name,
      current_debit: currency(Number(a?.planned_amount_debit ?? 0)),
      current_credit: currency(Number(a?.planned_amount_credit ?? 0)),
      forecast_debit: w.debit ?? 0,
      forecast_credit: w.credit ?? 0,
      has_breakdown: (a?._count.breakdown_items ?? 0) > 0,
    });
  }
  return { budget_id: budget ? budget.budget_id.toString() : null, rows };
}

export async function forecastToBudget(
  userId: bigint,
  month: YearMonth,
  mode: ForecastMode,
  now: number = nowSeconds()
): Promise<{ budget_id: string; skipped_category_ids: string[] }> {
  if (!['create', 'replace', 'fill_empty'].includes(mode)) throw APIError.badRequest('Invalid mode.');
  const f = await forecast(userId, month, now);
  const wanted = wantedByCategory(f);
  const active = await prisma.categories.findMany({
    where: {
      users_user_id: userId,
      status: MYFIN.CATEGORY_STATUS.ACTIVE,
      category_id: { in: [...wanted.keys()].map((i) => BigInt(i)) },
    },
    select: { category_id: true },
  });
  const activeIds = new Set(active.map((c) => c.category_id.toString()));

  return prisma.$transaction(async (tx) => {
    const client = tx as never;
    const existing = await tx.budgets.findFirst({
      where: { users_user_id: userId, month: month.month, year: month.year },
      select: { budget_id: true },
    });
    if (mode === 'create') {
      if (existing) throw APIError.conflict('A budget already exists for this month.');
      const values = [...wanted]
        .filter(([id]) => activeIds.has(id))
        .map(([id, w]) => ({
          category_id: id,
          planned_value_debit: w.debit ?? 0,
          planned_value_credit: w.credit ?? 0,
        }));
      const budgetId = await BudgetService.createBudget(userId, month.month, month.year, values, '', client);
      return { budget_id: budgetId.toString(), skipped_category_ids: [] };
    }
    if (!existing) throw APIError.notFound('No budget exists for this month.');
    const alloc = await tx.budgets_has_categories.findMany({
      where: { budgets_budget_id: existing.budget_id, budgets_users_user_id: userId },
      include: { _count: { select: { breakdown_items: true } } },
    });
    const byCat = new Map(alloc.map((a) => [a.categories_category_id.toString(), a]));
    const skipped: string[] = [];
    for (const [id, w] of wanted) {
      if (!activeIds.has(id)) continue;
      const a = byCat.get(id);
      if ((a?._count.breakdown_items ?? 0) > 0) {
        skipped.push(id);
        continue;
      }
      if (mode === 'fill_empty' && ((a?.planned_amount_debit ?? 0n) !== 0n || (a?.planned_amount_credit ?? 0n) !== 0n))
        continue;
      await BudgetService.updateBudgetCategoryPlannedValues(
        userId,
        existing.budget_id,
        BigInt(id),
        w.debit,
        w.credit,
        client
      );
    }
    return { budget_id: existing.budget_id.toString(), skipped_category_ids: skipped };
  });
}

export default { forecast, budgetCompare, forecastToBudget, parseForecastMonth };
