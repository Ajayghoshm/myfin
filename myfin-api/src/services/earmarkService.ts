import { prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import APIError from '../errorHandling/apiError.js';

export type AccountRole = 'emergency' | 'sinking' | 'savings_target' | 'retirement';

type DbClient = typeof prisma;

/** Profile account ids to use instead of the stored ones (a pending patch). */
export type RoleOverrides = {
  sinking?: bigint | null;
  savings_target?: bigint | null;
  /** Account type the account will have after a pending change. */
  type?: string;
  /** Retirement-ticked account ids after a pending patch (instead of each account's stored flag). */
  retirementIds?: bigint[];
};

/** Credit cards and loan accounts hold debt, so they can never be earmarked for anything. */
export const isDebtAccountType = (type: string | null | undefined) =>
  type === MYFIN.ACCOUNT_TYPES.CREDIT || type === MYFIN.ACCOUNT_TYPES.LOAN;

/** Account types that can never hold an earmarked role (investment, credit card, loan). */
export const isNeverEarmarkable = (type: string | null | undefined) =>
  type === MYFIN.ACCOUNT_TYPES.INVESTING || isDebtAccountType(type);

/**
 * An account may hold only one of emergency / sinking / savings_target (retirement may overlap a
 * savings target but never emergency or sinking), must belong to the user and must not be an investment, credit card or loan account. Throws APIError 400 otherwise.
 */
export async function assertEarmarkAllowed(
  userId: bigint,
  accountId: bigint,
  role: AccountRole,
  dbClient: DbClient = prisma,
  overrides: RoleOverrides = {}
): Promise<void> {
  const account = await dbClient.accounts.findFirst({
    where: { account_id: accountId, users_user_id: userId },
    select: { type: true, is_emergency_fund: true, is_retirement: true },
  });
  if (!account) throw APIError.badRequest('Account does not belong to this user.');
  const type = overrides.type ?? account.type;
  if (type === MYFIN.ACCOUNT_TYPES.INVESTING)
    throw APIError.badRequest('An investment account cannot be earmarked.');
  if (isDebtAccountType(type)) throw APIError.badRequest('A credit card or loan account cannot be earmarked.');

  const profile = await dbClient.user_financial_profile.findUnique({
    where: { users_user_id: userId },
    select: { sinking_fund_account_id: true, savings_target_account_id: true },
  });
  const sinking =
    overrides.sinking !== undefined ? overrides.sinking : (profile?.sinking_fund_account_id ?? null);
  const savings =
    overrides.savings_target !== undefined
      ? overrides.savings_target
      : (profile?.savings_target_account_id ?? null);

  const retirement = overrides.retirementIds
    ? overrides.retirementIds.includes(accountId)
    : account.is_retirement;
  const clash = (
    [
      ['emergency', account.is_emergency_fund],
      ['sinking', sinking === accountId],
      ['savings_target', savings === accountId],
      ['retirement', retirement],
    ] as Array<[AccountRole, boolean]>
  ).find(
    ([other, held]) =>
      other !== role &&
      held &&
      // Retirement and the savings target may overlap
      !(other === 'savings_target' && role === 'retirement') &&
      !(other === 'retirement' && role === 'savings_target')
  );
  if (clash)
    throw APIError.badRequest(
      `This account is already the ${clash[0].replace('_', ' ')} account; an account can hold only one earmarked role.`
    );
}

/** Active accounts ticked as emergency fund. */
export async function emergencyAccountIds(userId: bigint): Promise<bigint[]> {
  const rows = await prisma.accounts.findMany({
    where: {
      users_user_id: userId,
      is_emergency_fund: true,
      status: MYFIN.ACCOUNT_STATUS.ACTIVE,
    },
    select: { account_id: true },
    orderBy: { account_id: 'asc' },
  });
  return rows.map((r) => r.account_id);
}

export default { assertEarmarkAllowed, emergencyAccountIds, isDebtAccountType, isNeverEarmarkable };
