import { prisma } from '../config/prisma.js';
import APIError from '../errorHandling/apiError.js';
import DateTimeUtils from '../utils/DateTimeUtils.js';
import ConvertUtils from '../utils/convertUtils.js';
import { assertEarmarkAllowed } from './earmarkService.js';

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
};

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
};

const SAVINGS_MODES: string[] = ['amount', 'percent'];
const DEFAULT_CUTOFF_DAY = 25;
const DEFAULT_EMERGENCY_MONTHS = 6;
const DEFAULT_TOPUP_PERCENT = 10;
const DEFAULT_SMALL_SPEND_CENTS = 20000n;
const MAX_SMALL_SPEND = 100_000;

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
  };
};

export async function getFinancialProfile(userId: bigint): Promise<FinancialProfile> {
  const row = await prisma.user_financial_profile.findUnique({ where: { users_user_id: userId } });
  return toProfile(row);
}

export async function updateFinancialProfile(
  userId: bigint,
  patch: FinancialProfilePatch
): Promise<FinancialProfile> {
  const data: Partial<ProfileRow> = {};

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
    if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0 || c > MAX_SMALL_SPEND)
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
  const overrides = { sinking, savings_target: savings };
  if (sinking != null) {
    await assertEarmarkAllowed(userId, sinking, 'sinking', prisma, overrides);
    data.sinking_fund_account_id = sinking;
  } else if (sinking === null) data.sinking_fund_account_id = null;
  if (savings != null) {
    await assertEarmarkAllowed(userId, savings, 'savings_target', prisma, overrides);
    data.savings_target_account_id = savings;
  } else if (savings === null) data.savings_target_account_id = null;

  const row = await prisma.user_financial_profile.upsert({
    where: { users_user_id: userId },
    create: { users_user_id: userId, ...data, updated_at: DateTimeUtils.getCurrentUnixTimestamp() },
    update: { ...data, updated_at: DateTimeUtils.getCurrentUnixTimestamp() },
  });
  return toProfile(row);
}

export default { getFinancialProfile, updateFinancialProfile };
