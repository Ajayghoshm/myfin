import { Prisma } from '../../generated/prisma/client.js';
import { performDatabaseRequest, prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import APIError from '../../errorHandling/apiError.js';
import { emergencyAccountIds } from '../earmarkService.js';
import { getFinancialProfile } from '../financialProfileService.js';
import { effectiveMonthOf, formatYearMonth, salaryRuleFor } from '../insights/analyticsRules.js';
import type { YearMonth } from '../insights/insightsPrimitives.js';
import { typicalMonth } from '../insights/typicalMonth.js';
import { emergencyTopupGapCents } from './emergencyFundService.js';
import { createPlanned, setOnPlannedResolved } from './plannedTransactionService.js';
import { yearlySetasideMonthlyCents } from './yearlyCostService.js';

const DAY = 86_400;
const TRIGGER_WINDOW_DAYS = 40;
const OVERDUE_DAYS = 15;

export type BucketName = 'fixed' | 'yearly' | 'emergency' | 'savings' | 'free';
export type BucketState = 'none' | 'planned' | 'done' | 'skipped';

export type Bucket = {
  bucket: BucketName;
  /** Decimal currency. May be negative for `free`. */
  amount: number;
  account_to_id: string | null;
  planned_id: string | null;
  state: BucketState;
  transaction_id: string | null;
  overdue: boolean;
};

export type SalaryPlan = {
  state: 'none' | 'proposal' | 'confirmed';
  month: string | null;
  salary: { transaction_id: string; amount: number; date: number } | null;
  buckets: Bucket[];
};

export type ConfirmInput = {
  /** 'YYYY-MM' */
  month: string;
  salary_transaction_id: bigint;
  buckets: { bucket: BucketName; amount: number; account_to_id: bigint | null }[];
};

/** What is persisted in salary_plans.buckets (amount in cents). */
type StoredBucket = {
  bucket: BucketName;
  amount: number;
  account_to_id: string | null;
  planned_id: string | null;
  state: BucketState;
  transaction_id: string | null;
};

const BUCKETS: BucketName[] = ['fixed', 'yearly', 'emergency', 'savings', 'free'];
const TRANSFER_BUCKETS: BucketName[] = ['yearly', 'emergency', 'savings'];
const BUCKET_LABEL: Record<BucketName, string> = {
  fixed: 'fixed costs',
  yearly: 'yearly set-aside',
  emergency: 'emergency fund',
  savings: 'savings',
  free: 'free to spend',
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const toCents = (v: number) => Math.round(v * 100);
const monthInt = (ym: YearMonth) => ym.year * 100 + ym.month;
const ymOfInt = (m: number): YearMonth => ({ year: Math.floor(m / 100), month: m % 100 });

function parseMonth(month: string): YearMonth {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw APIError.badRequest('month must be YYYY-MM');
  return { year: Number(m[1]), month: Number(m[2]) };
}

type SalaryTrx = {
  transaction_id: bigint;
  amount: bigint;
  date_timestamp: bigint;
  accounts_account_to_id: bigint | null;
};

const salaryDto = (t: SalaryTrx | null) =>
  t
    ? { transaction_id: t.transaction_id.toString(), amount: Number(t.amount) / 100, date: Number(t.date_timestamp) }
    : null;

function toBucket(b: StoredBucket, plannedDates: Map<string, number>, now: number): Bucket {
  const date = b.planned_id != null ? plannedDates.get(b.planned_id) : undefined;
  return {
    bucket: b.bucket,
    amount: b.amount / 100,
    account_to_id: b.account_to_id,
    planned_id: b.planned_id,
    state: b.state,
    transaction_id: b.transaction_id,
    overdue: b.state === 'planned' && date != null && date < now - OVERDUE_DAYS * DAY,
  };
}

async function confirmedView(
  plan: Prisma.salary_plansGetPayload<object>,
  now: number
): Promise<SalaryPlan> {
  const stored = plan.buckets as unknown as StoredBucket[];
  const plannedIds = stored.filter((b) => b.state === 'planned' && b.planned_id).map((b) => BigInt(b.planned_id as string));
  const rows = plannedIds.length
    ? await prisma.planned_transactions.findMany({
        where: { planned_id: { in: plannedIds } },
        select: { planned_id: true, date_timestamp: true },
      })
    : [];
  const dates = new Map(rows.map((r) => [r.planned_id.toString(), Number(r.date_timestamp)]));
  const trx = plan.salary_transaction_id
    ? await prisma.transactions.findUnique({ where: { transaction_id: plan.salary_transaction_id } })
    : null;
  return {
    state: 'confirmed',
    month: formatYearMonth(ymOfInt(plan.month)),
    salary: salaryDto(trx),
    buckets: stored.map((b) => toBucket(b, dates, now)),
  };
}

/** Active account of the user, or null. */
async function activeAccountId(userId: bigint, id: string | null): Promise<string | null> {
  if (id == null) return null;
  const row = await prisma.accounts.findFirst({
    where: { account_id: BigInt(id), users_user_id: userId, status: MYFIN.ACCOUNT_STATUS.ACTIVE },
    select: { account_id: true },
  });
  return row ? row.account_id.toString() : null;
}

async function propose(userId: bigint, ym: YearMonth, salary: SalaryTrx, now: number): Promise<SalaryPlan> {
  const profile = await getFinancialProfile(userId);
  const salaryCents = Number(salary.amount);
  const [typical, yearlyCents, gap, emergencyIds, sinkingId, savingsId] = await Promise.all([
    typicalMonth(userId, ym),
    yearlySetasideMonthlyCents(userId),
    emergencyTopupGapCents(userId, now),
    emergencyAccountIds(userId),
    activeAccountId(userId, profile.sinking_fund_account_id),
    activeAccountId(userId, profile.savings_target_account_id),
  ]);
  const fixed = Math.max(0, typical.fixedCents ?? 0);
  const emergency = gap > 0 ? Math.min(gap, Math.round((profile.emergency_topup_percent * salaryCents) / 100)) : 0;
  const savings =
    profile.savings_target_mode === 'percent'
      ? Math.round((profile.savings_target_value * salaryCents) / 100)
      : toCents(profile.savings_target_value);
  const free = salaryCents - fixed - yearlyCents - emergency - savings;
  const make = (bucket: BucketName, cents: number, account: string | null): Bucket => ({
    bucket,
    amount: cents / 100,
    account_to_id: account,
    planned_id: null,
    state: 'none',
    transaction_id: null,
    overdue: false,
  });
  return {
    state: 'proposal',
    month: formatYearMonth(ym),
    salary: salaryDto(salary),
    buckets: [
      make('fixed', fixed, null),
      make('yearly', yearlyCents, sinkingId),
      make('emergency', emergency, emergencyIds[0]?.toString() ?? null),
      make('savings', savings, savingsId),
      make('free', free, null),
    ],
  };
}

const EMPTY: SalaryPlan = { state: 'none', month: null, salary: null, buckets: [] };

/**
 * The earliest salary-category income of the last 40 days whose effective month has no plan gets a
 * proposal; when the latest such month already has a plan, that plan is returned.
 */
export async function currentSalaryPlan(userId: bigint, now: number = nowSeconds()): Promise<SalaryPlan> {
  const rule = await salaryRuleFor(userId);
  if (rule.salaryCategoryId == null) return EMPTY;
  const incomes = await prisma.transactions.findMany({
    where: {
      type: MYFIN.TRX_TYPES.INCOME,
      categories_category_id: rule.salaryCategoryId,
      date_timestamp: { gte: now - TRIGGER_WINDOW_DAYS * DAY, lte: now },
      accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId },
    },
    orderBy: [{ date_timestamp: 'asc' }, { transaction_id: 'asc' }],
  });
  if (incomes.length === 0) return EMPTY;
  const withMonth = incomes.map((t) => ({
    trx: t,
    ym: effectiveMonthOf(
      { type: t.type, categoryId: t.categories_category_id?.toString() ?? null, date: Number(t.date_timestamp) },
      rule
    ),
  }));
  const plans = await prisma.salary_plans.findMany({
    where: { users_user_id: userId, month: { in: [...new Set(withMonth.map((w) => monthInt(w.ym)))] } },
  });
  const planned = new Set(plans.map((p) => p.month));
  const open = withMonth.find((w) => !planned.has(monthInt(w.ym)));
  if (open) return propose(userId, open.ym, open.trx, now);
  const latest = withMonth[withMonth.length - 1];
  const plan = plans.find((p) => p.month === monthInt(latest.ym));
  return plan ? confirmedView(plan, now) : EMPTY;
}

export async function getSalaryPlan(userId: bigint, month: string, now: number = nowSeconds()): Promise<SalaryPlan> {
  const plan = await prisma.salary_plans.findUnique({
    where: { users_user_id_month: { users_user_id: userId, month: monthInt(parseMonth(month)) } },
  });
  if (!plan) throw APIError.notFound('No salary plan for this month');
  return confirmedView(plan, now);
}

export async function confirmSalaryPlan(userId: bigint, input: ConfirmInput): Promise<bigint> {
  const ym = parseMonth(input.month);
  const rule = await salaryRuleFor(userId);
  const salary = await prisma.transactions.findFirst({
    where: {
      transaction_id: input.salary_transaction_id,
      accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId },
    },
  });
  if (
    !salary ||
    rule.salaryCategoryId == null ||
    salary.type !== MYFIN.TRX_TYPES.INCOME ||
    salary.categories_category_id !== rule.salaryCategoryId ||
    salary.accounts_account_to_id == null
  )
    throw APIError.badRequest('The transaction is not a salary income.');
  const eff = effectiveMonthOf(
    { type: salary.type, categoryId: salary.categories_category_id.toString(), date: Number(salary.date_timestamp) },
    rule
  );
  if (monthInt(eff) !== monthInt(ym)) throw APIError.badRequest('The salary does not belong to that month.');

  const byName = new Map<BucketName, ConfirmInput['buckets'][number]>();
  for (const b of input.buckets) {
    if (!BUCKETS.includes(b.bucket) || byName.has(b.bucket)) throw APIError.badRequest('Invalid buckets.');
    if (!Number.isFinite(b.amount) || b.amount < 0) throw APIError.badRequest('Bucket amounts cannot be negative.');
    byName.set(b.bucket, b);
  }
  const accountIds = [
    ...new Set(
      TRANSFER_BUCKETS.map((n) => byName.get(n)?.account_to_id).filter((a): a is bigint => a != null)
    ),
  ];
  if (accountIds.length > 0) {
    const accounts = await prisma.accounts.findMany({
      where: { account_id: { in: accountIds }, users_user_id: userId },
      select: { type: true },
    });
    if (accounts.length !== accountIds.length) throw APIError.notAuthorized();
    if (accounts.some((a) => a.type === MYFIN.ACCOUNT_TYPES.INVESTING))
      throw APIError.badRequest('Investment accounts cannot receive a salary-plan transfer.');
  }

  const salaryCents = Number(salary.amount);
  const cents = (n: BucketName) => toCents(byName.get(n)?.amount ?? 0);
  const free = salaryCents - cents('fixed') - cents('yearly') - cents('emergency') - cents('savings');
  const stored: StoredBucket[] = BUCKETS.map((name) => {
    const accountTo = TRANSFER_BUCKETS.includes(name) ? (byName.get(name)?.account_to_id ?? null) : null;
    return {
      bucket: name,
      amount: name === 'free' ? free : cents(name),
      account_to_id: accountTo?.toString() ?? null,
      planned_id: null,
      state: 'none',
      transaction_id: null,
    };
  });

  return performDatabaseRequest(async (prismaTx) => {
    let plan: Prisma.salary_plansGetPayload<object>;
    try {
      plan = await prismaTx.salary_plans.create({
        data: {
          users_user_id: userId,
          month: monthInt(ym),
          salary_transaction_id: salary.transaction_id,
          salary_amount: salary.amount,
          buckets: stored as unknown as Prisma.InputJsonValue,
          created_at: BigInt(nowSeconds()),
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002' || /Unique constraint|Duplicate entry/i.test(String(e)))
        throw APIError.conflict('A salary plan already exists for this month.');
      throw e;
    }
    const todo = stored.filter((b) => TRANSFER_BUCKETS.includes(b.bucket) && b.amount > 0 && b.account_to_id != null);
    const ids = await createPlanned(
      userId,
      todo.map((b) => ({
        date_timestamp: salary.date_timestamp,
        amount: b.amount,
        type: MYFIN.TRX_TYPES.TRANSFER,
        account_from_id: salary.accounts_account_to_id,
        account_to_id: BigInt(b.account_to_id as string),
        description: `Salary plan: ${BUCKET_LABEL[b.bucket]}`,
        salary_plan_id: plan.salary_plan_id,
        bucket: b.bucket,
      })),
      prismaTx
    );
    todo.forEach((b, i) => {
      b.planned_id = ids[i].toString();
      b.state = 'planned';
    });
    await prismaTx.salary_plans.update({
      where: { salary_plan_id: plan.salary_plan_id },
      data: { buckets: stored as unknown as Prisma.InputJsonValue },
    });
    return plan.salary_plan_id;
  });
}

// A resolved planned row is already deleted when this runs, so find its plan through the bucket JSON.
setOnPlannedResolved(async (plannedId, outcome, transactionId, prismaTx) => {
  const rows = await prismaTx.$queryRaw<{ salary_plan_id: bigint }[]>(
    Prisma.sql`SELECT salary_plan_id FROM salary_plans WHERE JSON_SEARCH(buckets, 'one', ${plannedId.toString()}, NULL, '$[*].planned_id') IS NOT NULL`
  );
  for (const r of rows) {
    const plan = await prismaTx.salary_plans.findUnique({ where: { salary_plan_id: r.salary_plan_id } });
    if (!plan) continue;
    const stored = plan.buckets as unknown as StoredBucket[];
    for (const b of stored) {
      if (b.planned_id !== plannedId.toString()) continue;
      b.state = outcome;
      b.transaction_id = outcome === 'done' && transactionId != null ? transactionId.toString() : null;
    }
    await prismaTx.salary_plans.update({
      where: { salary_plan_id: plan.salary_plan_id },
      data: { buckets: stored as unknown as Prisma.InputJsonValue },
    });
  }
});

export default { currentSalaryPlan, getSalaryPlan, confirmSalaryPlan };
