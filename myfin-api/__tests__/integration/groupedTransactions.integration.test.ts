import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import { monthRangeIST } from '../../src/services/insights/insightsPrimitives.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';

const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
const DAY = 86_400;
const at = (month: number, day = 5) => monthRangeIST({ year: 2026, month }).from + (day - 1) * DAY + 3600;

describe('grouped transactions', () => {
  let baseUrl: string;
  let server: Server;
  let headers: Record<string, string>;
  let food: bigint;

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
    const user = await UserService.createUser({ username: 'grp', password: '123', email: 'grp@x.com' });
    const uid = user.user_id;
    const bank = await AccountService.createAccount(
      { name: 'Bank', type: MYFIN.ACCOUNT_TYPES.CHECKING, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: uid },
      uid
    );
    food = (await prisma.categories.create({ data: { name: 'Food', type: E, users_user_id: uid } })).category_id;
    const add = (type: string, description: string, amount: number, month: number, category_id?: bigint) =>
      TransactionService.createTransaction(uid, {
        account_from_id: type === E ? bank.account_id : undefined,
        account_to_id: type === I ? bank.account_id : undefined,
        amount,
        type,
        description,
        date_timestamp: at(month),
        is_essential: false,
        category_id,
      } as never);
    await add(E, 'Paid to GROCER', 100, 9, food);
    await add(E, 'Paid to GROCER', 50, 10, food);
    await add(E, 'Paid to CAFE', 20, 10);
    await add(I, 'Received from BOSS', 1000, 10);
    const login = await UserService.attemptLogin('grp', '123', false);
    headers = { authusername: 'grp', sessionkey: login.sessionkey };
  });

  const grouped = async (query: string) => {
    const res = await fetch(`${baseUrl}/trxs/grouped?${query}`, { headers });
    expect(res.status).toBe(200);
    return (await res.json()).groups as Array<{
      key: string;
      label: string;
      count: number;
      income: number;
      expense: number;
    }>;
  };

  test('groups by payee with prefixes stripped', async () => {
    const groups = await grouped('group_by=payee');
    const by = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(by.GROCER).toMatchObject({ count: 2, expense: 150, income: 0 });
    expect(by.CAFE).toMatchObject({ count: 1, expense: 20 });
    expect(by.BOSS).toMatchObject({ count: 1, income: 1000 });
  });

  test('groups by category, with uncategorised as none', async () => {
    const groups = await grouped('group_by=category');
    const by = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(by[String(food)]).toMatchObject({ label: 'Food', count: 2 });
    expect(by.none.count).toBe(2);
  });

  test('groups by month and honours the filters', async () => {
    const all = await grouped('group_by=month');
    expect(all.map((g) => [g.key, g.count]).sort()).toEqual([
      ['2026-09', 1],
      ['2026-10', 3],
    ]);
    const oct = await grouped('group_by=payee&effective_month=2026-10&type=E');
    expect(oct.map((g) => g.key).sort()).toEqual(['CAFE', 'GROCER']);
  });

  test('rejects an unknown grouping', async () => {
    const res = await fetch(`${baseUrl}/trxs/grouped?group_by=nope`, { headers });
    expect(res.status).toBe(400);
  });
});
