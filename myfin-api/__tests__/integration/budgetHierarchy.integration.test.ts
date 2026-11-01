import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import BudgetService from '../../src/services/budgetService.js';
import CategoryService from '../../src/services/categoryService.js';
import UserService from '../../src/services/userService.js';

describe('budget parent/subcategory either-or rule', () => {
  let userId: bigint;
  let parentId: bigint;
  let childId: bigint;
  let budgetId: bigint;

  const cat = async (name: string, parent?: bigint) =>
    (
      await prisma.categories.create({
        data: { name, type: 'E', users_user_id: userId, parent_category_id: parent },
      })
    ).category_id;
  const row = (category: bigint, planned: string) => ({
    category_id: category,
    planned_value_debit: planned,
    planned_value_credit: '0',
  });
  const set = (budget: bigint, category: bigint, expense: number) =>
    BudgetService.updateBudgetCategoryPlannedValues(userId, budget, category, expense, 0);

  beforeEach(async () => {
    const user = await UserService.createUser({
      username: 'hier-user',
      password: '123',
      email: 'hier@myfin.test',
    });
    userId = user.user_id;
    parentId = await cat('Food');
    childId = await cat('Groceries', parentId);
    budgetId = await BudgetService.createBudget(userId, 1, 2026, [], '');
  });

  test('rejects budgeting a subcategory when its parent has an amount in that budget', async () => {
    await set(budgetId, parentId, 100);
    await expect(set(budgetId, childId, 10)).rejects.toMatchObject({
      rationale: 'BUDGET_CATEGORY_CONFLICT',
    });
  });

  test('rejects budgeting a parent when a subcategory has an amount', async () => {
    await set(budgetId, childId, 10);
    await expect(set(budgetId, parentId, 100)).rejects.toMatchObject({
      rationale: 'BUDGET_CATEGORY_CONFLICT',
    });
    await expect(
      BudgetService.updateBudgetCategoryPlannedValues(
        userId,
        budgetId,
        parentId,
        undefined,
        undefined,
        undefined,
        { expense_items: [{ label: 'x', amount: 1 }] }
      )
    ).rejects.toMatchObject({ rationale: 'BUDGET_CATEGORY_CONFLICT' });
  });

  test('rejects a conflicting full-budget save whichever row comes first', async () => {
    for (const order of [
      [row(parentId, '100'), row(childId, '10')],
      [row(childId, '10'), row(parentId, '100')],
    ]) {
      await expect(BudgetService.createBudget(userId, 2, 2026, order, '')).rejects.toMatchObject({
        rationale: 'BUDGET_CATEGORY_CONFLICT',
      });
    }
  });

  test('a full-budget save can move an amount between parent and child in either order', async () => {
    await set(budgetId, parentId, 100);
    await BudgetService.updateBudget(userId, budgetId, 1, 2026, [row(childId, '50'), row(parentId, '0')], '');
    await BudgetService.updateBudget(userId, budgetId, 1, 2026, [row(parentId, '70'), row(childId, '0')], '');
    await BudgetService.updateBudget(userId, budgetId, 1, 2026, [row(childId, '40'), row(parentId, '0')], '');
    await BudgetService.updateBudget(userId, budgetId, 1, 2026, [row(parentId, '0'), row(childId, '0')], '');
    const rows = await prisma.budgets_has_categories.findMany({ where: { budgets_budget_id: budgetId } });
    expect(rows.every((r) => r.planned_amount_debit === 0n)).toBe(true);
  });

  test('allows a parent lump sum when subcategory rows are zero', async () => {
    await set(budgetId, childId, 0);
    await set(budgetId, parentId, 100);
    await set(budgetId, parentId, 120);
    const rows = await prisma.budgets_has_categories.findMany({
      where: { budgets_budget_id: budgetId },
    });
    expect(rows).toHaveLength(2);
  });

  test('allows budgeting only subcategories', async () => {
    const other = await cat('Dining', parentId);
    await set(budgetId, childId, 10);
    await set(budgetId, other, 20);
    await set(budgetId, childId, 15);
  });

  test('zero amounts never conflict', async () => {
    await set(budgetId, parentId, 100);
    await set(budgetId, childId, 0);
    await set(budgetId, parentId, 0);
    await set(budgetId, childId, 10);
    await set(budgetId, parentId, 0);
  });

  test('a conflict in another budget does not block this one', async () => {
    const other = await BudgetService.createBudget(userId, 3, 2026, [], '');
    await set(other, parentId, 100);
    await set(budgetId, childId, 10);
  });

  test('matrix cell update (PUT /budgets/:id) enforces the same rule', async () => {
    await set(budgetId, parentId, 100);
    await expect(
      BudgetService.addOrUpdateCategoryValueInBudget(userId, budgetId, childId, 0, 1000)
    ).rejects.toMatchObject({ rationale: 'BUDGET_CATEGORY_CONFLICT' });
  });

  test('moving a category under a parent is rejected when both are budgeted in some budget', async () => {
    const loose = await cat('Snacks');
    await set(budgetId, parentId, 100);
    await set(budgetId, loose, 5);
    await expect(CategoryService.setCategoryParent(userId, loose, parentId)).rejects.toMatchObject({
      code: 406,
    });
  });

  test('moving is allowed when only one of them is budgeted', async () => {
    const loose = await cat('Snacks');
    await set(budgetId, parentId, 100);
    await CategoryService.setCategoryParent(userId, loose, parentId);
    const moved = await prisma.categories.findUniqueOrThrow({ where: { category_id: loose } });
    expect(moved.parent_category_id).toBe(parentId);
  });
});
