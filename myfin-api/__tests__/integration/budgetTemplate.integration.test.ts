import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import BudgetService from '../../src/services/budgetService.js';
import BudgetTemplateService from '../../src/services/budgetTemplateService.js';
import CategoryService from '../../src/services/categoryService.js';
import UserService from '../../src/services/userService.js';

describe('budget template', () => {
  let userId: bigint;
  let otherId: bigint;
  let food: bigint;
  let rent: bigint;
  let salary: bigint;

  const cat = async (name: string, owner = userId, extra: object = {}) =>
    (
      await prisma.categories.create({
        data: { name, type: 'E', users_user_id: owner, ...extra },
      })
    ).category_id;
  const row = (category: bigint, debit: number, credit = 0, extra: object = {}) => ({
    category_id: category,
    planned_value_debit: debit,
    planned_value_credit: credit,
    ...extra,
  });

  beforeEach(async () => {
    userId = (
      await UserService.createUser({ username: 'tpl', password: '123', email: 'tpl@myfin.test' })
    ).user_id;
    otherId = (
      await UserService.createUser({ username: 'tpl2', password: '123', email: 'tpl2@myfin.test' })
    ).user_id;
    food = await cat('Food');
    rent = await cat('Rent');
    salary = await cat('Salary');
  });

  test('get returns empty template for a new user', async () => {
    expect(await BudgetTemplateService.get(userId)).toEqual({ rows: [], updated_at: null });
  });

  test('replace then get round-trips amounts and items', async () => {
    await BudgetTemplateService.replace(userId, [
      row(food, 30, 0, {
        expense_items: [
          { label: 'Veg', amount: 10.5 },
          { label: 'Meat', amount: 19.5 },
        ],
      }),
      row(rent, 500),
      row(salary, 0, 1000),
    ]);
    const { rows, updated_at } = await BudgetTemplateService.get(userId);
    expect(updated_at).toBeGreaterThan(0);
    const f = rows.find((r) => r.category_id === food)!;
    expect(f.planned_value_debit).toBe(30);
    expect(f.expense_items.map((i) => [i.label, i.amount])).toEqual([
      ['Veg', 10.5],
      ['Meat', 19.5],
    ]);
    expect(rows.find((r) => r.category_id === rent)!.planned_value_debit).toBe(500);
    expect(rows.find((r) => r.category_id === salary)!.planned_value_credit).toBe(1000);
    // replace is a full replacement
    await BudgetTemplateService.replace(userId, [row(rent, 600)]);
    const again = await BudgetTemplateService.get(userId);
    expect(again.rows).toHaveLength(1);
    expect(again.rows[0].planned_value_debit).toBe(600);
  });

  test("replace rejects another user's category", async () => {
    const foreign = await cat('Foreign', otherId);
    await expect(BudgetTemplateService.replace(userId, [row(foreign, 5)])).rejects.toThrow();
    expect((await BudgetTemplateService.get(userId)).rows).toEqual([]);
  });

  test('replace rejects inactive category', async () => {
    const dead = await cat('Dead', userId, { status: 'Inativa' });
    await expect(BudgetTemplateService.replace(userId, [row(dead, 5)])).rejects.toMatchObject({
      code: 403,
    });
  });

  test('replace rejects the either/or conflict', async () => {
    const child = await cat('Groceries', userId, { parent_category_id: food });
    await expect(
      BudgetTemplateService.replace(userId, [row(food, 100), row(child, 10)])
    ).rejects.toMatchObject({ rationale: 'BUDGET_CATEGORY_CONFLICT' });
    // either alone is fine
    await BudgetTemplateService.replace(userId, [row(child, 10)]);
  });

  test('replace rejects items that do not match planned totals when both given', async () => {
    await expect(
      BudgetTemplateService.replace(userId, [
        row(food, 50, 0, { expense_items: [{ label: 'A', amount: 10 }] }),
      ])
    ).rejects.toMatchObject({ rationale: 'BUDGET_BREAKDOWN_CONFLICT' });
  });

  test('fromBudget copies non-zero rows and items', async () => {
    const budgetId = await BudgetService.createBudget(
      userId,
      3,
      2026,
      [
        row(food, 30, 0, { expense_items: [{ label: 'Veg', amount: 30 }] }),
        row(rent, 0, 0),
        row(salary, 0, 900),
      ],
      ''
    );
    await BudgetTemplateService.replace(userId, [row(rent, 1)]);
    await BudgetTemplateService.fromBudget(userId, budgetId);
    const { rows } = await BudgetTemplateService.get(userId);
    expect(rows.map((r) => r.category_id).sort()).toEqual([food, salary].sort());
    expect(rows.find((r) => r.category_id === food)!.expense_items).toHaveLength(1);
    expect(rows.find((r) => r.category_id === salary)!.planned_value_credit).toBe(900);
  });

  test('createBudgetFromTemplate creates a budget with the template amounts', async () => {
    await BudgetTemplateService.replace(userId, [
      row(food, 30, 0, { expense_items: [{ label: 'Veg', amount: 30 }] }),
      row(salary, 0, 900),
    ]);
    const res = await BudgetTemplateService.createBudgetFromTemplate(userId, 4, 2026);
    expect(res.skipped_category_ids).toEqual([]);
    const rows = await prisma.budgets_has_categories.findMany({
      where: { budgets_budget_id: res.budget_id },
      include: { breakdown_items: true },
    });
    expect(rows).toHaveLength(2);
    const f = rows.find((r) => r.categories_category_id === food)!;
    expect(f.planned_amount_debit).toBe(3000n);
    expect(f.breakdown_items).toHaveLength(1);
    expect(rows.find((r) => r.categories_category_id === salary)!.planned_amount_credit).toBe(90000n);
  });

  test('createBudgetFromTemplate returns 409 for an existing month and changes nothing', async () => {
    await BudgetTemplateService.replace(userId, [row(food, 30)]);
    const existing = await BudgetService.createBudget(userId, 5, 2026, [row(rent, 7)], '');
    await expect(
      BudgetTemplateService.createBudgetFromTemplate(userId, 5, 2026)
    ).rejects.toMatchObject({ code: 409 });
    expect(await prisma.budgets.count({ where: { users_user_id: userId } })).toBe(1);
    const rows = await prisma.budgets_has_categories.findMany({
      where: { budgets_budget_id: existing },
    });
    expect(rows.map((r) => r.categories_category_id)).toEqual([rent]);
  });

  test('createBudgetFromTemplate skips inactive categories and reports them', async () => {
    await BudgetTemplateService.replace(userId, [row(food, 30), row(rent, 500)]);
    await prisma.categories.update({ where: { category_id: rent }, data: { status: 'Inativa' } });
    const res = await BudgetTemplateService.createBudgetFromTemplate(userId, 6, 2026);
    expect(res.skipped_category_ids).toEqual([rent]);
    const rows = await prisma.budgets_has_categories.findMany({
      where: { budgets_budget_id: res.budget_id },
    });
    expect(rows.map((r) => r.categories_category_id)).toEqual([food]);
  });

  test('deleting a category removes its template rows', async () => {
    await BudgetTemplateService.replace(userId, [
      row(food, 30, 0, { expense_items: [{ label: 'Veg', amount: 30 }] }),
      row(rent, 500),
    ]);
    await CategoryService.deleteCategory(userId, Number(food));
    const { rows } = await BudgetTemplateService.get(userId);
    expect(rows.map((r) => r.category_id)).toEqual([rent]);
    expect(await prisma.budget_template_items.count()).toBe(0);
  });

  test('merging categories sums template rows and keeps planned == item sum', async () => {
    await BudgetTemplateService.replace(userId, [
      row(food, 30, 0, { expense_items: [{ label: 'Veg', amount: 30 }] }),
      row(rent, 500),
    ]);
    await CategoryService.mergeCategories(userId, rent, food);
    const { rows } = await BudgetTemplateService.get(userId);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.category_id).toBe(food);
    expect(r.planned_value_debit).toBe(530);
    expect(r.expense_items.reduce((s, i) => s + i.amount, 0)).toBe(530);
  });

  test('deleteAllUserData removes the template', async () => {
    await BudgetTemplateService.replace(userId, [
      row(food, 30, 0, { expense_items: [{ label: 'Veg', amount: 30 }] }),
    ]);
    await UserService.deleteAllUserData(userId);
    expect(await prisma.budget_templates.count({ where: { users_user_id: userId } })).toBe(0);
    expect(await prisma.budget_template_rows.count()).toBe(0);
    expect(await prisma.budget_template_items.count()).toBe(0);
  });

  describe('hierarchy changes vs the template', () => {
    test('setCategoryParent is rejected when the category and the new parent are both in the template', async () => {
      const child = await cat('Groceries');
      await BudgetTemplateService.replace(userId, [row(food, 100), row(child, 10)]);
      await expect(CategoryService.setCategoryParent(userId, child, food)).rejects.toMatchObject({
        code: 406,
      });
      const after = await prisma.categories.findUnique({ where: { category_id: child } });
      expect(after!.parent_category_id).toBeNull();
    });

    test('setCategoryParent is allowed when only one is in the template', async () => {
      const child = await cat('Groceries');
      await BudgetTemplateService.replace(userId, [row(child, 10)]);
      await CategoryService.setCategoryParent(userId, child, food);
      const after = await prisma.categories.findUnique({ where: { category_id: child } });
      expect(after!.parent_category_id).toBe(food);
    });

    test("another user's template conflict does not block setCategoryParent", async () => {
      const child = await cat('Groceries');
      const theirFood = await cat('Food', otherId, { name: 'Food2' });
      const theirChild = await cat('Kid', otherId);
      await BudgetTemplateService.replace(otherId, [row(theirFood, 1), row(theirChild, 1)]);
      // same category ids cannot be shared, so make the other template reference ours via raw rows
      const t = await prisma.budget_templates.findUnique({ where: { users_user_id: otherId } });
      await prisma.budget_template_rows.createMany({
        data: [
          { template_id: t!.template_id, categories_category_id: food, planned_amount_debit: 1n },
          { template_id: t!.template_id, categories_category_id: child, planned_amount_debit: 1n },
        ],
      });
      await CategoryService.setCategoryParent(userId, child, food);
    });

    test('createBudgetFromTemplate keeps the parent and skips a stored conflicting child', async () => {
      const child = await cat('Groceries', userId, { parent_category_id: food });
      await BudgetTemplateService.replace(userId, [row(rent, 5)]);
      const t = await prisma.budget_templates.findUnique({ where: { users_user_id: userId } });
      await prisma.budget_template_rows.createMany({
        data: [
          { template_id: t!.template_id, categories_category_id: food, planned_amount_debit: 10000n },
          { template_id: t!.template_id, categories_category_id: child, planned_amount_debit: 1000n },
        ],
      });
      const res = await BudgetTemplateService.createBudgetFromTemplate(userId, 7, 2026);
      expect(res.skipped_category_ids).toEqual([child]);
      const rows = await prisma.budgets_has_categories.findMany({
        where: { budgets_budget_id: res.budget_id },
      });
      expect(rows.map((r) => r.categories_category_id).sort()).toEqual([food, rent].sort());
      expect(rows.find((r) => r.categories_category_id === food)!.planned_amount_debit).toBe(10000n);
    });

    describe('mergeCategories re-parenting', () => {
      let child: bigint;
      let target: bigint;
      beforeEach(async () => {
        child = await cat('Groceries', userId, { parent_category_id: food });
        target = await cat('Dining');
      });
      const expectUntouched = async () => {
        expect(await prisma.categories.count({ where: { category_id: food } })).toBe(1);
        const c = await prisma.categories.findUnique({ where: { category_id: child } });
        expect(c!.parent_category_id).toBe(food);
      };

      test('rejected when a child and the target are budgeted in the same budget', async () => {
        const b = await BudgetService.createBudget(userId, 1, 2026, [row(child, 5), row(target, 7)], '');
        expect(b).toBeDefined();
        await expect(CategoryService.mergeCategories(userId, food, target)).rejects.toMatchObject({
          code: 406,
        });
        await expectUntouched();
      });

      test('rejected when a child and the target are both in the template', async () => {
        await BudgetTemplateService.replace(userId, [row(child, 5), row(target, 7)]);
        await expect(CategoryService.mergeCategories(userId, food, target)).rejects.toMatchObject({
          code: 406,
        });
        await expectUntouched();
      });

      test('allowed when they are budgeted in different budgets', async () => {
        await BudgetService.createBudget(userId, 1, 2026, [row(child, 5)], '');
        await BudgetService.createBudget(userId, 2, 2026, [row(target, 7)], '');
        await CategoryService.mergeCategories(userId, food, target);
        const c = await prisma.categories.findUnique({ where: { category_id: child } });
        expect(c!.parent_category_id).toBe(target);
      });
    });
  });
});
