import { prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import AccountService from './accountService.js';

const DAY_SECONDS = 86400;

/** Days after which an account with no stored setting is considered stale. */
const DEFAULT_STALE_DAYS: Record<string, number> = {
  CHEAC: 7,
  WALLET: 7,
  MEALAC: 7,
  SAVAC: 30,
  CREAC: 35,
  INVAC: 45,
  OTHAC: 45,
};
const FALLBACK_STALE_DAYS = 45;

export type Freshness = 'fresh' | 'stale' | 'never' | 'inactive';

export type FreshnessInfo = {
  last_transaction_at: number | null;
  days_since_last_transaction: number | null;
  /** null = never stale. */
  stale_after_days_effective: number | null;
  freshness: Freshness;
};

type FreshnessAccount = { type: string; status: string; stale_after_days: number | null };

/** Stored 0 = never, null = type default. */
export function freshnessFor(
  account: FreshnessAccount,
  lastTrxAt: number | null,
  nowEpoch: number
): FreshnessInfo {
  const stored = account.stale_after_days;
  const effective =
    stored === 0 ? null : (stored ?? DEFAULT_STALE_DAYS[account.type] ?? FALLBACK_STALE_DAYS);
  const days =
    lastTrxAt === null ? null : Math.max(0, Math.floor((nowEpoch - lastTrxAt) / DAY_SECONDS));

  let freshness: Freshness;
  if (account.status === MYFIN.ACCOUNT_STATUS.INACTIVE) freshness = 'inactive';
  else if (effective === null) freshness = 'never';
  else if (days === null || days > effective) freshness = 'stale';
  else freshness = 'fresh';

  return {
    last_transaction_at: lastTrxAt,
    days_since_last_transaction: days,
    stale_after_days_effective: effective,
    freshness,
  };
}

/** Accounts of the user with balances plus freshness fields (one grouped query per source). */
export async function listAccountsWithFreshness(userId: bigint, nowEpoch?: number) {
  const now = nowEpoch ?? Math.floor(Date.now() / 1000);
  const accounts = (await AccountService.getAccountsForUserWithAmounts(userId, false)) as Array<{
    account_id: bigint;
    type: string;
    status: string;
    stale_after_days?: number | null;
    [column: string]: unknown;
  }>;

  const lastTrx = await prisma.$queryRaw<Array<{ account_id: bigint; last_at: bigint }>>`
    SELECT account_id, MAX(date_timestamp) AS last_at FROM (
      SELECT t.accounts_account_from_id AS account_id, t.date_timestamp
        FROM transactions t
        JOIN accounts a ON a.account_id = t.accounts_account_from_id
       WHERE a.users_user_id = ${userId} AND t.is_adjustment = false
      UNION ALL
      SELECT t.accounts_account_to_id AS account_id, t.date_timestamp
        FROM transactions t
        JOIN accounts a ON a.account_id = t.accounts_account_to_id
       WHERE a.users_user_id = ${userId} AND t.is_adjustment = false
    ) x GROUP BY account_id`;
  const lastTrxMap = new Map(lastTrx.map((r) => [String(r.account_id), Number(r.last_at)]));

  const checks = await prisma.balance_checks.groupBy({
    by: ['accounts_account_id'],
    where: { accounts: { users_user_id: userId } },
    _max: { checked_at: true },
  });
  const checkMap = new Map(
    checks.map((c) => [String(c.accounts_account_id), Number(c._max.checked_at)])
  );

  return accounts.map((account) => {
    const key = String(account.account_id);
    const info = freshnessFor(
      {
        type: account.type,
        status: account.status,
        stale_after_days: account.stale_after_days ?? null,
      },
      lastTrxMap.get(key) ?? null,
      now
    );
    return {
      ...account,
      stale_after_days: account.stale_after_days ?? null,
      ...info,
      last_balance_check_at: checkMap.get(key) ?? null,
    };
  });
}

export default { freshnessFor, listAccountsWithFreshness };
