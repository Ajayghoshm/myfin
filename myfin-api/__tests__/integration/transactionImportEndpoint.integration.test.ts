import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import UserService from '../../src/services/userService.js';

describe('import step2 endpoint', () => {
  let baseUrl: string;
  let server: Server;
  let bankId: bigint;
  let sessionkey: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    const user = await UserService.createUser({ username: 'imp', password: '123', email: 'imp@x.com' });
    sessionkey = (await UserService.attemptLogin('imp', '123', false)).sessionkey;
    bankId = (
      await AccountService.createAccount(
        {
          name: 'Bank',
          type: MYFIN.ACCOUNT_TYPES.CHECKING,
          description: '',
          status: MYFIN.ACCOUNT_STATUS.ACTIVE,
          exclude_from_budgets: false,
          current_balance: 0,
          users_user_id: user.user_id,
        } as never,
        user.user_id
      )
    ).account_id;
  });

  test('returns created_by_index with the right ids and omits skipped duplicates', async () => {
    const row = (external_id: string, description: string) => ({
      account_from_id: Number(bankId),
      amount: 10,
      type: MYFIN.TRX_TYPES.EXPENSE,
      description,
      date_timestamp: 1_780_000_000,
      is_essential: false,
      external_id,
    });
    const post = async (rows: unknown[]) =>
      (
        await fetch(`${baseUrl}/trxs/import/step2`, {
          method: 'POST',
          body: JSON.stringify({ trx_list: JSON.stringify(rows) }),
          headers: { authusername: 'imp', sessionkey, 'content-type': 'application/json' },
        })
      ).json();
    await post([row('dup', 'old')]);
    const res = await post([row('dup', 'again'), row('new', 'fresh')]);
    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(1);
    const fresh = await prisma.transactions.findFirstOrThrow({ where: { description: 'fresh' } });
    expect(res.created_by_index).toHaveLength(1);
    expect(res.created_by_index[0].index).toBe(1);
    expect(String(res.created_by_index[0].transaction_id)).toBe(String(fresh.transaction_id));
  });
});

