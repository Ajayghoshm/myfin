import { performDatabaseRequest, prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import APIError from '../errorHandling/apiError.js';
import DateTimeUtils from '../utils/DateTimeUtils.js';
import AccountService from './accountService.js';
import TransactionService from './transactionService.js';

const ADJUSTMENT_CATEGORY_NAME = 'Balance adjustment';
const ADJUSTMENT_CATEGORY_TYPE = 'M';
const WRITE_OFF_DESCRIPTION = 'Reconciliation write-off';

export type BalanceCheckResult = 'matched' | 'adjusted' | 'open';

export type BalanceCheckRow = {
  account_id: string;
  name: string;
  type: string;
  /** Decimal currency, comparable form (owed amount, positive, for credit cards). */
  myfin_balance: number;
  last_check: { checked_at: number; result: string; gap: number } | null;
};

const isCredit = (type: string) => type === MYFIN.ACCOUNT_TYPES.CREDIT;

/** The balance the user compares their real figure with: owed amount for cards, the balance otherwise. */
const comparableCents = (account: { type: string; current_balance: bigint | null }) => {
  const raw = Number(account.current_balance ?? 0);
  return isCredit(account.type) ? -raw : raw;
};

const toCents = (amount: number) => Math.round(amount * 100);

async function ownedAccount(userId: bigint, accountId: bigint, dbClient = prisma) {
  const account = await dbClient.accounts.findFirst({
    where: { account_id: accountId, users_user_id: userId },
  });
  if (!account) throw APIError.notAuthorized();
  return account;
}

export async function listForBalanceCheck(userId: bigint): Promise<BalanceCheckRow[]> {
  const accounts = await prisma.accounts.findMany({
    where: { users_user_id: userId, status: MYFIN.ACCOUNT_STATUS.ACTIVE },
    orderBy: { name: 'asc' },
  });
  const rows: BalanceCheckRow[] = [];
  for (const account of accounts) {
    const last = await prisma.balance_checks.findFirst({
      where: { accounts_account_id: account.account_id },
      orderBy: [{ checked_at: 'desc' }, { check_id: 'desc' }],
    });
    rows.push({
      account_id: String(account.account_id),
      name: account.name,
      type: account.type,
      myfin_balance: comparableCents(account) / 100,
      last_check: last
        ? {
            checked_at: Number(last.checked_at),
            result: last.result,
            gap: (Number(last.real_balance) - Number(last.myfin_balance)) / 100,
          }
        : null,
    });
  }
  return rows;
}

export async function recordCheck(
  userId: bigint,
  accountId: bigint,
  realBalance: number
): Promise<{ gap: number; result: BalanceCheckResult }> {
  const account = await ownedAccount(userId, accountId);
  const real = toCents(realBalance);
  const myfin = comparableCents(account);
  const gapCents = real - myfin;
  const result: BalanceCheckResult = gapCents === 0 ? 'matched' : 'open';
  await prisma.balance_checks.create({
    data: {
      accounts_account_id: accountId,
      checked_at: DateTimeUtils.getCurrentUnixTimestamp(),
      real_balance: real,
      myfin_balance: myfin,
      result,
    },
  });
  return { gap: gapCents / 100, result };
}

export async function writeOff(
  userId: bigint,
  accountId: bigint,
  realBalance: number
): Promise<bigint> {
  return performDatabaseRequest(async (prismaTx) => {
    // Serialise concurrent write-offs on this account: the balance must be read under the lock.
    await prismaTx.$queryRaw`SELECT account_id FROM accounts WHERE account_id = ${accountId} FOR UPDATE`;
    const account = await ownedAccount(userId, accountId, prismaTx);
    const real = toCents(realBalance);
    const myfin = comparableCents(account);
    const gapCents = real - myfin;
    if (gapCents === 0) throw APIError.badRequest('Nothing to write off: the balances already match.');

    // Direction is decided on the raw balance (cards store what is owed as a negative number).
    const rawNow = Number(account.current_balance ?? 0);
    const rawTarget = isCredit(account.type) ? -real : real;
    const income = rawTarget > rawNow;

    let category = await prismaTx.categories.findFirst({
      where: {
        users_user_id: userId,
        name: ADJUSTMENT_CATEGORY_NAME,
        type: ADJUSTMENT_CATEGORY_TYPE,
      },
    });
    if (!category) {
      category = await prismaTx.categories.create({
        data: {
          users_user_id: userId,
          name: ADJUSTMENT_CATEGORY_NAME,
          type: ADJUSTMENT_CATEGORY_TYPE,
          exclude_from_budgets: 1,
        },
      });
    }

    const trx = await TransactionService.createTransaction(
      userId,
      {
        amount: Math.abs(gapCents) / 100,
        type: income ? MYFIN.TRX_TYPES.INCOME : MYFIN.TRX_TYPES.EXPENSE,
        description: WRITE_OFF_DESCRIPTION,
        account_from_id: income ? undefined : accountId,
        account_to_id: income ? accountId : undefined,
        category_id: category.category_id,
        date_timestamp: DateTimeUtils.getCurrentUnixTimestamp(),
        is_essential: false,
        is_adjustment: true,
      },
      prismaTx
    );

    await prismaTx.balance_checks.create({
      data: {
        accounts_account_id: accountId,
        checked_at: DateTimeUtils.getCurrentUnixTimestamp(),
        real_balance: real,
        myfin_balance: myfin,
        result: 'adjusted',
        adjustment_transaction_id: trx.transaction_id,
      },
    });
    return trx.transaction_id;
  });
}

export default { listForBalanceCheck, recordCheck, writeOff };
