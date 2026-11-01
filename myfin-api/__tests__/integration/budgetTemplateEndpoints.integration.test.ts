import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import BudgetService from '../../src/services/budgetService.js';
import UserService from '../../src/services/userService.js';

describe('budget template HTTP endpoints', () => {
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
    expect(res.body).toMatchObject({ rows: [], updated_at: null, template_id: null });
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

describe('multiple budget templates', () => {
  let baseUrl: string;
  let server: Server;
  let userId: bigint;
  let sessionkey: string;
  let rent: bigint;
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
    const user = await UserService.createUser({ username: 'multi', password: '123', email: 'multi@x.com' });
    userId = user.user_id;
    sessionkey = (await UserService.attemptLogin('multi', '123', false)).sessionkey;
    const mk = (name: string) =>
      prisma.categories.create({ data: { name, type: MYFIN.TRX_TYPES.EXPENSE, users_user_id: userId } });
    rent = (await mk('Rent')).category_id;
    food = (await mk('Food')).category_id;
  });

  const call = async (path: string, method = 'GET', body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { authusername: 'multi', sessionkey, 'content-type': 'application/json' },
    });
    return { status: res.status, body: await res.json() };
  };

  test('templates are created, listed, edited separately, renamed and deleted', async () => {
    const a = await call('/budgets/templates', 'POST', { name: 'Normal' });
    const b = await call('/budgets/templates', 'POST', { name: 'Festival' });
    expect(a.status).toBe(200);
    expect((await call('/budgets/templates', 'POST', { name: 'normal' })).status).toBe(409);

    await call('/budgets/template', 'PUT', {
      template_id: Number(a.body.template_id),
      rows: [{ category_id: Number(rent), planned_value_debit: 100 }],
    });
    await call('/budgets/template', 'PUT', {
      template_id: Number(b.body.template_id),
      rows: [{ category_id: Number(food), planned_value_debit: 50 }],
    });

    const list = await call('/budgets/templates');
    expect(list.body.map((t: { name: string; row_count: number }) => [t.name, t.row_count])).toEqual([
      ['Normal', 1],
      ['Festival', 1],
    ]);
    const festival = await call(`/budgets/template?template_id=${b.body.template_id}`);
    expect(festival.body.rows.map((r: { category_id: string }) => r.category_id)).toEqual([Number(food)]);
    // no id: the oldest template
    expect((await call('/budgets/template')).body.name).toBe('Normal');

    expect((await call(`/budgets/templates/${b.body.template_id}`, 'PUT', { name: 'Diwali' })).status).toBe(200);
    expect((await call(`/budgets/templates/${b.body.template_id}`, 'DELETE')).status).toBe(200);
    expect((await call('/budgets/templates')).body).toHaveLength(1);
  });

  test("a budget is created from the chosen template and another user's template is not reachable", async () => {
    const a = await call('/budgets/templates', 'POST', { name: 'Normal' });
    const b = await call('/budgets/templates', 'POST', { name: 'Festival' });
    await call('/budgets/template', 'PUT', {
      template_id: Number(b.body.template_id),
      rows: [{ category_id: Number(food), planned_value_debit: 50 }],
    });
    const created = await call('/budgets/from-template', 'POST', {
      month: 3,
      year: 2030,
      template_id: Number(b.body.template_id),
    });
    expect(created.status).toBe(200);
    const budget = await call(`/budgets/${created.body.budget_id}`);
    expect(JSON.stringify(budget.body)).toContain('Food');
    expect(JSON.stringify(budget.body)).not.toContain('"planned_amount_debit":100');

    expect((await call(`/budgets/template?template_id=999999`)).status).toBe(404);
    expect(a.body.template_id).toBeDefined();
  });

  test('save as a new named template from the typical month and from a month', async () => {
    const typical = await call('/budgets/template/from-typical', 'POST', { name: 'Typical' });
    expect(typical.status).toBe(200);
    const month = await call('/budgets/template/from-month', 'POST', { name: 'March', month: 3, year: 2030 });
    expect(month.status).toBe(200);
    expect((await call('/budgets/templates')).body.map((t: { name: string }) => t.name)).toEqual([
      'Typical',
      'March',
    ]);
    expect((await call('/budgets/template/from-month', 'POST', { name: 'March', month: 3, year: 2030 })).status).toBe(
      409
    );
  });
});
