import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import { typicalMonth } from '../../src/services/insights/typicalMonth.js';
import {
  createYearlyCost,
  deleteYearlyCost,
  dismissSuggestion,
  linkTransaction,
  listYearlyCosts,
  sinkingStatus,
  suggestions,
  candidates,
  yearlySetasideMonthlyCents,
} from '../../src/services/planning/yearlyCostService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';
import BackupManager from '../../src/utils/backupManager.js';

const DAY = 86_400;
const E = MYFIN.TRX_TYPES.EXPENSE;
const NOV: YearMonth = { year: 2026, month: 11 };
const NOW = monthRangeIST(NOV).from + 19 * DAY; // 2026-11-20 IST

const monthsBack = (n: number): YearMonth => {
  const idx = 2026 * 12 + 10 - n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
};
const at = (ym: YearMonth, day = 5) => monthRangeIST(ym).from + (day - 1) * DAY + 3600;

async function setup() {
  const user = await UserService.createUser({ username: 'yc', password: '123', email: 'yc@x.com' });
  const uid = user.user_id;
  const bank = await AccountService.createAccount(
    { name: 'Bank', type: MYFIN.ACCOUNT_TYPES.CHECKING, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: uid },
    uid
  );
  const sinking = await prisma.accounts.create({
    data: { name: 'Sinking', type: MYFIN.ACCOUNT_TYPES.SAVINGS, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 1_000_000, users_user_id: uid },
  });
  const cat = await prisma.categories.create({ data: { name: 'Insurance', type: E, users_user_id: uid } });
  const spend = (description: string, amount: number, ym: YearMonth, day = 5, category_id?: bigint) =>
    TransactionService.createTransaction(uid, {
      account_from_id: bank.account_id,
      amount,
      type: E,
      description,
      date_timestamp: at(ym, day),
      is_essential: false,
      category_id,
    } as never);
  return { uid, bank, sinking, cat, spend };
}

