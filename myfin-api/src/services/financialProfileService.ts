import { prisma } from '../config/prisma.js';
import APIError from '../errorHandling/apiError.js';
import DateTimeUtils from '../utils/DateTimeUtils.js';
import ConvertUtils from '../utils/convertUtils.js';
import { assertEarmarkAllowed } from './earmarkService.js';
import { ageOn } from './wealth/retirementMath.js';

export type SavingsTargetMode = 'amount' | 'percent';

export type FinancialProfile = {
  salary_category_id: string | null;
  salary_cutoff_day: number;
  savings_target_mode: SavingsTargetMode;
  /** Currency in amount mode, whole percent in percent mode. */
  savings_target_value: number;
  savings_target_account_id: string | null;
  sinking_fund_account_id: string | null;
  emergency_fund_target_months: number;
  emergency_topup_percent: number;
  /** Currency: payments below this count as small spends. */
  small_spend_cutoff: number;
  /** 'YYYY-MM-DD', or null when not set. */
  date_of_birth: string | null;
  retirement_age: number;
  expected_return_pct: number;
  inflation_pct: number;
  swr_pct: number;
  retirement_spending_basis: RetirementSpendingBasis;
  /** Currency per month. */
  family_support_monthly: number;
  family_support_years: number;
  /** Ticked for retirement. */
  retirement_account_ids: string[];
  retirement_asset_ids: string[];
};

export type RetirementSpendingBasis = 'all' | 'fixed';

export type FinancialProfilePatch = {
  salary_category_id?: number | string | bigint | null;
  salary_cutoff_day?: number;
  savings_target_mode?: SavingsTargetMode;
  savings_target_value?: number;
  savings_target_account_id?: number | string | bigint | null;
  sinking_fund_account_id?: number | string | bigint | null;
  emergency_fund_target_months?: number;
  emergency_topup_percent?: number;
  small_spend_cutoff?: number;
  date_of_birth?: string | null;
  retirement_age?: number;
  expected_return_pct?: number;
  inflation_pct?: number;
  swr_pct?: number;
  retirement_spending_basis?: RetirementSpendingBasis;
  family_support_monthly?: number;
  family_support_years?: number;
  /** Replaces the whole ticked set. */
  retirement_account_ids?: Array<number | string | bigint>;
  retirement_asset_ids?: Array<number | string | bigint>;
};

type ProfileRow = {
  salary_category_id: bigint | null;
  salary_cutoff_day: number;
  savings_target_mode: string;
  savings_target_value: bigint;
  savings_target_account_id: bigint | null;
  sinking_fund_account_id: bigint | null;
  emergency_fund_target_months: number;
  emergency_topup_percent: number;
  small_spend_cutoff: bigint;
  date_of_birth: string | null;
  retirement_age: number;
  expected_return_pct: { toString(): string } | number;
  inflation_pct: { toString(): string } | number;
  swr_pct: { toString(): string } | number;
  retirement_spending_basis: string;
  family_support_monthly: bigint;
  family_support_years: number;
};

type ProfileData = Partial<
  Omit<ProfileRow, 'expected_return_pct' | 'inflation_pct' | 'swr_pct'> & {
    expected_return_pct: number;
    inflation_pct: number;
    swr_pct: number;
  }
>;

const SAVINGS_MODES: string[] = ['amount', 'percent'];
const DEFAULT_CUTOFF_DAY = 25;
const DEFAULT_EMERGENCY_MONTHS = 6;
const DEFAULT_TOPUP_PERCENT = 10;
const DEFAULT_SMALL_SPEND_CENTS = 20000n;
const MAX_SMALL_SPEND = 100_000;
export const MAX_RETIREMENT_AGE = 80;
const DEFAULT_RETIREMENT_AGE = 60;
const MAX_FAMILY_SUPPORT_YEARS = 60;
const MAX_FAMILY_SUPPORT = 10_000_000;
const pct = (v: { toString(): string } | number | undefined, fallback: number) => (v == null ? fallback : Number(v.toString()));

