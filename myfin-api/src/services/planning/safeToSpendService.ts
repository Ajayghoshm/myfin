import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import { emergencyAccountIds } from '../earmarkService.js';
import { getFinancialProfile } from '../financialProfileService.js';
import { cutoffOf, formatYearMonth, salaryRuleFor } from '../insights/analyticsRules.js';
import { IST_OFFSET_SECONDS, monthRangeIST, shiftMonth } from '../insights/insightsPrimitives.js';
import { fetchRows, typicalMonth } from '../insights/typicalMonth.js';
import { emergencyTopupGapCents } from './emergencyFundService.js';
import { yearlySetasideMonthlyCents } from './yearlyCostService.js';

export type SafeToSpend = {
  month: string;
  days_left: number;
  per_day: number;
  safe_to_spend: number;
  expected_income: number;
  income_so_far: number;
  typical_income: number | null;
  spent_so_far: number;
  fixed_still_to_come: number;
  fixed_lines: { category_id: string; name: string; typical: number; spent: number; remaining: number }[];
  /** Still to transfer this month: max(0, target − transferred). */
  savings_target: number;
  yearly_setaside: number;
  emergency_topup: number;
  /** Deducted from safe-to-spend: max(target, transferred) — money already moved out counts as set aside. */
  savings_deducted: number;
  yearly_deducted: number;
  emergency_deducted: number;
  has_fixed_categories: boolean;
};

const DAY = 86_400;

type StoredBucket = { bucket: string; amount: number; account_to_id: string | null };

/** Bucket amounts (cents) and target accounts of the confirmed salary plan for `month` (YYYYMM), if any. */
async function planBuckets(userId: bigint, month: number): Promise<Map<string, StoredBucket> | null> {
  const plan = await prisma.salary_plans.findUnique({
    where: { users_user_id_month: { users_user_id: userId, month } },
    select: { buckets: true },
  });
  if (!plan) return null;
  return new Map((plan.buckets as unknown as StoredBucket[]).map((b) => [b.bucket, b]));
}

/** A set-aside line: what still has to move and what safe-to-spend deducts. */
const setAside = (target: number, transferred: number) => ({
  still: Math.max(0, target - transferred),
  deducted: Math.max(target, transferred),
});

/** Active account id when `id` is set and still an active account of the user, else null. */
async function activeRoleAccount(userId: bigint, id: string | null): Promise<bigint | null> {
  if (id == null) return null;
  const row = await prisma.accounts.findFirst({
    where: { account_id: BigInt(id), users_user_id: userId, status: MYFIN.ACCOUNT_STATUS.ACTIVE },
    select: { account_id: true },
  });
  return row?.account_id ?? null;
}

/** Σ T rows (not adjustments) dated in [from, to) that go into any of `accountIds`, in cents. */
async function transfersInto(userId: bigint, accountIds: bigint[], from: number, to: number): Promise<number> {
  if (accountIds.length === 0) return 0;
  const agg = await prisma.transactions.aggregate({
    _sum: { amount: true },
    where: {
      type: MYFIN.TRX_TYPES.TRANSFER,
      is_adjustment: false,
      accounts_account_to_id: { in: accountIds },
      date_timestamp: { gte: BigInt(from), lt: BigInt(to) },
    },
  });
  return Number(agg._sum.amount ?? 0);
}

