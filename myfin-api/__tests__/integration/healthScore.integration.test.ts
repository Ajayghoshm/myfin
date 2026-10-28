import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import {
  EMI_SHARE_MAX,
  FIXED_SHARE_MAX,
  healthForMonth,
  healthHistory,
  healthScore,
} from '../../src/services/routines/healthScoreService.js';
import { getOrFreeze } from '../../src/services/routines/monthlyRecordService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';

const DAY = 86_400;
const JUL: YearMonth = { year: 2026, month: 7 };
const AUG: YearMonth = { year: 2026, month: 8 };
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
const T = MYFIN.TRX_TYPES.TRANSFER;
const at = (ym: YearMonth, day: number) => monthRangeIST(ym).from + (day - 1) * DAY + 3600;
const NOW = at(OCT, 20) + 9 * 3600; // 2026-10-20 10:00 IST

async function setup(username = 'health') {
  const user = await UserService.createUser({ username, password: '123', email: `${username}@x.com` });
  const uid = user.user_id;
  const mk = (name: string, type: string) =>
    AccountService.createAccount(
      { name, type, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: uid } as never,
      uid
    );
  const login = await UserService.attemptLogin(username, '123', false);
  const headers = { authusername: username, sessionkey: login.sessionkey, 'content-type': 'application/json' };
  return { uid, mk, headers };
}

async function scenario(ctx: Awaited<ReturnType<typeof setup>>) {
  const { uid } = ctx;
  const bank = await ctx.mk('Bank', MYFIN.ACCOUNT_TYPES.CHECKING);
  const card = await ctx.mk('Card', MYFIN.ACCOUNT_TYPES.CREDIT);
  const cat = (name: string, type: string, is_fixed = false) =>
    prisma.categories.create({ data: { name, type, users_user_id: uid, is_fixed } });
  const salary = await cat('Salary', I);
  const rent = await cat('Rent', E, true);
  const food = await cat('Food', E);
  const add = (t: { type: string; amount: number; ym: YearMonth; day: number; description: string; categoryId?: bigint; from?: bigint | null; to?: bigint | null }) =>
    TransactionService.createTransaction(uid, {
      account_from_id: t.from !== undefined ? t.from : t.type === I ? null : bank.account_id,
      account_to_id: t.to !== undefined ? t.to : t.type === I ? bank.account_id : null,
      amount: t.amount,
      category_id: t.categoryId ?? null,
      date_timestamp: at(t.ym, t.day),
      description: t.description,
      entity_id: null,
      is_essential: false,
      tags: [],
      type: t.type,
    });
  for (const ym of [JUL, AUG, SEP]) {
    await add({ type: I, amount: 100000, ym, day: 1, description: 'Salary', categoryId: salary.category_id });
    await add({ type: E, amount: 40000, ym, day: 2, description: 'Paid to LANDLORD', categoryId: rent.category_id });
    await add({ type: E, amount: 30000, ym, day: 3, description: 'Paid to GROCER', categoryId: food.category_id });
  }
  // October: income 1,00,000, spending 75,000 -> 25 %
  await add({ type: I, amount: 100000, ym: OCT, day: 1, description: 'Salary', categoryId: salary.category_id });
  await add({ type: E, amount: 40000, ym: OCT, day: 2, description: 'Paid to LANDLORD', categoryId: rent.category_id });
  await add({ type: E, amount: 20000, ym: OCT, day: 3, description: 'Paid to GROCER', categoryId: food.category_id });
  await add({ type: E, amount: 15000, ym: OCT, day: 18, description: 'Paid to GROCER', categoryId: food.category_id });
  // Card: -10,000 at the end of September, cleared by a transfer on Oct 5
  await add({ type: E, amount: 10000, ym: SEP, day: 10, description: 'Shop', from: card.account_id, to: null });
  await add({ type: T, amount: 10000, ym: OCT, day: 5, description: 'Card bill', from: bank.account_id, to: card.account_id });

  await updateFinancialProfile(uid, { savings_target_mode: 'percent', savings_target_value: 20 });
  // Emergency fund: 80,000 against 40,000 typical fixed = 2.0 months (target 6); never stale
  await prisma.accounts.create({
    data: { name: 'EF', type: MYFIN.ACCOUNT_TYPES.SAVINGS, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 8_000_000, users_user_id: uid, is_emergency_fund: true, stale_after_days: 0 },
  });
  // One stale account (no transactions ever)
  await prisma.accounts.create({
    data: { name: 'Old wallet', type: MYFIN.ACCOUNT_TYPES.OTHER, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: uid },
  });
  // One open loan with a 45,000 EMI
  const loan = await prisma.debts.create({
    data: { users_user_id: uid, kind: 'loan', counterparty_name: 'Home loan', principal: 500_000_000n, emi: 4_500_000n, emi_day: 5, start_date: BigInt(at(JUL, 1)), status: 'open', created_at: BigInt(at(JUL, 1)) },
  });
  return { bank, card, loan, add };
}