describe('yearly costs and sinking fund', () => {
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

  const mkCosts = async () => {
    const insurance = await createYearlyCost(ctx.uid, { name: 'Insurance', amount: 24000, due_month: 3 });
    const course = await createYearlyCost(ctx.uid, { name: 'Course', amount: 12000, due_month: 11 });
    return { insurance, course };
  };

  test('status: behind by, catch up, upcoming', async () => {
    await mkCosts();
    await updateFinancialProfile(ctx.uid, { sinking_fund_account_id: Number(ctx.sinking.account_id) });
    const s = await sinkingStatus(ctx.uid, NOW);
    expect(s).toMatchObject({
      monthly_total: 3000,
      should_have: 16000,
      behind_by: 6000,
      catch_up_this_month: 9000,
      on_track: false,
    });
    expect(s.account).toEqual({ account_id: String(ctx.sinking.account_id), name: 'Sinking', balance: 10000 });
    expect(s.upcoming.map((u) => u.name)).toEqual(['Course']);
    expect(await yearlySetasideMonthlyCents(ctx.uid)).toBe(300_000);
    const list = await listYearlyCosts(ctx.uid);
    expect(list.map((c) => [c.name, c.amount, c.due_month])).toEqual([
      ['Course', 12000, 11],
      ['Insurance', 24000, 3],
    ]);
  });

  test('empty state: no costs, no sinking account', async () => {
    const s = await sinkingStatus(ctx.uid, NOW);
    expect(s).toMatchObject({ account: null, monthly_total: 0, should_have: 0, behind_by: 0, catch_up_this_month: 0, on_track: false, upcoming: [] });
    expect(await suggestions(ctx.uid, NOW)).toEqual([]);
  });

  test('linking takes a payment out of the typical month; filter lists it', async () => {
    const { insurance } = await mkCosts();
    await ctx.spend('Paid to INSURER', 100, monthsBack(3), 5);
    const big = await ctx.spend('Paid to INSURER', 24000, monthsBack(2), 5);
    await ctx.spend('Paid to GROCER', 500, monthsBack(1), 5);
    const before = (await typicalMonth(ctx.uid, NOV)).spendingCents;
    await linkTransaction(ctx.uid, BigInt(big.transaction_id), BigInt(insurance.yearly_cost_id));
    const after = (await typicalMonth(ctx.uid, NOV)).spendingCents;
    expect(before as number).toBeGreaterThan(after as number);
    expect(after).toBe((10_000 + 50_000) / 2); // Sep now has no data
    const linked = await TransactionService.getFilteredTransactionsByForUser(ctx.uid, 0, 50, '', { yearlyCost: 'linked' });
    expect(linked.results.map((t: { transaction_id: bigint }) => String(t.transaction_id))).toEqual([String(big.transaction_id)]);
    expect(String(linked.results[0].yearly_cost_id)).toBe(String(insurance.yearly_cost_id));
    const unlinked = await TransactionService.getFilteredTransactionsByForUser(ctx.uid, 0, 50, '', { yearlyCost: 'unlinked' });
    expect(unlinked.results.length).toBe(2);
  });

  test('suggestions: one-time payee suggested, dismissable; monthly payee never', async () => {
    for (let i = 1; i <= 24; i++) await ctx.spend('Paid to RENT CO', 6000, monthsBack(i), 3);
    await ctx.spend('Paid to LAPTOP SHOP', 18000, monthsBack(1), 12);
    await ctx.spend('Paid to SMALL SHOP', 1000, monthsBack(1), 12);
    const s = await suggestions(ctx.uid, NOW);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ payee_key: 'LAPTOP SHOP', amount: 18000, suggested_due_month: 10 });
    await dismissSuggestion(ctx.uid, 'LAPTOP SHOP');
    expect(await suggestions(ctx.uid, NOW)).toEqual([]);
  });

  test('linked rows are not suggested; candidates by category or payee', async () => {
    const { insurance } = await mkCosts();
    await prisma.yearly_costs.update({ where: { yearly_cost_id: BigInt(insurance.yearly_cost_id) }, data: { category_id: ctx.cat.category_id } });
    const a = await ctx.spend('Paid to INSURER', 24000, monthsBack(2), 5);
    await ctx.spend('Paid to OTHER', 300, monthsBack(2), 6, ctx.cat.category_id);
    await ctx.spend('Paid to UNRELATED', 300, monthsBack(2), 7);
    await linkTransaction(ctx.uid, BigInt(a.transaction_id), BigInt(insurance.yearly_cost_id));
    expect(await suggestions(ctx.uid, NOW)).toEqual([]);
    await ctx.spend('Paid to INSURER', 500, monthsBack(1), 8);
    const c = await candidates(ctx.uid, BigInt(insurance.yearly_cost_id), NOW);
    expect(c.map((x) => x.description).sort()).toEqual(['Paid to INSURER', 'Paid to OTHER']);
  });

  test('deleting a cost unlinks its transactions', async () => {
    const { insurance } = await mkCosts();
    const t = await ctx.spend('Paid to INSURER', 24000, monthsBack(2), 5);
    await linkTransaction(ctx.uid, BigInt(t.transaction_id), BigInt(insurance.yearly_cost_id));
    await deleteYearlyCost(ctx.uid, BigInt(insurance.yearly_cost_id));
    const row = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: BigInt(t.transaction_id) } });
    expect(row.yearly_cost_id).toBeNull();
  });

  test('another user cost gives 401 over HTTP; own cost works', async () => {
    const { insurance } = await mkCosts();
    await UserService.createUser({ username: 'other', password: '123', email: 'o@x.com' });
    const login = await UserService.attemptLogin('other', '123', false);
    const headers = { authusername: 'other', sessionkey: login.sessionkey, 'content-type': 'application/json' };
    const put = await fetch(`${baseUrl}/yearly-costs/${insurance.yearly_cost_id}`, { method: 'PUT', headers, body: JSON.stringify({ name: 'x', amount: 1, due_month: 1 }) });
    expect(put.status).toBe(401);
    const del = await fetch(`${baseUrl}/yearly-costs/${insurance.yearly_cost_id}`, { method: 'DELETE', headers });
    expect(del.status).toBe(401);
    const cand = await fetch(`${baseUrl}/yearly-costs/${insurance.yearly_cost_id}/candidates`, { headers });
    expect(cand.status).toBe(401);
    const list = await fetch(`${baseUrl}/yearly-costs`, { headers });
    expect(list.status).toBe(200);
    expect((await list.json()).costs).toEqual([]);
    const bad = await fetch(`${baseUrl}/yearly-costs`, { method: 'POST', headers, body: JSON.stringify({ name: 'x', amount: 1, due_month: 13 }) });
    expect(bad.status).toBe(400);
  });

  test('backup JSON round trip keeps costs, links and dismissals', async () => {
    const { insurance } = await mkCosts();
    await prisma.yearly_costs.update({ where: { yearly_cost_id: BigInt(insurance.yearly_cost_id) }, data: { category_id: ctx.cat.category_id } });
    const t = await ctx.spend('Paid to INSURER', 24000, monthsBack(2), 5);
    await linkTransaction(ctx.uid, BigInt(t.transaction_id), BigInt(insurance.yearly_cost_id));
    await dismissSuggestion(ctx.uid, 'SOMETHING');
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    await UserService.restoreUser(ctx.uid, backup);
    const costs = await prisma.yearly_costs.findMany({ where: { users_user_id: ctx.uid }, orderBy: { name: 'asc' } });
    expect(costs.map((c) => [c.name, Number(c.amount), c.due_month])).toEqual([['Course', 1_200_000, 11], ['Insurance', 2_400_000, 3]]);
    const cat = await prisma.categories.findFirstOrThrow({ where: { users_user_id: ctx.uid, name: 'Insurance' } });
    expect(costs[1].category_id).toBe(cat.category_id);
    const linked = await prisma.transactions.findMany({ where: { yearly_cost_id: { not: null } } });
    expect(linked.map((x) => x.yearly_cost_id)).toEqual([costs[1].yearly_cost_id]);
    expect(await prisma.yearly_cost_dismissals.count({ where: { users_user_id: ctx.uid } })).toBe(1);
  });
});
