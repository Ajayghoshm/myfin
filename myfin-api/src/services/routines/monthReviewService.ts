import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import APIError from '../../errorHandling/apiError.js';
import { listAccountsWithFreshness } from '../accountFreshnessService.js';
import { formatYearMonth, salaryRuleFor } from '../insights/analyticsRules.js';
import { type YearMonth, monthRangeIST, shiftMonth } from '../insights/insightsPrimitives.js';
import { ownershipSql } from '../insights/typicalMonth.js';
import { structuredFilterSql } from '../transactionService.js';
import { balanceCoverage, beforeData, dataStart } from './healthScoreService.js';
import {
  type FreezePolicy,
  getOrFreeze,
  graceEnd,
  monthKey,
  monthOfIST,
} from './monthlyRecordService.js';

export type ReviewStepKey = 'import' | 'sort' | 'reconcile' | 'planned' | 'review' | 'plan';
export type ReviewStep = {
  key: ReviewStepKey;
  status: 'done' | 'todo' | 'nothing_to_do';
  /** English detail (fallback); `detail_key` + `detail_params` localise it. */
  detail: string;
  detail_key: string;
  detail_params: Record<string, string | number>;
  link: string;
  items?: { id: string; label: string; link: string }[];
};
export type MonthReview = {
  month: string;
  done: number;
  total: 6;
  complete: boolean;
  steps: ReviewStep[];
  frozen: boolean;
};
export type ReviewHistoryEntry = { month: string; done: number; total: 6; complete: boolean; frozen: boolean };

type StoredReview = Omit<MonthReview, 'frozen'> & { reviewed: boolean };

const HISTORY_MONTHS = 12;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const step = (
  key: ReviewStepKey,
  status: ReviewStep['status'],
  detail_key: string,
  detail: string,
  link: string,
  detail_params: ReviewStep['detail_params'] = {},
  items?: ReviewStep['items']
): ReviewStep => ({ key, status, detail, detail_key, detail_params, link, ...(items ? { items } : {}) });

const recordWhere = (userId: bigint, ym: YearMonth) => ({
  users_user_id: userId,
  month: monthKey(ym),
  kind: 'review' as const,
});

async function storedReviewed(userId: bigint, ym: YearMonth): Promise<boolean> {
  const row = await prisma.monthly_records.findFirst({ where: recordWhere(userId, ym) });
  return (row?.data as { reviewed?: boolean } | null)?.reviewed === true;
}

/** Counted uncategorised expenses of M: the Transactions drill-down `month=M&type=E&category=none`. */
async function uncategorisedCount(userId: bigint, ym: YearMonth): Promise<number> {
  const filter = {
    type: MYFIN.TRX_TYPES.EXPENSE,
    categoryId: 'none' as const,
    effectiveMonth: ym,
    salaryRule: await salaryRuleFor(userId),
    excludeAdjustments: true,
  };
  const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT transactions.transaction_id) AS n ${ownershipSql(userId)} ${structuredFilterSql(filter)}`;
  return Number(row?.n ?? 0);
}

async function computeReview(userId: bigint, ym: YearMonth, now: number): Promise<StoredReview> {
  const month = formatYearMonth(ym);
  const range = monthRangeIST(ym);
  const next = shiftMonth(ym, 1);
  const reviewed = await storedReviewed(userId, ym);

  const names = new Map(
    (await prisma.accounts.findMany({ where: { users_user_id: userId }, select: { account_id: true, name: true } })).map(
      (a) => [a.account_id, a.name]
    )
  );

  // 1. import: no active, freshness-enabled account is stale now (nothing to do without any)
  const cov = await balanceCoverage(userId, ym, now);
  const importLink = '/transactions/import';
  const importStep =
    cov.enabled.length === 0
      ? step('import', 'nothing_to_do', 'import_none', 'No account has freshness tracking turned on', '/accounts')
      : cov.stale.length
        ? step(
            'import',
            'todo',
            'import_todo',
            `${plural(cov.stale.length, 'account is', 'accounts are')} stale; import their transactions`,
            importLink,
            { count: cov.stale.length },
            cov.stale.map((a) => ({ id: a.account_id.toString(), label: names.get(a.account_id) ?? '', link: importLink }))
          )
        : step('import', 'done', 'import_done', 'No account is stale', importLink);

  // 2. sort
  const uncategorised = await uncategorisedCount(userId, ym);
  const sortLink = `/transactions?month=${month}&type=E&category=none`;
  const sortStep = uncategorised
    ? step('sort', 'todo', 'sort_todo', `${plural(uncategorised, 'expense has', 'expenses have')} no category`, sortLink, {
        count: uncategorised,
      })
    : step('sort', 'done', 'sort_done', 'Every expense has a category', sortLink);

  // 3. reconcile
  const reconcileLink = '/accounts/balance-check';
  const reconcileStep =
    cov.enabled.length === 0
      ? step('reconcile', 'nothing_to_do', 'reconcile_none', 'No account has freshness tracking turned on', '/accounts')
      : cov.unchecked.length
        ? step(
            'reconcile',
            'todo',
            'reconcile_todo',
            `${plural(cov.unchecked.length, 'account has', 'accounts have')} no balance check for this month`,
            reconcileLink,
            { count: cov.unchecked.length },
            cov.unchecked.map((a) => ({ id: a.account_id.toString(), label: names.get(a.account_id) ?? '', link: reconcileLink }))
          )
        : step('reconcile', 'done', 'reconcile_done', 'Balances are checked', reconcileLink);

  // 4. planned
  const [salaryPlans, planned] = await Promise.all([
    prisma.salary_plans.count({ where: { users_user_id: userId, month: monthKey(ym) } }),
    prisma.planned_transactions.findMany({
      where: { users_user_id: userId, date_timestamp: { gte: range.from, lt: range.to } },
      orderBy: [{ date_timestamp: 'asc' }, { planned_id: 'asc' }],
    }),
  ]);
  const plannedLink = '/transactions?planned=1';
  const plannedStep = planned.length
    ? step(
        'planned',
        'todo',
        'planned_todo',
        `${plural(planned.length, 'planned transfer is', 'planned transfers are')} still open`,
        plannedLink,
        { count: planned.length },
        planned.map((p) => ({ id: p.planned_id.toString(), label: p.description, link: plannedLink }))
      )
    : salaryPlans === 0
      ? step('planned', 'nothing_to_do', 'planned_none', 'No salary plan this month', '/salary-plan/' + month)
      : step('planned', 'done', 'planned_done', 'Every planned transfer is resolved', plannedLink);

  // 5. review (manual)
  const reviewStep = step(
    'review',
    reviewed ? 'done' : 'todo',
    reviewed ? 'review_done' : 'review_todo',
    reviewed ? 'You reviewed Insights' : 'Look through the month in Insights, then tick it off',
    `/insights?month=${month}`
  );

  // 6. plan: a budget exists for M+1
  const budget = await prisma.budgets.count({
    where: { users_user_id: userId, year: next.year, month: next.month },
  });
  const planLink = `/insights?month=${formatYearMonth(next)}#forecast`;
  const planStep = budget
    ? step('plan', 'done', 'plan_done', 'Next month has a budget', planLink)
    : step('plan', 'todo', 'plan_todo', "Create next month's budget", planLink);

  const steps = [importStep, sortStep, reconcileStep, plannedStep, reviewStep, planStep];
  const doneCount = steps.filter((s) => s.status !== 'todo').length;
  return { month, done: doneCount, total: 6, complete: doneCount === 6, steps, reviewed };
}

