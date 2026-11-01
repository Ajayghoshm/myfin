import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import CategoryService from '../../src/services/categoryService.js';
import UserService from '../../src/services/userService.js';
import BackupManager from '../../src/utils/backupManager.js';

describe('Category hierarchy', () => {
  let user: { user_id: bigint; username: string };
  let other: { user_id: bigint; username: string };

  const mk = (name: string, userId = user.user_id, parent?: bigint | null) =>
    CategoryService.createCategory({
      name,
      description: '',
      color_gradient: 'red',
      status: 'A',
      type: 'E',
      exclude_from_budgets: 0,
      users_user_id: userId,
      parent_category_id: parent,
    });

  beforeEach(async () => {
    user = await UserService.createUser({
      username: 'demo',
      password: '123',
      email: 'demo@afaneca.com',
    });
    other = await UserService.createUser({
      username: 'other',
      password: '123',
      email: 'other@afaneca.com',
    });
  });

  test('creates a subcategory under a top-level category', async () => {
    const parent = await mk('Food');
    const sub = await mk('Groceries', user.user_id, parent.category_id);
    expect(sub.parent_category_id).toBe(parent.category_id);
  });

  test('rejects a parent that itself has a parent', async () => {
    const top = await mk('Food');
    const sub = await mk('Groceries', user.user_id, top.category_id);
    await expect(mk('Veg', user.user_id, sub.category_id)).rejects.toThrow(
      /cannot be used as a parent/
    );
  });

  test('rejects giving a parent to a category that has subcategories', async () => {
    const a = await mk('A');
    await mk('A1', user.user_id, a.category_id);
    const b = await mk('B');
    await expect(
      CategoryService.setCategoryParent(user.user_id, a.category_id, b.category_id)
    ).rejects.toThrow(/with subcategories/);
  });

  test('rejects a parent owned by another user', async () => {
    const foreign = await mk('Foreign', other.user_id);
    await expect(mk('Mine', user.user_id, foreign.category_id)).rejects.toThrow(
      /Parent category not found/
    );
  });

  test('rejects a category as its own parent', async () => {
    const a = await mk('A');
    await expect(
      CategoryService.setCategoryParent(user.user_id, a.category_id, a.category_id)
    ).rejects.toThrow(/own parent/);
  });

  test('setCategoryParent(null) makes a subcategory top-level', async () => {
    const parent = await mk('Food');
    const sub = await mk('Groceries', user.user_id, parent.category_id);
    await CategoryService.setCategoryParent(user.user_id, sub.category_id, null);
    const reloaded = await prisma.categories.findUnique({
      where: { category_id: sub.category_id },
    });
    expect(reloaded?.parent_category_id).toBeNull();
  });

  test('delete is rejected while subcategories exist, allowed once they are moved', async () => {
    const parent = await mk('Food');
    const sub = await mk('Groceries', user.user_id, parent.category_id);
    await expect(
      CategoryService.deleteCategory(user.user_id, Number(parent.category_id))
    ).rejects.toThrow(/has subcategories/);
    await CategoryService.setCategoryParent(user.user_id, sub.category_id, null);
    await CategoryService.deleteCategory(user.user_id, Number(parent.category_id));
    expect(
      await prisma.categories.findUnique({ where: { category_id: parent.category_id } })
    ).toBeNull();
  });

  test('setCategoryParent rejects a category owned by another user', async () => {
    const foreign = await mk('Foreign', other.user_id);
    const parent = await mk('Food');
    await expect(
      CategoryService.setCategoryParent(user.user_id, foreign.category_id, parent.category_id)
    ).rejects.toThrow(/Category not found/);
  });

  test('moving a category keeps its transactions', async () => {
    const p1 = await mk('P1');
    const p2 = await mk('P2');
    const c = await mk('C', user.user_id, p1.category_id);
    const trx = await prisma.transactions.create({
      data: {
        date_timestamp: 1,
        amount: 1000,
        type: 'E',
        categories_category_id: c.category_id,
      },
    });
    await CategoryService.setCategoryParent(user.user_id, c.category_id, p2.category_id);
    const after = await prisma.transactions.findUnique({
      where: { transaction_id: trx.transaction_id },
    });
    expect(after?.categories_category_id).toBe(c.category_id);
  });

  describe('mergeCategories', () => {
    const mkBudget = (month: number, userId = user.user_id) =>
      prisma.budgets.create({
        data: { month, year: 2026, is_open: true, users_user_id: userId },
      });

    const mkRow = (
      budgetId: bigint,
      categoryId: bigint,
      credit: number,
      debit: number,
      current: number
    ) =>
      prisma.budgets_has_categories.create({
        data: {
          budgets_budget_id: budgetId,
          budgets_users_user_id: user.user_id,
          categories_category_id: categoryId,
          planned_amount_credit: credit,
          planned_amount_debit: debit,
          current_amount: current,
        },
      });

    const mkItem = (
      budgetId: bigint,
      categoryId: bigint,
      label: string,
      sortOrder: number,
      amount = 100,
      direction: 'EXPENSE' | 'INCOME' = 'EXPENSE'
    ) =>
      prisma.budget_category_items.create({
        data: {
          budgets_budget_id: budgetId,
          budgets_users_user_id: user.user_id,
          categories_category_id: categoryId,
          direction,
          label,
          amount,
          sort_order: sortOrder,
        },
      });

    const snapshotCounts = async () => ({
      categories: await prisma.categories.count(),
      transactions: await prisma.transactions.count({
        where: { categories_category_id: { not: null } },
      }),
      rows: await prisma.budgets_has_categories.count(),
      items: await prisma.budget_category_items.count(),
      children: await prisma.categories.count({ where: { parent_category_id: { not: null } } }),
    });

    test('merge moves transactions, rules, events and planned transactions to the target', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      const trx = await prisma.transactions.create({
        data: {
          date_timestamp: 1,
          amount: 1000,
          type: 'E',
          categories_category_id: src.category_id,
        },
      });
      const rule = await prisma.rules.create({
        data: {
          users_user_id: user.user_id,
          assign_category_id: src.category_id,
          assign_is_essential: false,
        },
      });
      const event = await prisma.events.create({
        data: {
          users_user_id: user.user_id,
          name: 'E',
          kind: 'other',
          date: '2026-01-01',
          repeat: 'once',
          category_id: src.category_id,
          created_at: 1,
        },
      });
      const planned = await prisma.planned_transactions.create({
        data: {
          users_user_id: user.user_id,
          date_timestamp: 1,
          amount: 100,
          type: 'E',
          categories_category_id: src.category_id,
          description: 'p',
          created_at: 1,
        },
      });
      const yc = await prisma.yearly_costs.create({
        data: {
          users_user_id: user.user_id,
          name: 'Y',
          amount: 100,
          due_month: 1,
          category_id: src.category_id,
          created_at: 1,
        },
      });
      await prisma.user_financial_profile.create({
        data: { users_user_id: user.user_id, salary_category_id: src.category_id, updated_at: 1 },
      });

      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);

      expect(
        (await prisma.transactions.findUnique({ where: { transaction_id: trx.transaction_id } }))
          ?.categories_category_id
      ).toBe(tgt.category_id);
      expect(
        (await prisma.rules.findFirst({ where: { rule_id: rule.rule_id } }))?.assign_category_id
      ).toBe(tgt.category_id);
      expect(
        (await prisma.events.findUnique({ where: { event_id: event.event_id } }))?.category_id
      ).toBe(tgt.category_id);
      expect(
        (
          await prisma.planned_transactions.findUnique({
            where: { planned_id: planned.planned_id },
          })
        )?.categories_category_id
      ).toBe(tgt.category_id);
      expect(
        (await prisma.yearly_costs.findUnique({ where: { yearly_cost_id: yc.yearly_cost_id } }))
          ?.category_id
      ).toBe(tgt.category_id);
      expect(
        (await prisma.user_financial_profile.findUnique({ where: { users_user_id: user.user_id } }))
          ?.salary_category_id
      ).toBe(tgt.category_id);
    });

    test('merge sums planned amounts when both categories have a row in the same budget', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      const b = await mkBudget(1);
      await mkRow(b.budget_id, src.category_id, 10, 20, 30);
      await mkRow(b.budget_id, tgt.category_id, 1, 2, 3);
      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);
      const rows = await prisma.budgets_has_categories.findMany({
        where: { budgets_budget_id: b.budget_id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].categories_category_id).toBe(tgt.category_id);
      expect(rows[0].planned_amount_credit).toBe(11n);
      expect(rows[0].planned_amount_debit).toBe(22n);
      expect(rows[0].current_amount).toBe(33n);
    });

    test('merge moves budget when only the source has a row', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      const b = await mkBudget(1);
      await mkRow(b.budget_id, src.category_id, 10, 20, 30);
      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);
      const rows = await prisma.budgets_has_categories.findMany({
        where: { budgets_budget_id: b.budget_id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].categories_category_id).toBe(tgt.category_id);
      expect(rows[0].planned_amount_credit).toBe(10n);
      expect(rows[0].planned_amount_debit).toBe(20n);
      expect(rows[0].current_amount).toBe(30n);
    });

    test('merge moves breakdown items', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      const b1 = await mkBudget(1);
      const b2 = await mkBudget(2);
      await mkRow(b1.budget_id, src.category_id, 10, 100, 30);
      await mkRow(b1.budget_id, tgt.category_id, 1, 50, 3);
      await mkRow(b2.budget_id, src.category_id, 5, 5, 5);
      await mkItem(b1.budget_id, src.category_id, 'a', 1, 100);
      await mkItem(b1.budget_id, tgt.category_id, 'b', 1, 50);
      await mkItem(b2.budget_id, src.category_id, 'c', 1, 5);
      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);
      const items = await prisma.budget_category_items.findMany({ orderBy: { label: 'asc' } });
      expect(items.map((i) => i.label)).toEqual(['a', 'b', 'c']);
      expect(items.every((i) => i.categories_category_id === tgt.category_id)).toBe(true);
    });

    const checkInvariant = async (budgetId: bigint, categoryId: bigint) => {
      const row = await prisma.budgets_has_categories.findFirstOrThrow({
        where: { budgets_budget_id: budgetId, categories_category_id: categoryId },
      });
      const items = await prisma.budget_category_items.findMany({
        where: { budgets_budget_id: budgetId, categories_category_id: categoryId },
        orderBy: { sort_order: 'asc' },
      });
      const sum = (d: 'EXPENSE' | 'INCOME') =>
        items.filter((i) => i.direction === d).reduce((a, i) => a + i.amount, 0n);
      return { row, items, debit: sum('EXPENSE'), credit: sum('INCOME') };
    };

    test('merge keeps planned == item sum when only the source has items', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      const b = await mkBudget(1);
      await mkRow(b.budget_id, src.category_id, 0, 100, 0);
      await mkRow(b.budget_id, tgt.category_id, 0, 500, 0);
      await mkItem(b.budget_id, src.category_id, 'Lunch', 0, 100);
      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);
      const r = await checkInvariant(b.budget_id, tgt.category_id);
      expect(r.row.planned_amount_debit).toBe(600n);
      expect(r.debit).toBe(600n);
      expect(r.items.map((i) => i.label)).toEqual(['Lunch', 'Tgt']);
      expect(r.items[1].amount).toBe(500n);
      expect(r.items[1].sort_order).toBeGreaterThan(r.items[0].sort_order);
    });

    test('merge keeps planned == item sum when only the target has items', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      const b = await mkBudget(1);
      await mkRow(b.budget_id, src.category_id, 40, 300, 0);
      await mkRow(b.budget_id, tgt.category_id, 0, 100, 0);
      await mkItem(b.budget_id, tgt.category_id, 'Rent', 0, 100);
      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);
      const r = await checkInvariant(b.budget_id, tgt.category_id);
      expect(r.row.planned_amount_debit).toBe(400n);
      expect(r.debit).toBe(400n);
      // credit side had no items on either side: no items created
      expect(r.row.planned_amount_credit).toBe(40n);
      expect(r.items.filter((i) => i.direction === 'INCOME')).toHaveLength(0);
      expect(r.items.find((i) => i.label === 'Src')?.amount).toBe(300n);
    });

    test('merge keeps the sum when both sides have items', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      const b = await mkBudget(1);
      await mkRow(b.budget_id, src.category_id, 0, 100, 0);
      await mkRow(b.budget_id, tgt.category_id, 0, 70, 0);
      await mkItem(b.budget_id, src.category_id, 'a', 0, 100);
      await mkItem(b.budget_id, tgt.category_id, 'b', 0, 70);
      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);
      const r = await checkInvariant(b.budget_id, tgt.category_id);
      expect(r.row.planned_amount_debit).toBe(170n);
      expect(r.debit).toBe(170n);
      expect(r.items).toHaveLength(2);
      expect(new Set(r.items.map((i) => i.sort_order)).size).toBe(2);
    });

    test('merge creates no items when neither side has items', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      const b = await mkBudget(1);
      await mkRow(b.budget_id, src.category_id, 5, 100, 0);
      await mkRow(b.budget_id, tgt.category_id, 5, 70, 0);
      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);
      expect(await prisma.budget_category_items.count()).toBe(0);
    });

    test('backup then restore succeeds after a mixed merge', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      const b = await mkBudget(1);
      await mkRow(b.budget_id, src.category_id, 0, 100, 0);
      await mkRow(b.budget_id, tgt.category_id, 20, 500, 0);
      await mkItem(b.budget_id, src.category_id, 'Lunch', 0, 100);
      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);
      await prisma.categories.updateMany({
        where: { users_user_id: user.user_id },
        data: { status: 'Ativa' },
      });
      const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(user.user_id)));
      await UserService.restoreUser(user.user_id, backup);
      const row = await prisma.budgets_has_categories.findFirstOrThrow({
        where: { budgets_users_user_id: user.user_id },
      });
      expect(row.planned_amount_debit).toBe(600n);
      expect(await prisma.budget_category_items.count()).toBe(2);
    });

    test('source category no longer exists after merge', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);
      expect(
        await prisma.categories.findUnique({ where: { category_id: src.category_id } })
      ).toBeNull();
      expect(
        await prisma.categories.findUnique({ where: { category_id: tgt.category_id } })
      ).not.toBeNull();
    });

    test('subcategories of the source are re-parented to the target', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt');
      const child = await mk('Child', user.user_id, src.category_id);
      await CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id);
      const reloaded = await prisma.categories.findUnique({
        where: { category_id: child.category_id },
      });
      expect(reloaded?.parent_category_id).toBe(tgt.category_id);
    });

    test('rejects merging into itself', async () => {
      const a = await mk('A');
      await expect(
        CategoryService.mergeCategories(user.user_id, a.category_id, a.category_id)
      ).rejects.toThrow(/into itself/);
    });

    test('rejects target owned by another user', async () => {
      const a = await mk('A');
      const foreign = await mk('Foreign', other.user_id);
      await expect(
        CategoryService.mergeCategories(user.user_id, a.category_id, foreign.category_id)
      ).rejects.toThrow(/Category not found/);
    });

    test('rejects when source has subcategories and target is a subcategory', async () => {
      const src = await mk('Src');
      await mk('SrcChild', user.user_id, src.category_id);
      const top = await mk('Top');
      const tgt = await mk('Tgt', user.user_id, top.category_id);
      await expect(
        CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id)
      ).rejects.toThrow(/with subcategories/);
    });

    test('rejects when target is a subcategory of the source', async () => {
      const src = await mk('Src');
      const tgt = await mk('Tgt', user.user_id, src.category_id);
      await expect(
        CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id)
      ).rejects.toThrow(/into one of its own subcategories/);
    });

    test('failed merge changes nothing', async () => {
      const src = await mk('Src');
      await mk('SrcChild', user.user_id, src.category_id);
      const top = await mk('Top');
      const tgt = await mk('Tgt', user.user_id, top.category_id);
      const b = await mkBudget(1);
      await mkRow(b.budget_id, src.category_id, 10, 20, 30);
      await mkItem(b.budget_id, src.category_id, 'a', 1);
      await prisma.transactions.create({
        data: { date_timestamp: 1, amount: 1, type: 'E', categories_category_id: src.category_id },
      });
      const before = await snapshotCounts();
      await expect(
        CategoryService.mergeCategories(user.user_id, src.category_id, tgt.category_id)
      ).rejects.toThrow();
      expect(await snapshotCounts()).toEqual(before);
      expect(
        await prisma.transactions.count({ where: { categories_category_id: src.category_id } })
      ).toBe(1);
    });
  });
});
