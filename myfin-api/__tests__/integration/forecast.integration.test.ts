import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import BudgetService from '../../src/services/budgetService.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import { budgetCompare, forecast, forecastToBudget } from '../../src/services/planning/forecastService.js';
import { createYearlyCost } from '../../src/services/planning/yearlyCostService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';

const DAY = 86_400;
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
const at = (ym: YearMonth, day = 5) => monthRangeIST(ym).from + (day - 1) * DAY + 3600;
const NOW = at({ year: 2026, month: 11 }, 26);
const DEC: YearMonth = { year: 2026, month: 12 };

async function setup(opts: { lastYear?: number | null } = {}) {
  const lastYear = opts.lastYear === undefined ? 15000 : opts.lastYear;
  const user = await UserService.createUser({ username: 'fc', password: '123', email: 'fc@x.com' });
  const uid = user.user_id;
  const bank = await AccountService.createAccount(
    { name: 'Bank', type: MYFIN.ACCOUNT_TYPES.CHECKING, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: uid },
    uid
  );
  const mkCat = (name: string, type: string, extra: object = {}) =>
    prisma.categories.create({ data: { name, type, users_user_id: uid, ...extra } });
  const rent = await mkCat('Rent', E, { is_fixed: true });
  const groceries = await mkCat('Groceries', E);
  const education = await mkCat('Education', E);
  const salary = await mkCat('Salary', I);
  const spend = (amount: number, ym: YearMonth, description: string, category_id?: bigint, day = 5) =>
    TransactionService.createTransaction(uid, {
      account_from_id: bank.account_id,
      amount,
      type: E,
      description,
      date_timestamp: at(ym, day),
      is_essential: false,
      category_id,
    } as never);
  const earn = (amount: number, ym: YearMonth) =>
    TransactionService.createTransaction(uid, {
      account_to_id: bank.account_id,
      amount,
      type: I,
      description: 'Salary',
      date_timestamp: at(ym, 1),
      is_essential: false,
      category_id: salary.category_id,
    } as never);
  const groc = [9000, 10000, 11000];
  for (const [i, m] of [8, 9, 10].entries()) {
    const ym = { year: 2026, month: m };
    await spend(30000, ym, 'LANDLORD', rent.category_id);
    await spend(groc[i], ym, 'GROCER', groceries.category_id);
    await spend(300, ym, 'Misc pocket');
    await earn(100000, ym);
  }
  if (lastYear != null) {
    for (const m of [9, 10, 11]) await spend(10000, { year: 2025, month: m }, 'GROCER', groceries.category_id);
    await spend(lastYear, { year: 2025, month: 12 }, 'GROCER', groceries.category_id);
  }
  await createYearlyCost(uid, { name: 'Course', amount: 12000, due_month: 12, category_id: education.category_id });
  return { uid, rent, groceries, education, salary };
}

const line = (f: Awaited<ReturnType<typeof forecast>>, name: string) => f.categories.find((c) => c.name === name);
const planned = async (uid: bigint, month: YearMonth) => {
  const b = await prisma.budgets.findFirstOrThrow({ where: { users_user_id: uid, month: month.month, year: month.year } });
  const rows = await prisma.budgets_has_categories.findMany({
    where: { budgets_budget_id: b.budget_id },
    include: { categories: true },
  });
  return {
    budget: b,
    by: Object.fromEntries(
      rows.map((r) => [r.categories.name, { debit: Number(r.planned_amount_debit) / 100, credit: Number(r.planned_amount_credit) / 100 }])
    ),
  };
};

