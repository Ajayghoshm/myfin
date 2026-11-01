import { performDatabaseRequest, prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import APIError from '../errorHandling/apiError.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  type BreakdownItem,
  directionTotal,
  normalizeItems,
  serializeItems,
} from './budgetAllocationService.js';
import BudgetService from './budgetService.js';

type Item = { label: string; amount: number; sort_order: number };
export type TemplateRow = {
  category_id: bigint;
  planned_value_debit: number;
  planned_value_credit: number;
  expense_items: Item[];
  income_items: Item[];
};
export type TemplateRowInput = {
  category_id: bigint | number | string;
  planned_value_debit?: number | string;
  planned_value_credit?: number | string;
  expense_items?: BreakdownItem[];
  income_items?: BreakdownItem[];
};
type CentsItem = { label: string; amount: bigint; sort_order: number };
type CentsRow = {
  categoryId: bigint;
  debit: bigint;
  credit: bigint;
  expense: CentsItem[];
  income: CentsItem[];
};

const nowSeconds = () => Math.floor(Date.now() / 1000);

export default class BudgetTemplateService {
  static async get(userId: bigint): Promise<{ rows: TemplateRow[]; updated_at: number | null }> {
    const template = await prisma.budget_templates.findUnique({
      where: { users_user_id: userId },
      include: {
        rows: {
          include: { items: { orderBy: [{ direction: 'asc' }, { sort_order: 'asc' }] } },
          orderBy: { categories_category_id: 'asc' },
        },
      },
    });
    if (!template) return { rows: [], updated_at: null };
    return {
      updated_at: Number(template.updated_at),
      rows: template.rows.map((row) => ({
        category_id: row.categories_category_id,
        planned_value_debit: Number(row.planned_amount_debit) / 100,
        planned_value_credit: Number(row.planned_amount_credit) / 100,
        ...serializeItems(row.items),
      })),
    };
  }

  static async replace(userId: bigint, rows: TemplateRowInput[], dbClient = undefined) {
    if (!Array.isArray(rows)) throw APIError.badRequest('Invalid template rows.');
    for (const row of rows) {
      if (!row || !/^[1-9]\d*$/.test(String(row.category_id)))
        throw APIError.badRequest('Invalid category id.');
    }
    const ids = rows.map((row) => BigInt(row.category_id));
    if (new Set(ids).size !== ids.length)
      throw APIError.badRequest('Each category can appear only once in the template.');
    return performDatabaseRequest(async (db) => {
      const categories = await db.categories.findMany({
        where: { users_user_id: userId, category_id: { in: ids } },
        select: { category_id: true, name: true, status: true, parent_category_id: true },
      });
      if (categories.length !== ids.length) throw APIError.notFound();
      if (categories.some((c) => c.status !== MYFIN.CATEGORY_STATUS.ACTIVE))
        throw APIError.forbidden();
      const parsed: CentsRow[] = rows.map((row, index) => {
        const expense = row.expense_items === undefined ? [] : normalizeItems(row.expense_items);
        const income = row.income_items === undefined ? [] : normalizeItems(row.income_items);
        return {
          categoryId: ids[index],
          debit: directionTotal(0n, row.planned_value_debit ?? 0, expense, []),
          credit: directionTotal(0n, row.planned_value_credit ?? 0, income, []),
          expense,
          income,
        };
      });
      const kept = parsed.filter(
        (row) => row.debit > 0n || row.credit > 0n || row.expense.length || row.income.length
      );
      // Same either/or rule as a budget: a parent or its subcategories, never both.
      const byId = new Map(categories.map((c) => [c.category_id, c]));
      const budgeted = new Set(kept.map((row) => row.categoryId));
      for (const row of kept) {
        const category = byId.get(row.categoryId);
        const parent = category?.parent_category_id;
        if (parent && budgeted.has(parent)) {
          throw APIError.badRequest(
            `"${category.name}" and "${byId.get(parent)?.name}" cannot both be budgeted in the same budget: budget either the parent category or its subcategories. Clear one of them first.`,
            'BUDGET_CATEGORY_CONFLICT'
          );
        }
      }
      await BudgetTemplateService.store(userId, kept, db);
    }, dbClient);
  }

  private static async store(userId: bigint, rows: CentsRow[], db: Prisma.TransactionClient) {
    const updated_at = BigInt(nowSeconds());
    const template = await db.budget_templates.upsert({
      where: { users_user_id: userId },
      create: { users_user_id: userId, updated_at },
      update: { updated_at },
    });
    const template_id = template.template_id;
    await db.budget_template_rows.deleteMany({ where: { template_id } });
    for (const row of rows) {
      const key = { template_id, categories_category_id: row.categoryId };
      await db.budget_template_rows.create({
        data: { ...key, planned_amount_debit: row.debit, planned_amount_credit: row.credit },
      });
      const items = [
        ...row.expense.map((item) => ({ ...key, direction: 'EXPENSE' as const, ...item })),
        ...row.income.map((item) => ({ ...key, direction: 'INCOME' as const, ...item })),
      ];
      if (items.length) await db.budget_template_items.createMany({ data: items });
    }
  }