const byKey = (h: { checks: { key: string; status: string }[] }) =>
  Object.fromEntries(h.checks.map((c) => [c.key, c.status]));

describe('financial health score', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  test('thresholds are constants', () => {
    expect(FIXED_SHARE_MAX).toBe(0.5);
    expect(EMI_SHARE_MAX).toBe(0.4);
  });

  test('a brand-new user scores 0 of 0, every check not set up with a link', async () => {
    const h = await healthScore(ctx.uid, OCT, NOW);
    expect(h.month).toBe('2026-10');
    expect(h.total).toBe(0);
    expect(h.passed).toBe(0);
    expect(h.checks.map((c) => c.key)).toEqual([
      'savings_rate',
      'emergency_fund',
      'yearly_costs',
      'fixed_costs',
      'credit_cards',
      'debt_emis',
      'data',
    ]);
    for (const c of h.checks) {
      expect(c.status).toBe('not_set_up');
      expect(c.link).toMatch(/^\//);
      expect(c.hint.length).toBeGreaterThan(0);
    }
  });

  test('October scenario: 3 of 6 passed', async () => {
    await scenario(ctx);
    const h = await healthScore(ctx.uid, OCT, NOW);
    expect(byKey(h)).toEqual({
      savings_rate: 'pass',
      emergency_fund: 'fail',
      yearly_costs: 'not_set_up',
      fixed_costs: 'pass',
      credit_cards: 'pass',
      debt_emis: 'fail',
      data: 'fail',
    });
    expect(h.total).toBe(6);
    expect(h.passed).toBe(3);
    const check = (k: string) => h.checks.find((c) => c.key === k)!;
    expect(check('savings_rate').value).toBe('25 %');
    expect(check('emergency_fund').value).toBe('2.0 of 6 months');
    expect(check('fixed_costs').value).toBe('40 % of income');
    expect(check('debt_emis').value).toBe('45 % of income');
    expect(check('debt_emis').hint).toContain('40 %');
    expect(check('fixed_costs').hint).toContain('50 %');
    expect(check('debt_emis').link).toBe('/debts');
    expect(check('credit_cards').link).toBe('/accounts/balance-check');
    expect(check('yearly_costs').link).toBe('/yearly-costs');
  });

  test('a card not cleared within 35 days fails; a running window is not set up', async () => {
    const { card, bank, add } = await scenario(ctx);
    // Another card owing 5,000 at the end of September, never paid
    const card2 = await ctx.mk('Card 2', MYFIN.ACCOUNT_TYPES.CREDIT);
    await add({ type: E, amount: 5000, ym: SEP, day: 12, description: 'Shop', from: card2.account_id, to: null });
    // Window still running on Oct 20
    expect(byKey(await healthScore(ctx.uid, OCT, NOW)).credit_cards).toBe('pass');
    // After 35 days, card 2 fails
    const later = monthRangeIST(OCT).from + 36 * DAY;
    expect(byKey(await healthScore(ctx.uid, OCT, later)).credit_cards).toBe('fail');
    // Only a running window (card 1 removed) -> not set up
    await prisma.accounts.update({ where: { account_id: card.account_id }, data: { status: MYFIN.ACCOUNT_STATUS.INACTIVE } });
    expect(byKey(await healthScore(ctx.uid, OCT, NOW)).credit_cards).toBe('not_set_up');
    expect(bank).toBeTruthy();
  });

  test('a balance check dated in the month is the reference', async () => {
    const { card } = await scenario(ctx);
    // A check on Oct 6 showing -3,000 owed; nothing paid since -> window running
    await prisma.balance_checks.create({
      data: { accounts_account_id: card.account_id, checked_at: BigInt(at(OCT, 6)), real_balance: -300000n, myfin_balance: -300000n, result: 'matched' },
    });
    expect(byKey(await healthScore(ctx.uid, OCT, NOW)).credit_cards).toBe('not_set_up');
    expect(byKey(await healthScore(ctx.uid, OCT, at(OCT, 6) + 36 * DAY)).credit_cards).toBe('fail');
  });

  test('past months are frozen on first read; the current month stays live', async () => {
    const { loan } = await scenario(ctx);
    const sep1 = await healthForMonth(ctx.uid, SEP, NOW);
    expect(sep1.frozen).toBe(true);
    const stored = await prisma.monthly_records.findUnique({
      where: { users_user_id_month_kind: { users_user_id: ctx.uid, month: 202609, kind: 'health' } },
    });
    expect(stored?.frozen_at).not.toBeNull();
    const oct1 = await healthForMonth(ctx.uid, OCT, NOW);
    expect(oct1.frozen).toBe(false);
    expect(byKey(oct1).debt_emis).toBe('fail');

    // Change the data: the loan is closed, the savings target goes up
    await prisma.debts.update({ where: { debt_id: loan.debt_id }, data: { status: 'settled' } });
    await updateFinancialProfile(ctx.uid, { savings_target_value: 50 });

    const sep2 = await healthForMonth(ctx.uid, SEP, NOW);
    expect(sep2).toEqual(sep1);
    const oct2 = await healthForMonth(ctx.uid, OCT, NOW);
    expect(byKey(oct2).debt_emis).toBe('not_set_up');
    expect(byKey(oct2).savings_rate).toBe('fail');
    expect(await prisma.monthly_records.count({ where: { users_user_id: ctx.uid } })).toBe(1);
  });

  test('getOrFreeze is safe under concurrent first reads', async () => {
    const [a, b] = await Promise.all([
      getOrFreeze(ctx.uid, SEP, 'health', async () => ({ who: 'a' }), NOW),
      getOrFreeze(ctx.uid, SEP, 'health', async () => ({ who: 'b' }), NOW),
    ]);
    expect(a.frozen).toBe(true);
    expect(b.frozen).toBe(true);
    expect(a.data).toEqual(b.data);
    const live = await getOrFreeze(ctx.uid, OCT, 'health', async () => ({ who: 'live' }), NOW);
    expect(live).toEqual({ data: { who: 'live' }, frozen: false });
    expect(await prisma.monthly_records.count({ where: { users_user_id: ctx.uid } })).toBe(1);
  });

  test('history has 12 entries, oldest first; only the current month is live', async () => {
    await scenario(ctx);
    const hist = await healthHistory(ctx.uid, NOW);
    expect(hist).toHaveLength(12);
    expect(hist[0].month).toBe('2025-11');
    expect(hist[11].month).toBe('2026-10');
    expect(hist[11].frozen).toBe(false);
    expect(hist.slice(0, 11).every((h) => h.frozen)).toBe(true);
    expect(hist[11].passed).toBe(3);
    expect(await prisma.monthly_records.count({ where: { users_user_id: ctx.uid } })).toBe(11);
  });

  test('backup round trip keeps monthly records; bad rows are rejected (406); wipe clears them', async () => {
    let server: Server | undefined;
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    try {
      await healthForMonth(ctx.uid, SEP, NOW);
      const before = await prisma.monthly_records.findMany({ where: { users_user_id: ctx.uid } });
      const backup = await (await fetch(`${baseUrl}/user/backup`, { headers: ctx.headers })).json();
      expect(backup.monthly_records).toHaveLength(1);
      const restored = await fetch(`${baseUrl}/user/restore`, { method: 'PUT', headers: ctx.headers, body: JSON.stringify(backup) });
      expect(restored.status).toBe(200);
      const after = await prisma.monthly_records.findMany({ where: { users_user_id: ctx.uid } });
      expect(after.map((r) => [r.month, r.kind, r.data, r.frozen_at])).toEqual(
        before.map((r) => [r.month, r.kind, r.data, r.frozen_at])
      );

      for (const bad of [{ kind: 'bogus' }, { month: 202613 }, { month: 'x' }, { data: 'nope' }, { frozen_at: 'abc' }]) {
        const body = { ...backup, monthly_records: [{ ...backup.monthly_records[0], ...bad }] };
        const res = await fetch(`${baseUrl}/user/restore`, { method: 'PUT', headers: ctx.headers, body: JSON.stringify(body) });
        expect(res.status).toBe(406);
      }
      expect(await prisma.monthly_records.count({ where: { users_user_id: ctx.uid } })).toBe(1);

      // Routes
      const sep = await fetch(`${baseUrl}/insights/health?month=2026-09`, { headers: ctx.headers });
      expect(sep.status).toBe(200);
      expect((await sep.json()).month).toBe('2026-09');
      expect((await fetch(`${baseUrl}/insights/health?month=2026-13`, { headers: ctx.headers })).status).toBe(400);
      const current = await (await fetch(`${baseUrl}/insights/health`, { headers: ctx.headers })).json();
      expect(current.frozen).toBe(false);
      const hist = await (await fetch(`${baseUrl}/insights/health/history`, { headers: ctx.headers })).json();
      expect(hist).toHaveLength(12);

      await UserService.deleteAllUserData(ctx.uid);
      expect(await prisma.monthly_records.count({ where: { users_user_id: ctx.uid } })).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });
});