describe('forecast to budget', () => {
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

  test('forecast: seasonal factor, yearly costs, total, range, unsorted, income', async () => {
    const ctx = await setup();
    const f = await forecast(ctx.uid, DEC, NOW);
    expect(f.month).toBe('2026-12');
    expect(line(f, 'Rent')).toMatchObject({ kind: 'fixed', amount: 30000, seasonal_factor: null });
    expect(line(f, 'Groceries')).toMatchObject({ kind: 'flexible', amount: 15000, seasonal_factor: 1.5 });
    expect(line(f, 'Education')).toMatchObject({ amount: 12000, yearly_costs: 12000 });
    expect(line(f, 'Salary')).toMatchObject({ kind: 'income', amount: 100000 });
    expect(f).toMatchObject({ total: 57000, low: 56200, high: 57800, unsorted: 300, income: 100000 });
  });

  test('income is the typical monthly income; uncategorised income is shown separately', async () => {
    const ctx = await setup();
    const interest = await prisma.categories.create({ data: { name: 'Interest', type: I, users_user_id: ctx.uid } });
    const cashback = await prisma.categories.create({ data: { name: 'Cashback', type: I, users_user_id: ctx.uid } });
    const bank = await prisma.accounts.findFirstOrThrow({ where: { users_user_id: ctx.uid } });
    const earn = (amount: number, ym: YearMonth, category_id?: bigint) =>
      TransactionService.createTransaction(ctx.uid, {
        account_to_id: bank.account_id,
        amount,
        type: I,
        description: 'Other income',
        date_timestamp: at(ym, 10),
        is_essential: false,
        category_id,
      } as never);
    for (const m of [8, 9, 10]) {
      const ym = { year: 2026, month: m };
      await earn(150, ym, interest.category_id);
      await earn(150, ym, cashback.category_id);
      await earn(5000, ym);
    }
    const f = await forecast(ctx.uid, DEC, NOW);
    // Lines round up separately (200 + 200), the total is the typical income rounded once
    expect(line(f, 'Interest')).toMatchObject({ kind: 'income', amount: 200 });
    expect(line(f, 'Cashback')).toMatchObject({ kind: 'income', amount: 200 });
    expect(f.income).toBe(105300);
    expect(f.uncategorised_income).toBe(5000);
  });

  test('a factor of 2.0 is clamped to 1.5', async () => {
    const ctx = await setup({ lastYear: 20000 });
    const f = await forecast(ctx.uid, DEC, NOW);
    expect(line(f, 'Groceries')).toMatchObject({ amount: 15000, seasonal_factor: 1.5 });
  });

  test('no last-year data: no factor, typical average used', async () => {
    const ctx = await setup({ lastYear: null });
    const f = await forecast(ctx.uid, DEC, NOW);
    expect(line(f, 'Groceries')).toMatchObject({ amount: 10000, seasonal_factor: null });
    expect(f.total).toBe(52000);
  });

  test('yearly cost without a category becomes a Yearly costs line that is not budgeted', async () => {
    const ctx = await setup();
    await createYearlyCost(ctx.uid, { name: 'Misc', amount: 5000, due_month: 12 });
    const f = await forecast(ctx.uid, DEC, NOW);
    expect(f.categories.find((c) => c.category_id === null)).toMatchObject({ name: 'Yearly costs', amount: 5000 });
    expect(f.total).toBe(62000);
    await forecastToBudget(ctx.uid, DEC, 'create', NOW);
    const { by } = await planned(ctx.uid, DEC);
    expect(Object.keys(by).sort()).toEqual(['Education', 'Groceries', 'Rent', 'Salary']);
  });

  test('create makes the budget with exactly the forecast values', async () => {
    const ctx = await setup();
    const res = await forecastToBudget(ctx.uid, DEC, 'create', NOW);
    expect(res.skipped_category_ids).toEqual([]);
    const { budget, by } = await planned(ctx.uid, DEC);
    expect(budget.budget_id.toString()).toBe(res.budget_id);
    expect(by).toEqual({
      Rent: { debit: 30000, credit: 0 },
      Groceries: { debit: 15000, credit: 0 },
      Education: { debit: 12000, credit: 0 },
      Salary: { debit: 0, credit: 100000 },
    });
  });

  test('create when a budget exists gives 409', async () => {
    const ctx = await setup();
    await forecastToBudget(ctx.uid, DEC, 'create', NOW);
    await expect(forecastToBudget(ctx.uid, DEC, 'create', NOW)).rejects.toMatchObject({ code: 409 });
  });

  test('fill_empty keeps non-zero planned amounts; replace overwrites them', async () => {
    const ctx = await setup();
    const budgetId = await BudgetService.createBudget(
      ctx.uid, 12, 2026,
      [{ category_id: String(ctx.groceries.category_id), planned_value_debit: 9000, planned_value_credit: 0 }],
      ''
    );
    const compare = await budgetCompare(ctx.uid, DEC, NOW);
    expect(compare.budget_id).toBe(budgetId.toString());
    expect(compare.rows.find((r) => r.name === 'Groceries')).toMatchObject({
      current_debit: 9000, current_credit: 0, forecast_debit: 15000, forecast_credit: 0, has_breakdown: false,
    });
    await forecastToBudget(ctx.uid, DEC, 'fill_empty', NOW);
    let { by } = await planned(ctx.uid, DEC);
    expect(by.Groceries.debit).toBe(9000);
    expect(by.Rent.debit).toBe(30000);
    expect(by.Salary.credit).toBe(100000);
    await forecastToBudget(ctx.uid, DEC, 'replace', NOW);
    ({ by } = await planned(ctx.uid, DEC));
    expect(by.Groceries.debit).toBe(15000);
  });

  test('categories with breakdown items are untouched and reported; others in the budget are left alone', async () => {
    const ctx = await setup();
    const other = await prisma.categories.create({ data: { name: 'Hobby', type: E, users_user_id: ctx.uid } });
    const budgetId = await BudgetService.createBudget(ctx.uid, 12, 2026, [], '');
    await BudgetService.updateBudgetCategoryPlannedValues(ctx.uid, budgetId, ctx.groceries.category_id, undefined, undefined, undefined, {
      expense_items: [{ label: 'Veg', amount: 4000 }, { label: 'Milk', amount: 1000 }],
    });
    await BudgetService.updateBudgetCategoryPlannedValues(ctx.uid, budgetId, other.category_id, 777, 0);
    for (const mode of ['replace', 'fill_empty'] as const) {
      const res = await forecastToBudget(ctx.uid, DEC, mode, NOW);
      expect(res.skipped_category_ids).toEqual([String(ctx.groceries.category_id)]);
      const { by } = await planned(ctx.uid, DEC);
      expect(by.Groceries.debit).toBe(5000);
      expect(by.Hobby.debit).toBe(777);
      expect(by.Rent.debit).toBe(30000);
    }
    const compare = await budgetCompare(ctx.uid, DEC, NOW);
    expect(compare.rows.find((r) => r.name === 'Groceries')?.has_breakdown).toBe(true);
  });

  test('income-only line leaves the debit untouched', async () => {
    const ctx = await setup();
    const budgetId = await BudgetService.createBudget(ctx.uid, 12, 2026, [], '');
    await BudgetService.updateBudgetCategoryPlannedValues(ctx.uid, budgetId, ctx.salary.category_id, 555, 0);
    await forecastToBudget(ctx.uid, DEC, 'replace', NOW);
    const { by } = await planned(ctx.uid, DEC);
    expect(by.Salary).toEqual({ debit: 555, credit: 100000 });
  });

  test('replace and fill_empty without a budget give 404', async () => {
    const ctx = await setup();
    await expect(forecastToBudget(ctx.uid, DEC, 'replace', NOW)).rejects.toMatchObject({ code: 404 });
    await expect(forecastToBudget(ctx.uid, DEC, 'fill_empty', NOW)).rejects.toMatchObject({ code: 404 });
  });

  test('a missing last-year intermediate month gives no seasonal factor', async () => {
    const ctx = await setup();
    // Remove Oct 2025 (one of the 3 months before T-12): the seasonal rule must not apply
    await prisma.transactions.deleteMany({
      where: { date_timestamp: { gte: monthRangeIST({ year: 2025, month: 10 }).from, lt: monthRangeIST({ year: 2025, month: 10 }).to } },
    });
    const f = await forecast(ctx.uid, DEC, NOW);
    expect(line(f, 'Groceries')).toMatchObject({ amount: 10000, seasonal_factor: null });
  });

  test('inactive categories are reported as skipped and not written', async () => {
    const ctx = await setup();
    await prisma.categories.update({
      where: { category_id: ctx.education.category_id },
      data: { status: MYFIN.CATEGORY_STATUS.INACTIVE },
    });
    const res = await forecastToBudget(ctx.uid, DEC, 'create', NOW);
    expect(res.skipped_category_ids).toEqual([String(ctx.education.category_id)]);
    const { by } = await planned(ctx.uid, DEC);
    expect(by.Education).toBeUndefined();
    expect(by.Rent.debit).toBe(30000);
  });

  test('a new user gets zeros and no lines', async () => {
    const user = await UserService.createUser({ username: 'fresh', password: '123', email: 'fresh@x.com' });
    const f = await forecast(user.user_id, DEC, NOW);
    expect(f).toEqual({ month: '2026-12', income: 0, uncategorised_income: 0, total: 0, low: 0, high: 0, unsorted: 0, categories: [] });
    const c = await budgetCompare(user.user_id, DEC, NOW);
    expect(c).toEqual({ budget_id: null, rows: [] });
  });

  test('HTTP: forecast, compare, create and 409', async () => {
    await setup();
    const login = await UserService.attemptLogin('fc', '123', false);
    const call = async (path: string, init?: RequestInit) => {
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { authusername: 'fc', sessionkey: login.sessionkey, 'content-type': 'application/json' },
      });
      return { status: res.status, body: await res.json() };
    };
    expect((await call('/insights/forecast?month=bad')).status).toBe(400);
    const f = await call('/insights/forecast?month=2026-12');
    expect(f.status).toBe(200);
    expect(f.body.month).toBe('2026-12');
    expect((await call('/insights/forecast/budget-compare?month=2026-12')).body.budget_id).toBeNull();
    const post = (mode: string) =>
      call('/insights/forecast/budget', { method: 'POST', body: JSON.stringify({ month: '2026-12', mode }) });
    expect((await post('create')).status).toBe(200);
    expect((await post('create')).status).toBe(409);
    expect((await post('replace')).body.skipped_category_ids).toEqual([]);
  });
});
