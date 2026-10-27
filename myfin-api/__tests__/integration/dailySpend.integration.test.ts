import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService from '../../src/services/transactionService.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { dailySpend } from '../../src/services/insights/dailySpendService.js';
import { dailySpendQuerySchema } from '../../src/controllers/insightsController.js';
import { toTransactionFilter } from '../../src/controllers/transactionController.js';
import { salaryRuleFor } from '../../src/services/insights/analyticsRules.js';

const E = MYFIN.TRX_TYPES.EXPENSE;
const T = MYFIN.TRX_TYPES.TRANSFER;
const IST = 19800;
/** Epoch seconds of an IST wall-clock moment. */
const ist = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0) =>
  Date.UTC(y, m - 1, d, hh, mm, ss) / 1000 - IST;

async function seed() {
  const user = await UserService.createUser({ username: 'demo', password: '123', email: 'demo@afaneca.com' });
  const uid = user.user_id;
  const mk = (name: string) =>
    AccountService.createAccount(
      {
        name,
        type: MYFIN.ACCOUNT_TYPES.CHECKING,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: uid,
      },
      uid
    );
  const bank = await mk('Bank');
  const other = await mk('Other');
  const rent = await prisma.categories.create({
    data: { name: 'Rent', description: '', type: 'E', is_fixed: true, users_user_id: uid } as never,
  });
  const food = await prisma.categories.create({
    data: { name: 'Food', description: '', type: 'E', is_fixed: false, users_user_id: uid } as never,
  });
  const add = (t: { type?: string; amount: number; date: number; cat?: bigint; to?: bigint }) =>
    TransactionService.createTransaction(uid, {
      account_from_id: bank.account_id,
      account_to_id: t.to ?? null,
      amount: t.amount,
      category_id: t.cat ?? null,
      date_timestamp: t.date,
      description: 'x',
      entity_id: null,
      is_essential: false,
      tags: [],
      type: t.type ?? E,
    });
  await add({ amount: 10000, date: ist(2026, 10, 1, 9), cat: rent.category_id });
  await add({ amount: 500, date: ist(2026, 10, 4, 23, 59, 59), cat: food.category_id });
  await add({ amount: 300, date: ist(2026, 10, 5, 0, 0, 0), cat: food.category_id });
  await add({ amount: 100, date: ist(2026, 10, 11, 12), cat: food.category_id });
  await add({ type: T, to: other.account_id, amount: 777, date: ist(2026, 10, 4, 10) });
  await prisma.transactions.create({
    data: {
      type: E,
      amount: 4000n,
      date_timestamp: ist(2026, 10, 4, 11),
      description: 'Adjust',
      is_adjustment: true,
      accounts_account_from_id: bank.account_id,
      is_essential: false,
    },
  });
  return { uid };
}

