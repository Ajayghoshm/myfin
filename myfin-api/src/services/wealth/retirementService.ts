import { prisma } from '../../config/prisma.js';
import { MYFIN } from '../../consts.js';
import APIError from '../../errorHandling/apiError.js';
import { type YearMonth, IST_OFFSET_SECONDS } from '../insights/insightsPrimitives.js';
import { typicalMonth } from '../insights/typicalMonth.js';
import { getFinancialProfile, updateFinancialProfile } from '../financialProfileService.js';
import { yearlySetasideMonthlyCents } from '../planning/yearlyCostService.js';
import { balancesAt, investValuesAt } from './netWorthService.js';
import {
  type ProjectionRow,
  type RetirementInputs,
  ageOn,
  corpusNeeded,
  extraMonthlyNeeded,
  onTrackAge,
  projection,
} from './retirementMath.js';

/** Retirement / FIRE calculator (spec #5): settings + corpus + savings target → figures and a projection. */

export type RetirementOverrides = {
  returnPct?: number;
  inflationPct?: number;
  swrPct?: number;
  retirementAge?: number;
  monthlyInvestment?: number;
};

export type RetirementMissing = 'date_of_birth' | 'spending_history' | 'swr' | 'retirement_age';

export type RetirementResult = {
  inputs: {
    age: number | null;
    retirement_age: number;
    annual_spending_today: number | null;
    spending_basis: 'all' | 'fixed';
    return_pct: number;
    inflation_pct: number;
    swr_pct: number;
    family_support_monthly: number;
    family_support_years: number;
    current_corpus: number;
    monthly_investment: number;
  };
  missing: RetirementMissing[];
  corpus_needed: { future: number; today: number } | null;
  on_track_age: number | null;
  extra_monthly_needed: number | null;
  projection: ProjectionRow[];
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const money = (v: number) => Math.round(v * 100) / 100;
const currentMonthIST = (now: number): YearMonth => {
  const d = new Date((now + IST_OFFSET_SECONDS) * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
};

/**
 * Σ active ticked non-investing account balances as of `now` (rows dated before it, as in
 * netWorthAt; negatives as 0) + Σ ticked assets' latest value, in currency.
 */
async function currentCorpus(userId: bigint, now: number): Promise<number> {
  const [accounts, assets] = await Promise.all([
    prisma.accounts.findMany({
      where: {
        users_user_id: userId,
        is_retirement: true,
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        type: { not: MYFIN.ACCOUNT_TYPES.INVESTING },
      },
      select: { account_id: true },
    }),
    prisma.invest_assets.findMany({
      where: { users_user_id: userId, is_retirement: true },
      select: { asset_id: true },
    }),
  ]);
  const [balances, [assetCents]] = await Promise.all([
    balancesAt(
      accounts.map((a) => a.account_id),
      [now]
    ),
    investValuesAt(
      userId,
      [now],
      assets.map((a) => a.asset_id)
    ),
  ]);
  let accountCents = 0;
  for (const series of balances.values()) accountCents += Math.max(0, series[0]);
  return (accountCents + assetCents) / 100;
}

export async function getRetirement(
  userId: bigint,
  opts: { overrides?: RetirementOverrides; now?: number } = {}
): Promise<RetirementResult> {
  const now = opts.now ?? nowSeconds();
  const o = opts.overrides ?? {};
  const profile = await getFinancialProfile(userId);
  const typical = await typicalMonth(userId, currentMonthIST(now));

  const age = profile.date_of_birth ? ageOn(profile.date_of_birth, now) : null;
  const basis = profile.retirement_spending_basis;
  // Ruling D8: "everything" includes yearly costs, which the typical month leaves out
  const monthlySpending =
    basis === 'fixed'
      ? typical.fixedCents
      : typical.spendingCents == null
        ? null
        : typical.spendingCents + (await yearlySetasideMonthlyCents(userId));
  const annualSpending = monthlySpending == null ? null : money((monthlySpending * 12) / 100);

  const savingsMonthly =
    profile.savings_target_mode === 'percent'
      ? ((typical.incomeCents ?? 0) / 100) * (profile.savings_target_value / 100)
      : profile.savings_target_value;

  const retirementAge = o.retirementAge ?? profile.retirement_age;
  const returnPct = o.returnPct ?? profile.expected_return_pct;
  const inflationPct = o.inflationPct ?? profile.inflation_pct;
  const swrPct = o.swrPct ?? profile.swr_pct;
  const monthlyInvestment = money(o.monthlyInvestment ?? savingsMonthly);
  const corpus = money(await currentCorpus(userId, now));

  const missing: RetirementMissing[] = [];
  if (age === null) missing.push('date_of_birth');
  if (annualSpending === null) missing.push('spending_history');
  if (!(swrPct > 0)) missing.push('swr');
  if (age !== null && retirementAge <= age) missing.push('retirement_age');

  const inputs: RetirementResult['inputs'] = {
    age,
    retirement_age: retirementAge,
    annual_spending_today: annualSpending,
    spending_basis: basis,
    return_pct: returnPct,
    inflation_pct: inflationPct,
    swr_pct: swrPct,
    family_support_monthly: profile.family_support_monthly,
    family_support_years: profile.family_support_years,
    current_corpus: corpus,
    monthly_investment: monthlyInvestment,
  };
  if (missing.length > 0 || age === null || annualSpending === null)
    return { inputs, missing, corpus_needed: null, on_track_age: null, extra_monthly_needed: null, projection: [] };

  const calc: RetirementInputs = {
    age,
    retirementAge,
    annualSpendingToday: annualSpending,
    returnPct,
    inflationPct,
    swrPct,
    familySupportMonthly: profile.family_support_monthly,
    familySupportYears: profile.family_support_years,
    currentCorpus: corpus,
    monthlyInvestment,
  };
  const needed = corpusNeeded(calc);
  return {
    inputs,
    missing,
    corpus_needed: { future: money(needed.future), today: money(needed.today) },
    on_track_age: onTrackAge(calc),
    extra_monthly_needed: money(extraMonthlyNeeded(calc)),
    projection: projection(calc).map((p) => ({ age: p.age, corpus: money(p.corpus), needed: money(p.needed) })),
  };
}

/** Persists the overrides that map to settings; monthlyInvestment becomes an amount-mode savings target. */
export async function saveWhatIf(userId: bigint, overrides: RetirementOverrides, now: number = nowSeconds()) {
  const profile = await getFinancialProfile(userId);
  const age = profile.date_of_birth ? ageOn(profile.date_of_birth, now) : null;
  if (overrides.retirementAge !== undefined && age !== null && overrides.retirementAge <= age)
    throw APIError.badRequest('retirement_age must be above your current age.');
  return updateFinancialProfile(userId, {
    ...(overrides.returnPct !== undefined && { expected_return_pct: overrides.returnPct }),
    ...(overrides.inflationPct !== undefined && { inflation_pct: overrides.inflationPct }),
    ...(overrides.swrPct !== undefined && { swr_pct: overrides.swrPct }),
    ...(overrides.retirementAge !== undefined && { retirement_age: overrides.retirementAge }),
    ...(overrides.monthlyInvestment !== undefined && {
      savings_target_mode: 'amount' as const,
      savings_target_value: overrides.monthlyInvestment,
    }),
  });
}

export default { getRetirement, saveWhatIf };
