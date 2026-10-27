import { prisma } from '../../config/prisma.js';
import { emergencyAccountIds } from '../earmarkService.js';
import { getFinancialProfile } from '../financialProfileService.js';
import { IST_OFFSET_SECONDS } from '../insights/insightsPrimitives.js';
import { typicalMonth } from '../insights/typicalMonth.js';

export type EmergencyFund = {
  fund: number;
  monthly_fixed: number | null;
  months_covered: number | null;
  target_months: number;
  more_needed: number;
  status: 'red' | 'amber' | 'green' | 'no_accounts' | 'no_fixed';
  accounts: { account_id: string; name: string; balance: number }[];
};

const RED_BELOW_MONTHS = 3;

type Computed = { result: EmergencyFund; gapCents: number };

async function compute(userId: bigint, now: number): Promise<Computed> {
  const profile = await getFinancialProfile(userId);
  const target = profile.emergency_fund_target_months;
  const ids = await emergencyAccountIds(userId);
  const rows = ids.length
    ? await prisma.accounts.findMany({
        where: { account_id: { in: ids } },
        select: { account_id: true, name: true, current_balance: true },
        orderBy: { account_id: 'asc' },
      })
    : [];
  const accounts = rows.map((a) => ({
    account_id: a.account_id.toString(),
    name: a.name,
    cents: Math.max(0, Number(a.current_balance)),
  }));
  const fundCents = accounts.reduce((s, a) => s + a.cents, 0);
  const base = {
    fund: fundCents / 100,
    target_months: target,
    accounts: accounts.map((a) => ({ account_id: a.account_id, name: a.name, balance: a.cents / 100 })),
  };
  if (accounts.length === 0)
    return {
      result: { ...base, monthly_fixed: null, months_covered: null, more_needed: 0, status: 'no_accounts' },
      gapCents: 0,
    };

  // Effective month containing `now` (IST calendar month; salary shifting only affects income rows).
  const d = new Date((now + IST_OFFSET_SECONDS) * 1000);
  const typical = await typicalMonth(userId, { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  const fixedCents = typical.fixedCents;
  if (fixedCents == null || fixedCents <= 0)
    return {
      result: { ...base, monthly_fixed: null, months_covered: null, more_needed: 0, status: 'no_fixed' },
      gapCents: 0,
    };

  const months = fundCents / fixedCents;
  const gapCents = Math.max(0, Math.round(target * fixedCents - fundCents));
  const status = months < RED_BELOW_MONTHS ? 'red' : months < target ? 'amber' : 'green';
  return {
    result: {
      ...base,
      monthly_fixed: fixedCents / 100,
      months_covered: Math.round(months * 10) / 10,
      more_needed: gapCents / 100,
      status,
    },
    gapCents,
  };
}

export async function emergencyFund(
  userId: bigint,
  now: number = Math.floor(Date.now() / 1000)
): Promise<EmergencyFund> {
  return (await compute(userId, now)).result;
}

/** max(0, target * monthly_fixed - fund) in cents; 0 for no_accounts / no_fixed. */
export async function emergencyTopupGapCents(
  userId: bigint,
  now: number = Math.floor(Date.now() / 1000)
): Promise<number> {
  return (await compute(userId, now)).gapCents;
}

export default { emergencyFund, emergencyTopupGapCents };
