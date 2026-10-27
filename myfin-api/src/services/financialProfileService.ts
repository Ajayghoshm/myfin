import { prisma } from '../config/prisma.js';
import APIError from '../errorHandling/apiError.js';
import DateTimeUtils from '../utils/DateTimeUtils.js';

export type FinancialProfile = {
  salary_category_id: string | null;
  salary_cutoff_day: number;
};

export type FinancialProfilePatch = {
  salary_category_id?: number | string | bigint | null;
  salary_cutoff_day?: number;
};

const DEFAULT_CUTOFF_DAY = 25;

const toProfile = (
  row: { salary_category_id: bigint | null; salary_cutoff_day: number } | null
): FinancialProfile => ({
  salary_category_id: row?.salary_category_id != null ? String(row.salary_category_id) : null,
  salary_cutoff_day: row?.salary_cutoff_day ?? DEFAULT_CUTOFF_DAY,
});

export async function getFinancialProfile(userId: bigint): Promise<FinancialProfile> {
  const row = await prisma.user_financial_profile.findUnique({ where: { users_user_id: userId } });
  return toProfile(row);
}

export async function updateFinancialProfile(
  userId: bigint,
  patch: FinancialProfilePatch
): Promise<FinancialProfile> {
  const data: { salary_category_id?: bigint | null; salary_cutoff_day?: number } = {};

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

  const row = await prisma.user_financial_profile.upsert({
    where: { users_user_id: userId },
    create: { users_user_id: userId, ...data, updated_at: DateTimeUtils.getCurrentUnixTimestamp() },
    update: { ...data, updated_at: DateTimeUtils.getCurrentUnixTimestamp() },
  });
  return toProfile(row);
}

export default { getFinancialProfile, updateFinancialProfile };