export async function safeToSpend(
  userId: bigint,
  now: number = Math.floor(Date.now() / 1000)
): Promise<SafeToSpend> {
  const d = new Date((now + IST_OFFSET_SECONDS) * 1000);
  const ym = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  const range = monthRangeIST(ym);
  const daysLeft = Math.max(1, Math.ceil((range.to - now) / DAY));

  const [typical, rule, profile, yearlyMonthly, gapCents, emergencyIds, fixedCats] = await Promise.all([
    typicalMonth(userId, ym),
    salaryRuleFor(userId),
    getFinancialProfile(userId),
    yearlySetasideMonthlyCents(userId),
    emergencyTopupGapCents(userId, now, ym),
    emergencyAccountIds(userId),
    prisma.categories.findMany({
      where: { users_user_id: userId, is_fixed: true },
      select: { category_id: true, name: true },
      orderBy: { category_id: 'asc' },
    }),
  ]);
  const rows = await fetchRows(userId, [ym], [range], rule);

  const incomeSoFar = rows.filter((r) => r.type === MYFIN.TRX_TYPES.INCOME).reduce((s, r) => s + r.cents, 0);
  const spentRows = rows.filter((r) => r.type === MYFIN.TRX_TYPES.EXPENSE && !r.yearlyCost);
  const spentSoFar = spentRows.reduce((s, r) => s + r.cents, 0);
  const typicalIncome = typical.incomeCents;
  const expectedIncome = Math.max(incomeSoFar, typicalIncome ?? 0);

  const fixedLines = fixedCats
    .map((c) => {
      const id = c.category_id.toString();
      const t = typical.byCategory.get(id);
      const typ = t?.kind === 'fixed' ? t.avgCents : 0;
      const spent = spentRows.filter((r) => r.categoryId === id).reduce((s, r) => s + r.cents, 0);
      return { category_id: id, name: c.name, typical: typ, spent, remaining: Math.max(0, typ - spent) };
    })
    .filter((l) => l.typical > 0);
  const fixedStill = fixedLines.reduce((s, l) => s + l.remaining, 0);

  // Set-aside window (ruling B5): with a salary category, a late salary's plan transfers are dated in
  // the previous month, so month M counts transfers in [cutoff(M−1), cutoff(M)); else the calendar month.
  const window =
    rule.salaryCategoryId == null
      ? range
      : { from: cutoffOf(shiftMonth(ym, -1), rule), to: cutoffOf(ym, rule) };
  const plan = await planBuckets(userId, ym.year * 100 + ym.month);
  const planAccount = (bucket: string): bigint[] => {
    const id = plan?.get(bucket)?.account_to_id;
    return id == null ? [] : [BigInt(id)];
  };
  const moved = (ids: bigint[]) => transfersInto(userId, [...new Set(ids)], window.from, window.to);

  const savingsAccount = await activeRoleAccount(userId, profile.savings_target_account_id);
  const sinkingAccount = await activeRoleAccount(userId, profile.sinking_fund_account_id);
  // Targets (ruling B6): the confirmed plan's bucket for this month when there is one, else the settings.
  const savingsTargetFull =
    plan?.get('savings')?.amount ??
    (profile.savings_target_mode === 'percent'
      ? Math.round((profile.savings_target_value * expectedIncome) / 100)
      : Math.round(profile.savings_target_value * 100));
  const yearlyTarget = plan?.get('yearly')?.amount ?? yearlyMonthly;
  // Same month basis as the salary plan (the effective month); here the cap is a percentage of the
  // expected income, while the plan uses a percentage of the salary itself.
  const emergencyTarget =
    plan?.get('emergency')?.amount ??
    (gapCents > 0 ? Math.min(gapCents, Math.round((profile.emergency_topup_percent * expectedIncome) / 100)) : 0);

  const savings = setAside(
    savingsTargetFull,
    await moved([...(savingsAccount ? [savingsAccount] : []), ...planAccount('savings')])
  );
  const yearly = setAside(
    yearlyTarget,
    await moved([...(sinkingAccount ? [sinkingAccount] : []), ...planAccount('yearly')])
  );
  const emergency = setAside(emergencyTarget, await moved([...emergencyIds, ...planAccount('emergency')]));

  const safe =
    expectedIncome - spentSoFar - fixedStill - savings.deducted - yearly.deducted - emergency.deducted;
  const c = (n: number) => n / 100;
  return {
    month: formatYearMonth(ym),
    days_left: daysLeft,
    per_day: Math.round(safe / daysLeft) / 100,
    safe_to_spend: c(safe),
    expected_income: c(expectedIncome),
    income_so_far: c(incomeSoFar),
    typical_income: typicalIncome == null ? null : c(typicalIncome),
    spent_so_far: c(spentSoFar),
    fixed_still_to_come: c(fixedStill),
    fixed_lines: fixedLines.map((l) => ({
      category_id: l.category_id,
      name: l.name,
      typical: c(l.typical),
      spent: c(l.spent),
      remaining: c(l.remaining),
    })),
    savings_target: c(savings.still),
    yearly_setaside: c(yearly.still),
    emergency_topup: c(emergency.still),
    savings_deducted: c(savings.deducted),
    yearly_deducted: c(yearly.deducted),
    emergency_deducted: c(emergency.deducted),
    has_fixed_categories: fixedCats.length > 0,
  };
}

export default { safeToSpend };