const ranged = (name: string, v: unknown, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw APIError.badRequest(`${name} must be between ${min} and ${max}.`);
  return Math.round(v * 100) / 100;
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const idOrNull = (v: bigint | null | undefined) => (v != null ? String(v) : null);

const toProfile = (row: ProfileRow | null): FinancialProfile => {
  const mode: SavingsTargetMode = row?.savings_target_mode === 'percent' ? 'percent' : 'amount';
  const raw = row?.savings_target_value ?? 0n;
  return {
    salary_category_id: idOrNull(row?.salary_category_id),
    salary_cutoff_day: row?.salary_cutoff_day ?? DEFAULT_CUTOFF_DAY,
    savings_target_mode: mode,
    savings_target_value: mode === 'percent' ? Number(raw) : ConvertUtils.convertBigIntegerToFloat(raw),
    savings_target_account_id: idOrNull(row?.savings_target_account_id),
    sinking_fund_account_id: idOrNull(row?.sinking_fund_account_id),
    emergency_fund_target_months: row?.emergency_fund_target_months ?? DEFAULT_EMERGENCY_MONTHS,
    emergency_topup_percent: row?.emergency_topup_percent ?? DEFAULT_TOPUP_PERCENT,
    small_spend_cutoff: ConvertUtils.convertBigIntegerToFloat(row?.small_spend_cutoff ?? DEFAULT_SMALL_SPEND_CENTS),
    date_of_birth: row?.date_of_birth ?? null,
    retirement_age: row?.retirement_age ?? DEFAULT_RETIREMENT_AGE,
    expected_return_pct: pct(row?.expected_return_pct, 10),
    inflation_pct: pct(row?.inflation_pct, 6),
    swr_pct: pct(row?.swr_pct, 3.5),
    retirement_spending_basis: row?.retirement_spending_basis === 'fixed' ? 'fixed' : 'all',
    family_support_monthly: ConvertUtils.convertBigIntegerToFloat(row?.family_support_monthly ?? 0n),
    family_support_years: row?.family_support_years ?? 0,
    retirement_account_ids: [],
    retirement_asset_ids: [],
  };
};

async function withTicks(userId: bigint, profile: FinancialProfile): Promise<FinancialProfile> {
  const [accounts, assets] = await Promise.all([
    prisma.accounts.findMany({
      where: { users_user_id: userId, is_retirement: true },
      select: { account_id: true },
      orderBy: { account_id: 'asc' },
    }),
    prisma.invest_assets.findMany({
      where: { users_user_id: userId, is_retirement: true },
      select: { asset_id: true },
      orderBy: { asset_id: 'asc' },
    }),
  ]);
  return {
    ...profile,
    retirement_account_ids: accounts.map((a) => String(a.account_id)),
    retirement_asset_ids: assets.map((a) => String(a.asset_id)),
  };
}

export async function getFinancialProfile(userId: bigint): Promise<FinancialProfile> {
  const row = await prisma.user_financial_profile.findUnique({ where: { users_user_id: userId } });
  return withTicks(userId, toProfile(row));
}

export async function updateFinancialProfile(
  userId: bigint,
  patch: FinancialProfilePatch
): Promise<FinancialProfile> {
  const data: ProfileData = {};

  if (patch.salary_cutoff_day !== undefined) {
    const day = patch.salary_cutoff_day;
    if (!Number.isInteger(day) || day < 1 || day > 28)
      throw APIError.badRequest('salary_cutoff_day must be an integer between 1 and 28.');
    data.salary_cutoff_day = day;
  }

  if (patch.salary_category_id !== undefined) {
    if (patch.salary_category_id === null) {
      data.salary_category_id = null;
    } else {
      const categoryId = BigInt(patch.salary_category_id);
      const owned = await prisma.categories.findFirst({
        where: { category_id: categoryId, users_user_id: userId },
        select: { category_id: true },
      });
      if (!owned) throw APIError.notAuthorized('Category does not belong to this user.');
      data.salary_category_id = categoryId;
    }
  }

  const existing = await prisma.user_financial_profile.findUnique({
    where: { users_user_id: userId },
  });
  const current = toProfile(existing);

  // Retirement settings
  if (patch.date_of_birth !== undefined) {
    if (patch.date_of_birth === null) data.date_of_birth = null;
    else {
      if (typeof patch.date_of_birth !== 'string' || ageOn(patch.date_of_birth, nowSeconds()) === null)
        throw APIError.badRequest('date_of_birth must be a real past date as YYYY-MM-DD.');
      data.date_of_birth = patch.date_of_birth;
    }
  }
  if (patch.retirement_age !== undefined) {
    const a = patch.retirement_age;
    if (!Number.isInteger(a) || a < 1 || a > MAX_RETIREMENT_AGE)
      throw APIError.badRequest(`retirement_age must be an integer up to ${MAX_RETIREMENT_AGE}.`);
    data.retirement_age = a;
  }
  // Checked against the age only when this patch changes the retirement age or the date of birth,
  // so an unrelated save still works once the user has reached the stored retirement age
  const retirementAge = data.retirement_age ?? current.retirement_age;
  const dob = data.date_of_birth !== undefined ? data.date_of_birth : current.date_of_birth;
  if (retirementAge !== current.retirement_age || dob !== current.date_of_birth) {
    const age = dob ? ageOn(dob, nowSeconds()) : null;
    if (age !== null && retirementAge <= age)
      throw APIError.badRequest('retirement_age must be above your current age.');
  }
  if (patch.expected_return_pct !== undefined)
    data.expected_return_pct = ranged('expected_return_pct', patch.expected_return_pct, 0, 30);
  if (patch.inflation_pct !== undefined) data.inflation_pct = ranged('inflation_pct', patch.inflation_pct, 0, 20);
  if (patch.swr_pct !== undefined) data.swr_pct = ranged('swr_pct', patch.swr_pct, 1, 10);
  if (patch.retirement_spending_basis !== undefined) {
    if (patch.retirement_spending_basis !== 'all' && patch.retirement_spending_basis !== 'fixed')
      throw APIError.badRequest("retirement_spending_basis must be 'all' or 'fixed'.");
    data.retirement_spending_basis = patch.retirement_spending_basis;
  }
  if (patch.family_support_monthly !== undefined) {
    const v = patch.family_support_monthly;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_FAMILY_SUPPORT)
      throw APIError.badRequest('family_support_monthly must be a non-negative amount.');
    data.family_support_monthly = BigInt(ConvertUtils.convertFloatToBigInteger(v));
  }
  if (patch.family_support_years !== undefined) {
    const y = patch.family_support_years;
    if (!Number.isInteger(y) || y < 0 || y > MAX_FAMILY_SUPPORT_YEARS)
      throw APIError.badRequest(`family_support_years must be an integer up to ${MAX_FAMILY_SUPPORT_YEARS}.`);
    data.family_support_years = y;
  }

  if (patch.emergency_fund_target_months !== undefined) {
    const m = patch.emergency_fund_target_months;
    if (!Number.isInteger(m) || m < 1 || m > 24)
      throw APIError.badRequest('emergency_fund_target_months must be an integer between 1 and 24.');
    data.emergency_fund_target_months = m;
  }

  if (patch.emergency_topup_percent !== undefined) {
    const p = patch.emergency_topup_percent;
    if (!Number.isInteger(p) || p < 0 || p > 100)
      throw APIError.badRequest('emergency_topup_percent must be an integer between 0 and 100.');
    data.emergency_topup_percent = p;
  }

  if (patch.small_spend_cutoff !== undefined) {
    const c = patch.small_spend_cutoff;
    if (typeof c !== 'number' || !Number.isFinite(c) || Math.round(c * 100) < 1 || c > MAX_SMALL_SPEND)
      throw APIError.badRequest('small_spend_cutoff must be greater than 0 and at most 100000.');
    data.small_spend_cutoff = BigInt(ConvertUtils.convertFloatToBigInteger(c));
  }

  // Savings target: the value is read under the resulting mode
  if (patch.savings_target_mode !== undefined && !SAVINGS_MODES.includes(patch.savings_target_mode))
    throw APIError.badRequest("savings_target_mode must be 'amount' or 'percent'.");
  const mode = patch.savings_target_mode ?? current.savings_target_mode;
  if (patch.savings_target_mode !== undefined) data.savings_target_mode = mode;
  if (patch.savings_target_value !== undefined) {
    const v = patch.savings_target_value;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
      throw APIError.badRequest('savings_target_value must be a non-negative number.');
    if (mode === 'percent') {
      if (!Number.isInteger(v) || v > 100)
        throw APIError.badRequest('A percent savings target must be an integer between 0 and 100.');
      data.savings_target_value = BigInt(v);
    } else {
      data.savings_target_value = BigInt(ConvertUtils.convertFloatToBigInteger(v));
    }
  } else if (mode !== current.savings_target_mode) {
    data.savings_target_value = 0n;
  }

  // Earmarked accounts, checked against the resulting pair
  const toId = (v: number | string | bigint | null | undefined) =>
    v === undefined ? undefined : v === null ? null : BigInt(v);
  const sinking = toId(patch.sinking_fund_account_id);
  const savings = toId(patch.savings_target_account_id);
  const accountTicks = patch.retirement_account_ids?.map((v) => BigInt(v));
  const assetTicks = patch.retirement_asset_ids?.map((v) => BigInt(v));
  const overrides = { sinking, savings_target: savings, retirementIds: accountTicks };
  if (sinking != null) {
    await assertEarmarkAllowed(userId, sinking, 'sinking', prisma, overrides);
    data.sinking_fund_account_id = sinking;
  } else if (sinking === null) data.sinking_fund_account_id = null;
  if (savings != null) {
    await assertEarmarkAllowed(userId, savings, 'savings_target', prisma, overrides);
    data.savings_target_account_id = savings;
  } else if (savings === null) data.savings_target_account_id = null;

  if (accountTicks) {
    for (const id of accountTicks) await assertEarmarkAllowed(userId, id, 'retirement', prisma, overrides);
  }
  if (assetTicks) {
    const owned = await prisma.invest_assets.count({
      where: { users_user_id: userId, asset_id: { in: assetTicks } },
    });
    if (owned !== new Set(assetTicks.map(String)).size)
      throw APIError.badRequest('Invest asset does not belong to this user.');
  }

  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.user_financial_profile.upsert({
      where: { users_user_id: userId },
      create: { users_user_id: userId, ...data, updated_at: DateTimeUtils.getCurrentUnixTimestamp() },
      update: { ...data, updated_at: DateTimeUtils.getCurrentUnixTimestamp() },
    });
    if (accountTicks) {
      await tx.accounts.updateMany({ where: { users_user_id: userId }, data: { is_retirement: false } });
      await tx.accounts.updateMany({
        where: { users_user_id: userId, account_id: { in: accountTicks } },
        data: { is_retirement: true },
      });
    }
    if (assetTicks) {
      await tx.invest_assets.updateMany({ where: { users_user_id: userId }, data: { is_retirement: false } });
      await tx.invest_assets.updateMany({
        where: { users_user_id: userId, asset_id: { in: assetTicks } },
        data: { is_retirement: true },
      });
    }
    return saved;
  });
  return withTicks(userId, toProfile(row));
}

export default { getFinancialProfile, updateFinancialProfile };