describe('Daily spend', () => {
  let uid: bigint;
  beforeEach(async () => {
    ({ uid } = await seed());
  });

  test('IST day boundary: 23:59:59 and 00:00:00 land on their own days', async () => {
    const r = await dailySpend(uid, '2026-10-01', '2026-10-31', false);
    expect(r.days).toEqual([
      { date: '2026-10-01', total: 10000, count: 1 },
      { date: '2026-10-04', total: 500, count: 1 },
      { date: '2026-10-05', total: 300, count: 1 },
      { date: '2026-10-11', total: 100, count: 1 },
    ]);
    expect(r).toMatchObject({ from: '2026-10-01', to: '2026-10-31', flexible_only: false });
  });

  test('flexible only drops fixed rent', async () => {
    const r = await dailySpend(uid, '2026-10-01', '2026-10-31', true);
    expect(r.flexible_only).toBe(true);
    expect(r.days.map((d) => d.date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-11']);
  });

  test('weekday averages stop at today (IST): on Oct 5, Sunday = Oct 4 spend / 1', async () => {
    const now = ist(2026, 10, 5, 10);
    const r = await dailySpend(uid, '2026-10-01', '2026-10-31', false, now);
    expect(r.weekday_avg[6]).toBeCloseTo(500, 2); // only Sunday Oct 4 counted
    expect(r.weekday_avg[0]).toBeCloseTo(300, 2); // Monday Oct 5 (today counts)
    expect(r.weekday_avg[3]).toBeCloseTo(10000, 2); // Thursday Oct 1 only
  });

  test('range entirely in the future: all averages 0', async () => {
    const r = await dailySpend(uid, '2026-10-01', '2026-10-31', false, ist(2026, 9, 1));
    expect(r.weekday_avg).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test('weekday average: Sunday = Sunday totals / 4 Sundays', async () => {
    const r = await dailySpend(uid, '2026-10-01', '2026-10-31', false, ist(2026, 11, 1));
    expect(r.weekday_avg).toHaveLength(7);
    expect(r.weekday_avg[6]).toBeCloseTo((500 + 100) / 4, 2);
    // Monday 5th: 300 over 4 Mondays (5,12,19,26)
    expect(r.weekday_avg[0]).toBeCloseTo(300 / 4, 2);
    // Thursday: rent on the 1st; 5 Thursdays (1,8,15,22,29)
    expect(r.weekday_avg[3]).toBeCloseTo(10000 / 5, 2);
  });

  test('quantiles: 4 cut points by linear interpolation', async () => {
    const r = await dailySpend(uid, '2026-10-01', '2026-10-31', false);
    // sorted 100,300,500,10000 -> positions 0.6, 1.2, 1.8, 2.4
    expect(r.quantiles).toHaveLength(4);
    expect(r.quantiles[0]).toBeCloseTo(220, 2);
    expect(r.quantiles[1]).toBeCloseTo(340, 2);
    expect(r.quantiles[2]).toBeCloseTo(300 + 0.8 * 200, 2);
    expect(r.quantiles[3]).toBeCloseTo(500 + 0.4 * 9500, 2);
    expect([...r.quantiles].sort((a, b) => a - b)).toEqual(r.quantiles);
  });

  test('drill-down by day returns exactly the 23:59 row; adjustment hidden with type E', async () => {
    const withType = toTransactionFilter({ day: '2026-10-04', type: E });
    const { query: _q, ...opts } = withType as never as { query?: string };
    const listed = await TransactionService.getFilteredTransactionsByForUser(uid, 0, 100, '', {
      ...(opts as object),
      type: E,
      salaryRule: await salaryRuleFor(uid),
    });
    const rows = listed.results as Array<{ amount: unknown }>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(500);

    const noType = toTransactionFilter({ day: '2026-10-04' });
    const all = await TransactionService.getFilteredTransactionsByForUser(uid, 0, 100, '', noType as never);
    expect((all.results as unknown[]).length).toBe(3); // 500 expense, transfer, adjustment
  });

  test('drill-down with cost=flexible matches the flexible heatmap day', async () => {
    const f = toTransactionFilter({ day: '2026-10-01', type: E, cost_kind: 'flexible' });
    const listed = await TransactionService.getFilteredTransactionsByForUser(uid, 0, 100, '', {
      ...(f as object),
      type: E,
    } as never);
    expect((listed.results as unknown[]).length).toBe(0);
  });

  test('bulk select-all-matching by day updates exactly the day rows', async () => {
    const f = toTransactionFilter({ day: '2026-10-04', type: E });
    const changed = await TransactionService.bulkUpdateTransactions(
      uid,
      { filter: { type: E, ...f } as never },
      { is_essential: true }
    );
    expect(changed).toBe(1);
  });

  test('range validation', async () => {
    await expect(dailySpend(uid, '2025-01-01', '2026-10-31', false)).rejects.toMatchObject({ code: 400 });
    await expect(dailySpend(uid, '2026-10-05', '2026-10-01', false)).rejects.toMatchObject({ code: 400 });
    await expect(dailySpend(uid, '2026-02-30', '2026-03-05', false)).rejects.toMatchObject({ code: 400 });
    // 400 days inclusive is fine
    await expect(dailySpend(uid, '2025-09-26', '2026-10-31', false)).rejects.toMatchObject({ code: 400 });
    await expect(dailySpend(uid, '2025-09-27', '2026-10-31', false)).resolves.toBeTruthy();
  });

  test('query schema validates dates and the day filter', async () => {
    await expect(dailySpendQuerySchema.validateAsync({ from: '2026-02-30', to: '2026-03-01' })).rejects.toThrow();
    const ok = await dailySpendQuerySchema.validateAsync({ from: '2026-10-01', to: '2026-10-31', flexible_only: '1' });
    expect(ok.flexible_only).toBe(true);
  });

  test('new user: empty days, zero averages, no quantiles', async () => {
    const u = await UserService.createUser({ username: 'new', password: '123', email: 'n@afaneca.com' });
    const r = await dailySpend(u.user_id, '2026-10-01', '2026-10-31', false);
    expect(r.days).toEqual([]);
    expect(r.weekday_avg).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(r.quantiles).toEqual([]);
  });
});