/** Freeze when complete, or once the month is settled (day 11 of M+1). */
const reviewPolicy =
  (ym: YearMonth): FreezePolicy<StoredReview> =>
  (data, now) =>
    data.complete || now >= graceEnd(ym);

const toReview = ({ reviewed: _r, ...rest }: StoredReview, frozen: boolean): MonthReview => ({ ...rest, frozen });

/**
 * The month-end review of `ym`. Months before the user's data are computed but never stored. The
 * current month is live; a past month freezes when complete or on the first read from day 11 of M+1.
 */
export async function monthReview(userId: bigint, ym: YearMonth, now: number = nowSeconds()): Promise<MonthReview> {
  if (beforeData(ym, await dataStart(userId))) return toReview(await computeReview(userId, ym, now), false);
  const { data, frozen } = await getOrFreeze<StoredReview>(
    userId,
    ym,
    'review',
    () => computeReview(userId, ym, now),
    now,
    reviewPolicy(ym)
  );
  return toReview(data, frozen);
}

/** Step 5. Stored on the (unfrozen) month's row, created when missing; a frozen month → 409. */
export async function setReviewed(userId: bigint, ym: YearMonth, reviewed: boolean): Promise<void> {
  const where = recordWhere(userId, ym);
  const frozen = () => APIError.conflict('This month is frozen; its review can no longer change');
  const existing = await prisma.monthly_records.findFirst({ where });
  if (existing?.frozen_at != null) throw frozen();
  const data = { ...((existing?.data as object | null) ?? {}), reviewed } as Prisma.InputJsonValue;
  if (existing) {
    const res = await prisma.monthly_records.updateMany({ where: { ...where, frozen_at: null }, data: { data } });
    if (res.count === 0) throw frozen();
    return;
  }
  try {
    await prisma.monthly_records.create({ data: { ...where, data } });
  } catch (err) {
    if (!/Unique constraint|Duplicate entry|P2002/i.test(String((err as { code?: string })?.code ?? err))) throw err;
    const res = await prisma.monthly_records.updateMany({ where: { ...where, frozen_at: null }, data: { data } });
    if (res.count === 0) throw frozen();
  }
}

/** The last 12 months, oldest first, ending with the previous month. */
export async function reviewHistory(userId: bigint, now: number = nowSeconds()): Promise<ReviewHistoryEntry[]> {
  const last = shiftMonth(monthOfIST(now), -1);
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) => shiftMonth(last, i - (HISTORY_MONTHS - 1)));
  const frozenRows = await prisma.monthly_records.findMany({
    where: {
      users_user_id: userId,
      kind: 'review',
      frozen_at: { not: null },
      month: { gte: monthKey(months[0]), lte: monthKey(last) },
    },
  });
  const frozen = new Map(frozenRows.map((r) => [r.month, r.data as unknown as StoredReview]));
  const start = await dataStart(userId);
  const out: ReviewHistoryEntry[] = [];
  for (const ym of months) {
    const stored = frozen.get(monthKey(ym));
    if (stored) {
      out.push({ month: stored.month, done: stored.done, total: 6, complete: stored.complete, frozen: true });
    } else if (beforeData(ym, start)) {
      out.push({ month: formatYearMonth(ym), done: 0, total: 6, complete: false, frozen: false });
    } else {
      const r = await monthReview(userId, ym, now);
      out.push({ month: r.month, done: r.done, total: 6, complete: r.complete, frozen: r.frozen });
    }
  }
  return out;
}

export default { monthReview, setReviewed, reviewHistory };
