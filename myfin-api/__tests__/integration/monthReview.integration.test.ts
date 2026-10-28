import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import { type YearMonth, monthRangeIST } from '../../src/services/insights/insightsPrimitives.js';
import { monthReview, reviewHistory, setReviewed } from '../../src/services/routines/monthReviewService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';

const DAY = 86_400;
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const E = MYFIN.TRX_TYPES.EXPENSE;
const at = (ym: YearMonth, day: number) => monthRangeIST(ym).from + (day - 1) * DAY + 3600;
const NOW = at(OCT, 5) + 9 * 3600; // 2026-10-05 10:00 IST

async function setup(username = 'review') {
  const user = await UserService.createUser({ username, password: '123', email: `${username}@x.com` });
  const uid = user.user_id;
  const login = await UserService.attemptLogin(username, '123', false);
  const headers = { authusername: username, sessionkey: login.sessionkey, 'content-type': 'application/json' };
  return { uid, headers };
}

const statuses = (r: { steps: { key: string; status: string }[] }) =>
  Object.fromEntries(r.steps.map((s) => [s.key, s.status]));

describe('month-end review', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  async function septemberWithGaps() {
    const bank = await AccountService.createAccount(
      { name: 'Bank', type: MYFIN.ACCOUNT_TYPES.CHECKING, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: ctx.uid } as never,
      ctx.uid
    );
    const food = await prisma.categories.create({ data: { name: 'Food', type: E, users_user_id: ctx.uid } });
    const spend = (day: number, description: string, categoryId: bigint | null) =>
      TransactionService.createTransaction(ctx.uid, {
        account_from_id: bank.account_id,
        account_to_id: null,
        amount: 500,
        category_id: categoryId,
        date_timestamp: at(SEP, day),
        description,
        entity_id: null,
        is_essential: false,
        tags: [],
        type: E,
      });
    const a = await spend(10, 'Mystery 1', null);
    await spend(29, 'Mystery 2', null);
    return { bank, food, a };
  }

  test('a brand-new user: import, reconcile and planned have nothing to do; review and plan are todo', async () => {
    const r = await monthReview(ctx.uid, SEP, NOW);
    expect(r).toMatchObject({ month: '2026-09', total: 6, complete: false, frozen: false, done: 4 });
    expect(statuses(r)).toEqual({
      import: 'nothing_to_do',
      sort: 'done',
      reconcile: 'nothing_to_do',
      planned: 'nothing_to_do',
      review: 'todo',
      plan: 'todo',
    });
    expect(r.steps.every((s) => s.link.startsWith('/') && s.detail_key.length > 0 && s.detail.length > 0)).toBe(true);
    expect(await prisma.monthly_records.count()).toBe(0);
  });

  test('September with gaps, then complete and frozen', async () => {
    const { bank, food } = await septemberWithGaps();
    let r = await monthReview(ctx.uid, SEP, NOW);
    expect(statuses(r)).toMatchObject({ import: 'done', sort: 'todo', reconcile: 'todo', plan: 'todo', review: 'todo' });
    const sort = r.steps.find((s) => s.key === 'sort')!;
    expect(sort.detail_params).toEqual({ count: 2 });
    expect(sort.link).toBe('/transactions?month=2026-09&type=E&category=none');
    expect(r.steps.find((s) => s.key === 'reconcile')!.items).toEqual([
      { id: bank.account_id.toString(), label: 'Bank', link: '/accounts/balance-check' },
    ]);

    // The step's count equals the Transactions drill-down list
    const total = await TransactionService.getFilteredTransactionsByForUser(ctx.uid, 0, 50, '', {
      type: E,
      categoryId: 'none',
      effectiveMonth: SEP,
      excludeAdjustments: true,
    });
    expect(Number(total.total_count)).toBe(2);

    await prisma.transactions.updateMany({ where: { categories_category_id: null }, data: { categories_category_id: food.category_id } });
    await prisma.balance_checks.create({
      data: { accounts_account_id: bank.account_id, checked_at: BigInt(at(OCT, 3)), real_balance: 0n, myfin_balance: 0n, result: 'matched' },
    });
    await prisma.budgets.create({ data: { month: 10, year: 2026, is_open: true, users_user_id: ctx.uid } });
    r = await monthReview(ctx.uid, SEP, NOW);
    expect(statuses(r)).toMatchObject({ sort: 'done', reconcile: 'done', plan: 'done', review: 'todo' });
    expect(r.complete).toBe(false);
    expect(r.frozen).toBe(false);

    await setReviewed(ctx.uid, SEP, true);
    r = await monthReview(ctx.uid, SEP, NOW);
    expect(r).toMatchObject({ complete: true, done: 6, frozen: true });

    // Frozen: later changes don't alter it, and ticking again is a 409
    await prisma.budgets.deleteMany({ where: { users_user_id: ctx.uid } });
    expect((await monthReview(ctx.uid, SEP, NOW)).complete).toBe(true);
    await expect(setReviewed(ctx.uid, SEP, false)).rejects.toMatchObject({ code: 409 });
  });

  test('an incomplete month freezes on the first read from day 11, keeping the ticked flag', async () => {
    await septemberWithGaps();
    await setReviewed(ctx.uid, SEP, true);
    expect(await prisma.monthly_records.count()).toBe(1);
    const day11 = monthRangeIST(OCT).from + 10 * DAY;
    expect((await monthReview(ctx.uid, SEP, day11 - 1)).frozen).toBe(false);
    const r = await monthReview(ctx.uid, SEP, day11);
    expect(r.frozen).toBe(true);
    expect(statuses(r).review).toBe('done');
    expect(r.complete).toBe(false);
    await expect(setReviewed(ctx.uid, SEP, false)).rejects.toMatchObject({ code: 409 });
  });

  test('planned rows dated in the month keep the step open, with links', async () => {
    await septemberWithGaps();
    await prisma.planned_transactions.create({
      data: { users_user_id: ctx.uid, date_timestamp: BigInt(at(SEP, 20)), amount: 1000n, type: 'T', description: 'SIP', created_at: BigInt(NOW) },
    });
    const planned = (await monthReview(ctx.uid, SEP, NOW)).steps.find((s) => s.key === 'planned')!;
    expect(planned.status).toBe('todo');
    expect(planned.link).toBe('/transactions?planned=1');
    expect(planned.items).toHaveLength(1);
  });

  test('history lists 12 months with completion flags', async () => {
    await septemberWithGaps();
    await setReviewed(ctx.uid, SEP, true);
    const hist = await reviewHistory(ctx.uid, NOW);
    expect(hist).toHaveLength(12);
    expect(hist[11]).toMatchObject({ month: '2026-09', total: 6, complete: false });
    expect(hist[0].month).toBe('2025-10');
    expect(hist.every((h) => typeof h.complete === 'boolean')).toBe(true);
  });

  test('a tick committed while the review is being computed survives the freeze', async () => {
    await septemberWithGaps();
    const original = prisma.budgets.count.bind(prisma.budgets);
    const spy = vi.spyOn(prisma.budgets, 'count').mockImplementationOnce(((args: never) => {
      // computeReview's last query: tick the box right now, after `reviewed` was already read as false
      return setReviewed(ctx.uid, SEP, true, NOW).then(() => original(args));
    }) as never);
    const day11 = monthRangeIST(OCT).from + 10 * DAY;
    const r = await monthReview(ctx.uid, SEP, day11);
    spy.mockRestore();
    expect(r.frozen).toBe(true);
    expect(statuses(r).review).toBe('done');
    const stored = await prisma.monthly_records.findFirstOrThrow({ where: { users_user_id: ctx.uid, kind: 'review' } });
    expect((stored.data as { reviewed: boolean }).reviewed).toBe(true);
    expect(stored.frozen_at).not.toBeNull();
  });

  test('unticking an unfrozen month; future and pre-data months are rejected', async () => {
    await septemberWithGaps();
    await setReviewed(ctx.uid, SEP, true, NOW);
    expect(statuses(await monthReview(ctx.uid, SEP, NOW)).review).toBe('done');
    await setReviewed(ctx.uid, SEP, false, NOW);
    expect(statuses(await monthReview(ctx.uid, SEP, NOW)).review).toBe('todo');
    await expect(setReviewed(ctx.uid, { year: 2026, month: 12 }, true, NOW)).rejects.toMatchObject({ code: 400 });
    await expect(setReviewed(ctx.uid, { year: 2020, month: 1 }, true, NOW)).rejects.toMatchObject({ code: 400 });
    expect((await monthReview(ctx.uid, { year: 2020, month: 1 }, NOW)).before_data).toBe(true);
  });

  describe('routes', () => {
    let server: Server;
    let base: string;
    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        server = app.listen(0, () => resolve());
      });
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => server?.close());

    test('GET /review, POST reviewed, GET history; bad input 400', async () => {
      try {
        await septemberWithGaps();
        const post = (month: string, body: unknown) =>
          fetch(`${base}/review/${month}/reviewed`, { method: 'POST', headers: ctx.headers, body: JSON.stringify(body) });
        expect((await post('2026-09', { reviewed: true })).status).toBe(200);
        expect((await post('2026-09', { reviewed: 'x' })).status).toBe(400);
        expect((await post('bad', { reviewed: true })).status).toBe(400);
        expect((await post('2026-12', { reviewed: true })).status).toBe(400);
        expect((await post('2020-01', { reviewed: true })).status).toBe(400);
        expect((await post('2026-09', { reviewed: false })).status).toBe(200);
        await monthReview(ctx.uid, SEP, monthRangeIST(OCT).from + 10 * DAY); // freezes
        expect((await post('2026-09', { reviewed: true })).status).toBe(409);

        const get = await fetch(`${base}/review?month=2026-09`, { headers: ctx.headers });
        expect(get.status).toBe(200);
        expect((await get.json()).month).toBe('2026-09');
        expect((await fetch(`${base}/review`, { headers: ctx.headers })).status).toBe(200);
        expect((await fetch(`${base}/review?month=2026-13`, { headers: ctx.headers })).status).toBe(400);
        const hist = await (await fetch(`${base}/review/history`, { headers: ctx.headers })).json();
        expect(hist).toHaveLength(12);
      } finally {
        server.close();
      }
    });
  });
});
