import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import { emergencyAccountIds } from '../earmarkService.js';
import { getFinancialProfile } from '../financialProfileService.js';
import { formatYearMonth, salaryRuleFor } from '../insights/analyticsRules.js';
import { IST_OFFSET_SECONDS, monthRangeIST } from '../insights/insightsPrimitives.js';
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
  savings_target: number;
  yearly_setaside: number;
  emergency_topup: number;
  has_fixed_categories: boolean;
};

const DAY = 86_400;

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
    emergencyTopupGapCents(userId, now),
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

  const savingsAccount = await activeRoleAccount(userId, profile.savings_target_account_id);
  const sinkingAccount = await activeRoleAccount(userId, profile.sinking_fund_account_id);
  const savingsTargetFull =
    profile.savings_target_mode === 'percent'
      ? Math.round((profile.savings_target_value * expectedIncome) / 100)
      : Math.round(profile.savings_target_value * 100);
  const savingsTarget = Math.max(
    0,
    savingsTargetFull -
      (savingsAccount ? await transfersInto(userId, [savingsAccount], range.from, range.to) : 0)
  );
  const yearlySetaside = Math.max(
    0,
    yearlyMonthly - (sinkingAccount ? await transfersInto(userId, [sinkingAccount], range.from, range.to) : 0)
  );
  const emergencyTarget =
    gapCents > 0 ? Math.min(gapCents, Math.round((profile.emergency_topup_percent * expectedIncome) / 100)) : 0;
  const emergencyTopup = Math.max(
    0,
    emergencyTarget - (await transfersInto(userId, emergencyIds, range.from, range.to))
  );

  const safe = expectedIncome - spentSoFar - fixedStill - savingsTarget - yearlySetaside - emergencyTopup;
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
    savings_target: c(savingsTarget),
    yearly_setaside: c(yearlySetaside),
    emergency_topup: c(emergencyTopup),
    has_fixed_categories: fixedCats.length > 0,
  };
}

export default { safeToSpend };