  static async fromBudget(userId: bigint, budgetId: bigint, dbClient = undefined) {
    return performDatabaseRequest(async (db) => {
      const budget = await db.budgets.findFirst({
        where: { budget_id: budgetId, users_user_id: userId },
        select: { budget_id: true },
      });
      if (!budget) throw APIError.notFound();
      const source = await db.budgets_has_categories.findMany({
        where: { budgets_budget_id: budgetId, budgets_users_user_id: userId },
        include: { breakdown_items: { orderBy: { sort_order: 'asc' } } },
      });
      const rows: CentsRow[] = [];
      for (const row of source) {
        const item = (direction: string): CentsItem[] =>
          row.breakdown_items
            .filter((i) => i.direction === direction)
            .map(({ label, amount, sort_order }) => ({ label, amount, sort_order }));
        const copy = {
          categoryId: row.categories_category_id,
          debit: row.planned_amount_debit,
          credit: row.planned_amount_credit,
          expense: item('EXPENSE'),
          income: item('INCOME'),
        };
        if (copy.debit > 0n || copy.credit > 0n || copy.expense.length || copy.income.length)
          rows.push(copy);
      }
      await BudgetTemplateService.store(userId, rows, db);
    }, dbClient);
  }

  static async createBudgetFromTemplate(userId: bigint, month: number, year: number) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.budgets.findFirst({
        where: { users_user_id: userId, month, year },
        select: { budget_id: true },
      });
      if (existing) throw APIError.conflict('A budget already exists for this month.');
      const { rows } = await BudgetTemplateService.get(userId);
      const active = await tx.categories.findMany({
        where: {
          users_user_id: userId,
          category_id: { in: rows.map((row) => row.category_id) },
          status: MYFIN.CATEGORY_STATUS.ACTIVE,
        },
        select: { category_id: true },
      });
      const activeIds = new Set(active.map((c) => c.category_id));
      const skipped_category_ids = rows
        .filter((row) => !activeIds.has(row.category_id))
        .map((row) => row.category_id);
      const values = rows.filter((row) => activeIds.has(row.category_id));
      const budget_id = await BudgetService.createBudget(userId, month, year, values, '', tx as never);
      return { budget_id, skipped_category_ids };
    });
  }

  /**
   * Merges the template row of ***sourceId*** into ***targetId*** exactly as a budget row is merged:
   * amounts are summed and a balancing item keeps "planned == sum of items" wherever items exist.
   */
  static async mergeCategory(
    userId: bigint,
    sourceId: bigint,
    targetId: bigint,
    names: { source: string; target: string },
    tx: Prisma.TransactionClient
  ) {
    const template = await tx.budget_templates.findUnique({ where: { users_user_id: userId } });
    if (!template) return;
    const { template_id } = template;
    const at = (categoryId: bigint) => ({
      template_id_categories_category_id: { template_id, categories_category_id: categoryId },
    });
    const row = await tx.budget_template_rows.findUnique({ where: at(sourceId) });
    if (!row) return;
    const targetRow = await tx.budget_template_rows.findUnique({ where: at(targetId) });
    let movedItemsOffset = 0;
    if (targetRow) {
      const [srcItems, tgtItems] = await Promise.all([
        tx.budget_template_items.findMany({
          where: { template_id, categories_category_id: sourceId },
        }),
        tx.budget_template_items.findMany({
          where: { template_id, categories_category_id: targetId },
        }),
      ]);
      const maxTargetOrder = tgtItems.reduce((m, i) => Math.max(m, i.sort_order), -1);
      movedItemsOffset = maxTargetOrder + 1;
      let nextOrder = movedItemsOffset + srcItems.length;
      const leftovers = [
        {
          direction: 'INCOME' as const,
          srcAmount: row.planned_amount_credit,
          tgtAmount: targetRow.planned_amount_credit,
        },
        {
          direction: 'EXPENSE' as const,
          srcAmount: row.planned_amount_debit,
          tgtAmount: targetRow.planned_amount_debit,
        },
      ];
      for (const { direction, srcAmount, tgtAmount } of leftovers) {
        const srcHas = srcItems.some((i) => i.direction === direction);
        const tgtHas = tgtItems.some((i) => i.direction === direction);
        if (srcHas === tgtHas) continue;
        const [amount, name] = srcHas ? [tgtAmount, names.target] : [srcAmount, names.source];
        if (amount === 0n) continue;
        await tx.budget_template_items.create({
          data: {
            template_id,
            categories_category_id: targetId,
            direction,
            label: name,
            amount,
            sort_order: nextOrder++,
          },
        });
      }
      await tx.budget_template_rows.update({
        where: at(targetId),
        data: {
          planned_amount_credit: { increment: row.planned_amount_credit },
          planned_amount_debit: { increment: row.planned_amount_debit },
        },
      });
    } else {
      await tx.budget_template_rows.create({
        data: {
          template_id,
          categories_category_id: targetId,
          planned_amount_credit: row.planned_amount_credit,
          planned_amount_debit: row.planned_amount_debit,
        },
      });
    }
    await tx.budget_template_items.updateMany({
      where: { template_id, categories_category_id: sourceId },
      data: {
        categories_category_id: targetId,
        ...(movedItemsOffset > 0 ? { sort_order: { increment: movedItemsOffset } } : {}),
      },
    });
    await tx.budget_template_rows.delete({ where: at(sourceId) });
  }
}
