import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import { getMonthInsights } from '../../src/services/insights/insightsService.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import { emergencyFund } from '../../src/services/planning/emergencyFundService.js';
import {
  candidatesFor,
  confirmMatch,
  createPlanned,
  findMatches,
  getOnPlannedResolved,
  listPlanned,
  markDone,
  setOnPlannedResolved,
  skip,
} from '../../src/services/planning/plannedTransactionService.js';
import { safeToSpend } from '../../src/services/planning/safeToSpendService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';
import BackupManager from '../../src/utils/backupManager.js';

const DAY = 86_400;
const T = MYFIN.TRX_TYPES.TRANSFER;
const E = MYFIN.TRX_TYPES.EXPENSE;
const NOV: YearMonth = { year: 2026, month: 11 };
const NOW = monthRangeIST(NOV).from + 19 * DAY; // 2026-11-20 IST
const REAL_NOW = () => Math.floor(Date.now() / 1000);

async function mkAccount(uid: bigint, name: string, type: string, balance = 0, extra: object = {}) {
  return prisma.accounts.create({
    data: {
      name,
      type,
      description: '',
      status: MYFIN.ACCOUNT_STATUS.ACTIVE,
      exclude_from_budgets: false,
      current_balance: balance,
      users_user_id: uid,
      ...extra,
    },
  });
}

async function setup() {
  const user = await UserService.createUser({ username: 'pt', password: '123', email: 'pt@x.com' });
  const uid = user.user_id;
  const bank = await AccountService.createAccount(
    { name: 'Bank', type: MYFIN.ACCOUNT_TYPES.CHECKING, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 500_000, users_user_id: uid },
    uid
  );
  const savings = await mkAccount(uid, 'Savings', MYFIN.ACCOUNT_TYPES.SAVINGS, 100_000);
  const emergency = await mkAccount(uid, 'Emergency', MYFIN.ACCOUNT_TYPES.SAVINGS, 300_000, { is_emergency_fund: true });
  const other = await mkAccount(uid, 'Other', MYFIN.ACCOUNT_TYPES.SAVINGS, 0);
  const transfer = (from: bigint, to: bigint, amount: number, ts: number) =>
    TransactionService.createTransaction(uid, {
      account_from_id: from,
      account_to_id: to,
      amount,
      type: T,
      description: 'Transfer',
      date_timestamp: ts,
      is_essential: false,
    } as never);
  const plan = (rows: Partial<Parameters<typeof createPlanned>[1][number]>[]) =>
    prisma.$transaction((tx) =>
      createPlanned(
        uid,
        rows.map((r) => ({
          date_timestamp: NOW + 2 * DAY,
          amount: 15_000_00,
          type: T,
          account_from_id: bank.account_id,
          account_to_id: savings.account_id,
          description: 'Planned savings',
          ...r,
        })),
        tx as never
      )
    );
  return { uid, bank, savings, emergency, other, transfer, plan };
}

