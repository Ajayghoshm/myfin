import { beforeEach, describe, expect, test } from 'vitest';
import { MYFIN } from '../../src/consts.js';
import { prisma } from '../../src/config/prisma.js';
import AccountService from '../../src/services/accountService.js';
import { listAccountsWithFreshness } from '../../src/services/accountFreshnessService.js';
import UserService from '../../src/services/userService.js';
import DateTimeUtils from '../../src/utils/DateTimeUtils.js';

const DAY = 86400;

describe('GET /accounts freshness fields', () => {
  let userId: bigint;
  beforeEach(async () => {
    const user = await UserService.createUser({
      username: 'fresh',
      password: '123',
      email: 'fresh@example.com',
    });
    userId = user.user_id;
  });

  const mk = (name: string, extra: Record<string, unknown> = {}) =>
    AccountService.createAccount(
      {
        name,
        type: MYFIN.ACCOUNT_TYPES.CHECKING,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: userId,
        ...extra,
      } as never,
      userId
    );

  const trx = (accountId: bigint, ts: number, isAdjustment = false) =>
    prisma.transactions.create({
      data: {
        amount: 100,
        type: 'E',
        description: 'x',
        date_timestamp: ts,
        accounts_account_from_id: accountId,
        is_adjustment: isAdjustment,
      } as never,
    });

  test('fresh and stale accounts', async () => {
    const now = DateTimeUtils.getCurrentUnixTimestamp();
    const fresh = await mk('Fresh');
    const stale = await mk('Stale');
    const never = await mk('Never', { stale_after_days: 0 });
    await trx(fresh.account_id, now - 2 * DAY);
    await trx(fresh.account_id, now - 20 * DAY);
    await trx(stale.account_id, now - 30 * DAY);
    // an adjustment must not make the account fresh
    await trx(stale.account_id, now - 1 * DAY, true);
    await prisma.balance_checks.create({
      data: {
        accounts_account_id: stale.account_id,
        checked_at: now - 3 * DAY,
        real_balance: 0,
        myfin_balance: 0,
        result: 'matched',
      } as never,
    });

    const rows = await listAccountsWithFreshness(userId);
    const by = (n: string) => rows.find((r) => r.name === n);
    expect(by('Fresh').freshness).toBe('fresh');
    expect(by('Fresh').days_since_last_transaction).toBe(2);
    expect(by('Fresh').stale_after_days_effective).toBe(7);
    expect(by('Stale').freshness).toBe('stale');
    expect(by('Stale').days_since_last_transaction).toBe(30);
    expect(by('Stale').last_balance_check_at).toBe(now - 3 * DAY);
    expect(by('Never').freshness).toBe('never');
    expect(by('Never').stale_after_days_effective).toBeNull();
    expect(by('Never').last_transaction_at).toBeNull();
  });
});
