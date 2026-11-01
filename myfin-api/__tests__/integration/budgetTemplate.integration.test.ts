import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import BudgetService from '../../src/services/budgetService.js';
import UserService from '../../src/services/userService.js';

describe('budget template endpoints', () => {
  let baseUrl: string;
  let server: Server;
  let userId: bigint;
  let sessionkey: string;
  let rent: bigint;
  let food: bigint;
  let oldCat: bigint;

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
    const user = await UserService.createUser({ username: 'tpl', password: '123', email: 'tpl@x.com' });
    userId = user.user_id;
    sessionkey = (await UserService.attemptLogin('tpl', '123', false)).sessionkey;
    const mk = (name: string, status = MYFIN.CATEGORY_STATUS.ACTIVE) =>
      prisma.categories.create({
        data: { name, type: MYFIN.TRX_TYPES.EXPENSE, users_user_id: userId, status },
      });
    rent = (await mk('Rent')).category_id;
    food = (await mk('Food')).category_id;
    oldCat = (await mk('Old')).category_id;
  });

  const call = async (path: string, method = 'GET', body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { authusername: 'tpl', sessionkey, 'content-type': 'application/json' },
    });
    return { status: res.status, body: await res.json() };
  };

  test('GET /budgets/template is empty for a new user and not captured by /:id', async () => {
    const res = await call('/budgets/template');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rows: [], updated_at: null });
  });

  test('PUT then GET round-trips', async () => {
    const put = await call('/budgets/template', 'PUT', {
      rows: [
        { category_id: Number(rent), planned_value_debit: 500.5 },
        { category_id: String(food), expense_items: [{ label: 'Veg', amount: 20, sort_order: 0 }] },
      ],
    });
    expect(put.status).toBe(200);
    const got = await call('/budgets/template');
    expect(got.body.updated_at).toBeLessThan(10_000_000_000); // seconds, not ms
    const byId = new Map(got.body.rows.map((r: { category_id: string }) => [String(r.category_id), r]));
    expect((byId.get(String(rent)) as { planned_value_debit: number }).planned_value_debit).toBe(500.5);
    expect((byId.get(String(food)) as { planned_value_debit: number }).planned_value_debit).toBe(20);
  });

  test('from-budget copies a budget, from-template creates one, duplicate month is 409', async () => {
    const budgetId = await BudgetService.createBudget(
      userId, 1, 2026,
      [
        { category_id: rent, planned_value_debit: 300, planned_value_credit: 0 },
        { category_id: oldCat, planned_value_debit: 50, planned_value_credit: 0 },
      ] as never,
      ''
    );
    const from = await call('/budgets/template/from-budget', 'POST', { budget_id: Number(budgetId) });
    expect(from.status).toBe(200);
    expect((await call('/budgets/template')).body.rows).toHaveLength(2);

    await prisma.categories.update({
      where: { category_id: oldCat },
      data: { status: MYFIN.CATEGORY_STATUS.INACTIVE },
    });
    const created = await call('/budgets/from-template', 'POST', { month: 2, year: 2026 });
    expect(created.status).toBe(200);
    expect(created.body.budget_id).toBeDefined();
    expect(created.body.skipped_category_ids.map(String)).toEqual([String(oldCat)]);

    const dup = await call('/budgets/from-template', 'POST', { month: 2, year: 2026 });
    expect(dup.status).toBe(409);
  });

  test('malformed rows are rejected with 400', async () => {
    expect((await call('/budgets/template', 'PUT', { rows: [{ category_id: 'abc' }] })).status).toBe(400);
    expect(
      (await call('/budgets/template', 'PUT', { rows: [{ category_id: Number(rent), planned_value_debit: -1 }] })).status
    ).toBe(400);
    expect((await call('/budgets/template', 'PUT', {})).status).toBe(400);
    expect((await call('/budgets/from-template', 'POST', { month: 13, year: 2026 })).status).toBe(400);
  });
});