describe('planned transactions', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let baseUrl: string;
  let server: Server;
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
    ctx = await setup();
  });

  const figures = async () => ({
    balances: (await prisma.accounts.findMany({ where: { users_user_id: ctx.uid }, orderBy: { account_id: 'asc' }, select: { account_id: true, current_balance: true } })),
    insights: await getMonthInsights(ctx.uid, NOV),
    sts: await safeToSpend(ctx.uid, NOW),
    ef: await emergencyFund(ctx.uid, NOW),
    snapshots: await prisma.balances_snapshot.count(),
    trx: await prisma.transactions.count(),
  });

  test('isolation: planned transfers change no balance, insight, safe-to-spend or emergency fund', async () => {
    await ctx.transfer(ctx.bank.account_id, ctx.savings.account_id, 500, NOW - 5 * DAY);
    await ctx.transfer(ctx.bank.account_id, ctx.emergency.account_id, 700, NOW - 4 * DAY);
    await TransactionService.createTransaction(ctx.uid, { account_from_id: ctx.bank.account_id, amount: 1200, type: E, description: 'Paid to SHOP', date_timestamp: NOW - 3 * DAY, is_essential: false } as never);
    const before = JSON.parse(JSON.stringify(await figures()));
    await ctx.plan([{}, { account_to_id: ctx.emergency.account_id, date_timestamp: NOW - 1 * DAY }]);
    const after = JSON.parse(JSON.stringify(await figures()));
    expect(after).toEqual(before);
    expect(await listPlanned(ctx.uid)).toHaveLength(2);
  });

  test('mark done creates a real T row, updates balances, removes the planned row, fires the hook', async () => {
    const calls: unknown[][] = [];
    const previous = getOnPlannedResolved();
    setOnPlannedResolved(async (...args) => {
      expect(args[0]).toBe(ctx.uid);
      calls.push(args.slice(1, 4));
    });
    try {
      const [id] = await ctx.plan([{ date_timestamp: REAL_NOW() - 2 * DAY }]);
      const trxId = await markDone(ctx.uid, id);
      const row = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: trxId } });
      expect(row.type).toBe(T);
      expect(Number(row.amount)).toBe(15_000_00);
      expect(row.accounts_account_from_id).toBe(ctx.bank.account_id);
      expect(row.accounts_account_to_id).toBe(ctx.savings.account_id);
      const bank = await prisma.accounts.findUniqueOrThrow({ where: { account_id: ctx.bank.account_id } });
      const sav = await prisma.accounts.findUniqueOrThrow({ where: { account_id: ctx.savings.account_id } });
      expect(Number(bank.current_balance)).toBe(-1_500_000);
      expect(Number(sav.current_balance)).toBe(1_500_000);
      expect(await listPlanned(ctx.uid)).toEqual([]);
      expect(calls).toEqual([[id, 'done', trxId]]);
    } finally {
      setOnPlannedResolved(previous);
    }
  });

  test('mark done on a planned row whose category was deleted creates an uncategorised transaction', async () => {
    const cat = await prisma.categories.create({ data: { name: 'Gone', type: E, users_user_id: ctx.uid } });
    const [id] = await ctx.plan([{ type: E, account_to_id: null, category_id: cat.category_id, date_timestamp: NOW }]);
    await prisma.categories.delete({ where: { category_id: cat.category_id } });
    const trxId = await markDone(ctx.uid, id, NOW);
    const row = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: trxId } });
    expect(row.categories_category_id).toBeNull();
  });

  test("createPlanned rejects another user's category", async () => {
    const other = await UserService.createUser({ username: 'pt2', password: '123', email: 'pt2@x.com' });
    const cat = await prisma.categories.create({ data: { name: 'Theirs', type: E, users_user_id: other.user_id } });
    await expect(ctx.plan([{ type: E, account_to_id: null, category_id: cat.category_id }])).rejects.toMatchObject({
      code: 401,
    });
  });

  test('skip removes the row without creating a transaction', async () => {
    const calls: unknown[][] = [];
    const previous = getOnPlannedResolved();
    setOnPlannedResolved(async (...args) => {
      expect(args[0]).toBe(ctx.uid);
      calls.push(args.slice(1, 4));
    });
    try {
      const [id] = await ctx.plan([{}]);
      await skip(ctx.uid, id);
      expect(await listPlanned(ctx.uid)).toEqual([]);
      expect(await prisma.transactions.count()).toBe(0);
      expect(calls).toEqual([[id, 'skipped', null]]);
    } finally {
      setOnPlannedResolved(previous);
    }
  });

  test('matching: 15,000.50 three days later matches (within 100 cents); 15,002 or ten days later does not; findMatches is read-only', async () => {
    const [id] = await ctx.plan([{}]);
    const base = NOW + 2 * DAY;
    const good = await ctx.transfer(ctx.bank.account_id, ctx.savings.account_id, 15_000.5, base + 3 * DAY);
    const farAmount = await ctx.transfer(ctx.bank.account_id, ctx.savings.account_id, 15_002, base);
    const farDate = await ctx.transfer(ctx.bank.account_id, ctx.savings.account_id, 15_000, base + 10 * DAY);
    const wrongAccount = await ctx.transfer(ctx.bank.account_id, ctx.other.account_id, 15_000, base);
    const wrongType = await TransactionService.createTransaction(ctx.uid, { account_from_id: ctx.bank.account_id, amount: 15_000, type: E, description: 'x', date_timestamp: base, is_essential: false } as never);
    const ids = [good, farAmount, farDate, wrongAccount, wrongType].map((t) => BigInt(t.transaction_id));
    const snapshot = JSON.stringify(await figures());
    const matches = await findMatches(ctx.uid, ids);
    expect(matches.map((m) => [m.transaction_id, m.planned.planned_id])).toEqual([[String(good.transaction_id), String(id)]]);
    expect(JSON.stringify(await figures())).toBe(snapshot);
    expect(await listPlanned(ctx.uid)).toHaveLength(1);
    const cands = await candidatesFor(ctx.uid, id);
    expect(cands.map((c) => c.transaction_id)).toEqual([String(good.transaction_id)]);

    await expect(confirmMatch(ctx.uid, id, BigInt(farAmount.transaction_id))).rejects.toMatchObject({ code: 400 });
    expect(await listPlanned(ctx.uid)).toHaveLength(1);

    await confirmMatch(ctx.uid, id, BigInt(good.transaction_id));
    expect(await listPlanned(ctx.uid)).toEqual([]);
    expect(await prisma.transactions.findUnique({ where: { transaction_id: BigInt(good.transaction_id) } })).not.toBeNull();
  });

  test('ownership: another user planned id gives 401 (service and HTTP); own works over HTTP', async () => {
    const [id] = await ctx.plan([{}]);
    const intruder = await UserService.createUser({ username: 'other', password: '123', email: 'o@x.com' });
    await expect(skip(intruder.user_id, id)).rejects.toMatchObject({ code: 401 });
    await expect(markDone(intruder.user_id, id)).rejects.toMatchObject({ code: 401 });
    const good = await ctx.transfer(ctx.bank.account_id, ctx.savings.account_id, 15_000, NOW + 2 * DAY);
    await expect(confirmMatch(intruder.user_id, id, BigInt(good.transaction_id))).rejects.toMatchObject({ code: 401 });
    expect(await findMatches(intruder.user_id, [BigInt(good.transaction_id)])).toEqual([]);
    expect(await listPlanned(intruder.user_id)).toEqual([]);

    const login = await UserService.attemptLogin('other', '123', false);
    const headers = { authusername: 'other', sessionkey: login.sessionkey, 'content-type': 'application/json' };
    expect((await fetch(`${baseUrl}/planned-transactions/${id}/skip`, { method: 'POST', headers })).status).toBe(401);
    expect((await fetch(`${baseUrl}/planned-transactions/${id}/done`, { method: 'POST', headers })).status).toBe(401);
    expect((await fetch(`${baseUrl}/planned-transactions/${id}/match`, { method: 'POST', headers, body: JSON.stringify({ transaction_id: Number(good.transaction_id) }) })).status).toBe(401);
    expect((await fetch(`${baseUrl}/planned-transactions/${id}/candidates`, { headers })).status).toBe(401);
    expect(await listPlanned(ctx.uid)).toHaveLength(1);

    const own = await UserService.attemptLogin('pt', '123', false);
    const ownHeaders = { authusername: 'pt', sessionkey: own.sessionkey, 'content-type': 'application/json' };
    const list = await (await fetch(`${baseUrl}/planned-transactions`, { headers: ownHeaders })).json();
    expect(list).toHaveLength(1);
    expect(list[0].amount).toBe(15000);
    const m = await (await fetch(`${baseUrl}/planned-transactions/matches?transaction_ids=${good.transaction_id}`, { headers: ownHeaders })).json();
    expect(m).toHaveLength(1);
    expect((await fetch(`${baseUrl}/planned-transactions/${id}/skip`, { method: 'POST', headers: ownHeaders })).status).toBe(200);
  });

  test('manual add and bulk import responses include created transaction ids', async () => {
    const own = await UserService.attemptLogin('pt', '123', false);
    const headers = { authusername: 'pt', sessionkey: own.sessionkey, 'content-type': 'application/json' };
    const res = await fetch(`${baseUrl}/trxs/step1`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 10, type: E, description: 'x', account_from_id: Number(ctx.bank.account_id), date_timestamp: NOW, is_essential: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.transaction_id === 'number' || typeof body.transaction_id === 'string').toBe(true);
    const bulk = await TransactionService.createTransactionsInBulk(ctx.uid, [
      { account_from_id: ctx.bank.account_id, amount: 5, type: E, description: 'a', date_timestamp: NOW, is_essential: false },
    ]);
    expect(bulk.created_ids).toHaveLength(1);
  });

  test('backup round trip restores planned rows with remapped accounts; rows with missing accounts are dropped', async () => {
    await ctx.plan([{}, { account_to_id: ctx.emergency.account_id, description: 'To emergency' }]);
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    expect(backup.planned_transactions).toHaveLength(2);
    backup.planned_transactions.push({ ...backup.planned_transactions[0], planned_id: 9999, accounts_account_from_id: 987654 });
    await UserService.deleteAllUserData(ctx.uid);
    await UserService.restoreUser(ctx.uid, backup);
    const rows = await listPlanned(ctx.uid);
    expect(rows.map((r) => [r.description, r.amount])).toEqual([['Planned savings', 15000], ['To emergency', 15000]]);
    const accts = await prisma.accounts.findMany({ where: { users_user_id: ctx.uid } });
    const byName = new Map(accts.map((a) => [a.name, String(a.account_id)]));
    expect(rows[0].account_from_id).toBe(byName.get('Bank'));
    expect(rows[1].account_to_id).toBe(byName.get('Emergency'));
    expect(rows[0].salary_plan_id).toBeNull();
  });

  test('older backups without planned_transactions restore with none', async () => {
    await ctx.plan([{}]);
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    delete backup.planned_transactions;
    await UserService.deleteAllUserData(ctx.uid);
    await UserService.restoreUser(ctx.uid, backup);
    expect(await listPlanned(ctx.uid)).toEqual([]);
  });
});
