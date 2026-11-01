import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import BudgetTemplateService from '../../src/services/budgetTemplateService.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';

const DAY = 86_400;
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
// "Now" is mid-November 2026, so the last 6 completed months are May..October.
const NOW = Math.floor(Date.UTC(2026, 10, 15, 6, 0, 0) / 1000);
const ym = (month: number): YearMonth => ({ year: 2026, month });

describe('budget template suggestions', () => {
  let server: Server;
  let baseUrl: string;
  let uid: bigint;
  let sessionkey: string;
  let bankId: bigint;

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
    const user = await UserService.createUser({ username: 'sug', password: '123', email: 'sug@x.com' });
    uid = user.user_id;
    sessionkey = (await UserService.attemptLogin('sug', '123', false)).sessionkey;
    const bank = await AccountService.createAccount(
      {
        name: 'Bank',
        type: MYFIN.ACCOUNT_TYPES.CHECKING,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: uid,
      },
      uid
    );
    bankId = bank.account_id;
  });

  const mkCat = (
    name: string,
    type = E,
    extra: { parent_category_id?: bigint; status?: string; exclude_from_budgets?: number } = {}
  ) => prisma.categories.create({ data: { name, type, users_user_id: uid, ...extra } });
  const add = (type: string, amount: number, month: number, description: string, categoryId?: bigint) =>
    TransactionService.createTransaction(uid, {
      account_from_id: type === E ? bankId : null,
      account_to_id: type === I ? bankId : null,
      amount,
      category_id: categoryId ?? null,
      date_timestamp: monthRangeIST(ym(month)).from + 3 * DAY,
      description,
      entity_id: null,
      is_essential: false,
      tags: [],
      type,
    });
  const find = (rows: Awaited<ReturnType<typeof BudgetTemplateService.suggestions>>, id: bigint) =>
    rows.find((r) => r.category_id === id);

  test('suggestions use the last 6 months average', async () => {
    const food = await mkCat('Food');
    const salary = await mkCat('Salary', I);
    for (const [i, m] of [5, 6, 7, 8, 9, 10].entries()) {
      await add(E, 100 + i * 10, m, `Shop ${i}`, food.category_id);
      await add(I, 1000, m, 'Pay', salary.category_id);
    }
    await add(E, 9000, 4, 'Too old', food.category_id);
    await add(E, 9000, 11, 'Current month', food.category_id);
    const rows = await BudgetTemplateService.suggestions(uid, NOW);
    expect(find(rows, food.category_id)).toEqual({
      category_id: food.category_id,
      level: 'category',
      current_debit: 0,
      current_credit: 0,
      suggested_debit: 125,
      suggested_credit: 0,
    });
    expect(find(rows, salary.category_id)).toMatchObject({ suggested_debit: 0, suggested_credit: 1000 });
  });

  test('months without data do not drag the average down', async () => {
    const food = await mkCat('Food');
    await add(E, 100, 5, 'A', food.category_id);
    await add(E, 200, 8, 'B', food.category_id);
    const rows = await BudgetTemplateService.suggestions(uid, NOW);
    expect(find(rows, food.category_id)?.suggested_debit).toBe(150);
  });

  test('parent lump sum template gets one rolled-up suggestion on the parent', async () => {
    const home = await mkCat('Home');
    const rent = await mkCat('Rent', E, { parent_category_id: home.category_id });
    const power = await mkCat('Power', E, { parent_category_id: home.category_id });
    for (const m of [8, 9, 10]) {
      await add(E, 100, m, 'Own', home.category_id);
      await add(E, 300, m, 'Rent', rent.category_id);
      await add(E, 50, m, 'Power', power.category_id);
    }
    await BudgetTemplateService.replace(uid, [{ category_id: home.category_id, planned_value_debit: 400 }]);
    const rows = await BudgetTemplateService.suggestions(uid, NOW);
    expect(rows).toEqual([
      {
        category_id: home.category_id,
        level: 'parent',
        current_debit: 400,
        current_credit: 0,
        suggested_debit: 450,
        suggested_credit: 0,
      },
    ]);
  });

  test('subcategory template gets per-subcategory suggestions', async () => {
    const home = await mkCat('Home');
    const rent = await mkCat('Rent', E, { parent_category_id: home.category_id });
    const power = await mkCat('Power', E, { parent_category_id: home.category_id });
    for (const m of [8, 9, 10]) {
      await add(E, 100, m, 'Own', home.category_id);
      await add(E, 300, m, 'Rent', rent.category_id);
      await add(E, 50, m, 'Power', power.category_id);
    }
    await BudgetTemplateService.replace(uid, [{ category_id: rent.category_id, planned_value_debit: 280 }]);
    const rows = await BudgetTemplateService.suggestions(uid, NOW);
    expect(rows.map((r) => r.level)).toEqual(['category', 'category', 'category']);
    expect(find(rows, rent.category_id)).toMatchObject({ current_debit: 280, suggested_debit: 300 });
    expect(find(rows, power.category_id)).toMatchObject({ current_debit: 0, suggested_debit: 50 });
    expect(find(rows, home.category_id)).toMatchObject({ suggested_debit: 100 });
  });

  test('uncategorised spending is ignored', async () => {
    const food = await mkCat('Food');
    await add(E, 100, 8, 'Food', food.category_id);
    await add(E, 5000, 8, 'Mystery');
    const rows = await BudgetTemplateService.suggestions(uid, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].category_id).toBe(food.category_id);
  });

  test('inactive and excluded categories are skipped', async () => {
    const old = await mkCat('Old', E, { status: MYFIN.CATEGORY_STATUS.INACTIVE });
    const excluded = await mkCat('Skip', E, { exclude_from_budgets: 1 });
    await add(E, 100, 8, 'Old', old.category_id);
    await add(E, 100, 8, 'Skip', excluded.category_id);
    expect(await BudgetTemplateService.suggestions(uid, NOW)).toEqual([]);
  });

  test('current values come from the template', async () => {
    const food = await mkCat('Food');
    const salary = await mkCat('Salary', I);
    await add(E, 100, 8, 'Food', food.category_id);
    await add(I, 900, 8, 'Pay', salary.category_id);
    await BudgetTemplateService.replace(uid, [
      { category_id: food.category_id, planned_value_debit: 75.5 },
      { category_id: salary.category_id, planned_value_credit: 850 },
    ]);
    const rows = await BudgetTemplateService.suggestions(uid, NOW);
    expect(find(rows, food.category_id)).toMatchObject({ current_debit: 75.5, suggested_debit: 100 });
    expect(find(rows, salary.category_id)).toMatchObject({ current_credit: 850, suggested_credit: 900 });
  });

  test('endpoint GET /budgets/template/suggestions is not captured by /:id', async () => {
    const res = await fetch(`${baseUrl}/budgets/template/suggestions`, {
      headers: { authusername: 'sug', sessionkey },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
