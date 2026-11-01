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
import { IST_OFFSET_SECONDS, type YearMonth, monthRangeIST, shiftMonth } from './insights/insightsPrimitives.js';
import { fetchRows, typicalMonth } from './insights/typicalMonth.js';
import { salaryRuleFor } from './insights/analyticsRules.js';

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
const SUGGESTION_MONTHS = 6;
export type TemplateSuggestion = {
  category_id: bigint;
  level: 'parent' | 'category';
  current_debit: number;
  current_credit: number;
  suggested_debit: number;
  suggested_credit: number;
};

export default class BudgetTemplateService {
  /** The template with ***templateId***, else the user's oldest one; null when there is none. */
  private static async findTemplate(
    userId: bigint,
    templateId: bigint | undefined,
    db: Prisma.TransactionClient | typeof prisma
  ) {
    if (templateId === undefined)
      return db.budget_templates.findFirst({ where: { users_user_id: userId }, orderBy: { template_id: 'asc' } });
    const template = await db.budget_templates.findFirst({ where: { template_id: templateId, users_user_id: userId } });
    if (!template) throw APIError.notFound();
    return template;
  }

  static async list(userId: bigint) {
    const templates = await prisma.budget_templates.findMany({
      where: { users_user_id: userId },
      orderBy: { template_id: 'asc' },
      include: { rows: { select: { planned_amount_debit: true, planned_amount_credit: true } } },
    });
    return templates.map((t) => ({
      template_id: t.template_id,
      name: t.name,
      updated_at: Number(t.updated_at),
      row_count: t.rows.length,
      total_debit: t.rows.reduce((sum, r) => sum + Number(r.planned_amount_debit), 0) / 100,
      total_credit: t.rows.reduce((sum, r) => sum + Number(r.planned_amount_credit), 0) / 100,
    }));
  }

  private static cleanName(name: unknown) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > 100) throw APIError.badRequest('Invalid template name.');
    return trimmed;
  }

  /** Creates an empty template; the name must be new for the user. */
  static async create(userId: bigint, name: unknown, db: Prisma.TransactionClient | typeof prisma = prisma) {
    const cleaned = BudgetTemplateService.cleanName(name);
    const taken = await db.budget_templates.findFirst({ where: { users_user_id: userId, name: cleaned } });
    if (taken) throw APIError.conflict('A template with this name already exists.');
    return db.budget_templates.create({
      data: { users_user_id: userId, name: cleaned, updated_at: BigInt(nowSeconds()) },
    });
  }

  static async rename(userId: bigint, templateId: bigint, name: unknown) {
    const cleaned = BudgetTemplateService.cleanName(name);
    const template = await BudgetTemplateService.findTemplate(userId, templateId, prisma);
    if (!template) throw APIError.notFound();
    const taken = await prisma.budget_templates.findFirst({
      where: { users_user_id: userId, name: cleaned, NOT: { template_id: templateId } },
    });
    if (taken) throw APIError.conflict('A template with this name already exists.');
    await prisma.budget_templates.update({ where: { template_id: templateId }, data: { name: cleaned } });
  }

  static async remove(userId: bigint, templateId: bigint) {
    await performDatabaseRequest(async (db) => {
      const template = await BudgetTemplateService.findTemplate(userId, templateId, db);
      if (!template) throw APIError.notFound();
      await db.budget_template_rows.deleteMany({ where: { template_id: templateId } });
      await db.budget_templates.delete({ where: { template_id: templateId } });
    });
  }

  static async get(
    userId: bigint,
    db: Prisma.TransactionClient | typeof prisma = prisma,
    templateId?: bigint
  ): Promise<{ rows: TemplateRow[]; updated_at: number | null; template_id: bigint | null; name: string | null }> {
    const found = await BudgetTemplateService.findTemplate(userId, templateId, db);
    if (!found) return { rows: [], updated_at: null, template_id: null, name: null };
    const template = await db.budget_templates.findUnique({
      where: { template_id: found.template_id },
      include: {
        rows: {
          include: { items: { orderBy: [{ direction: 'asc' }, { sort_order: 'asc' }] } },
          orderBy: { categories_category_id: 'asc' },
        },
      },
    });
    if (!template) return { rows: [], updated_at: null, template_id: null, name: null };
    return {
      template_id: template.template_id,
      name: template.name,
      updated_at: Number(template.updated_at),
      rows: template.rows.map((row) => ({
        category_id: row.categories_category_id,
        planned_value_debit: Number(row.planned_amount_debit) / 100,
        planned_value_credit: Number(row.planned_amount_credit) / 100,
        ...serializeItems(row.items),
      })),
    };
  }

  /**
   * Read-only: the average of the last 6 completed months per category (the typical-month rules),
   * next to the template's current amounts. A parent that holds a lump sum in the template gets one
   * rolled-up row and its subcategories none; everything else is suggested per category.
   */
  static async suggestions(
    userId: bigint,
    now: number = nowSeconds(),
    templateId?: bigint
  ): Promise<TemplateSuggestion[]> {
    const d = new Date((now + IST_OFFSET_SECONDS) * 1000);
    const typical = await typicalMonth(
      userId,
      { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 },
      SUGGESTION_MONTHS
    );
    const [categories, template] = await Promise.all([
      prisma.categories.findMany({
        where: { users_user_id: userId },
        select: { category_id: true, status: true, exclude_from_budgets: true, parent_category_id: true },
      }),
      BudgetTemplateService.get(userId, prisma, templateId),
    ]);
    const eligible = new Set(
      categories
        .filter((c) => c.status === MYFIN.CATEGORY_STATUS.ACTIVE && !c.exclude_from_budgets)
        .map((c) => c.category_id.toString())
    );
    const currentOf = new Map(template.rows.map((row) => [row.category_id.toString(), row]));
    const childrenOf = new Map<string, string[]>();
    for (const c of categories) {
      if (c.parent_category_id == null) continue;
      const key = c.parent_category_id.toString();
      childrenOf.set(key, [...(childrenOf.get(key) ?? []), c.category_id.toString()]);
    }
    const avg = (id: string) => typical.byCategory.get(id);
    const sides = (ids: string[]) => {
      let debit = 0;
      let credit = 0;
      for (const id of ids) {
        const entry = avg(id);
        if (!entry || !eligible.has(id)) continue;
        if (entry.kind === 'income') credit += entry.avgCents;
        else debit += entry.avgCents;
      }
      return { debit: debit / 100, credit: credit / 100 };
    };
    const lumpParents = new Set<string>();
    for (const [parentId, kids] of childrenOf) {
      const row = currentOf.get(parentId);
      if (row && kids.length && (row.planned_value_debit > 0 || row.planned_value_credit > 0))
        lumpParents.add(parentId);
    }
    const rolledUp = new Set([...lumpParents].flatMap((id) => childrenOf.get(id) ?? []));

    const out: TemplateSuggestion[] = [];
    for (const c of categories) {
      const id = c.category_id.toString();
      if (!eligible.has(id) || rolledUp.has(id)) continue;
      const isLump = lumpParents.has(id);
      const { debit, credit } = sides(isLump ? [id, ...(childrenOf.get(id) ?? [])] : [id]);
      if (debit === 0 && credit === 0) continue;
      const current = currentOf.get(id);
      out.push({
        category_id: c.category_id,
        level: isLump ? 'parent' : 'category',
        current_debit: current?.planned_value_debit ?? 0,
        current_credit: current?.planned_value_credit ?? 0,
        suggested_debit: debit,
        suggested_credit: credit,
      });
    }
    return out.sort((a, b) => (a.category_id < b.category_id ? -1 : 1));
  }

  static async replace(userId: bigint, rows: TemplateRowInput[], dbClient = undefined, templateId?: bigint) {
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
      await BudgetTemplateService.store(userId, kept, db, templateId);
    }, dbClient);
  }

  /** Writes ***rows*** into the given template (else the oldest, creating "Default" when the user has none). */
  private static async store(
    userId: bigint,
    rows: CentsRow[],
    db: Prisma.TransactionClient,
    templateId?: bigint
  ) {
    const updated_at = BigInt(nowSeconds());
    const existing = await BudgetTemplateService.findTemplate(userId, templateId, db);
    const template = existing
      ? await db.budget_templates.update({ where: { template_id: existing.template_id }, data: { updated_at } })
      : await db.budget_templates.create({ data: { users_user_id: userId, updated_at } });
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

  /** Where a conversion writes: a new template when ***name*** is given, else an existing one (default: the oldest). */
  private static async target(
    userId: bigint,
    db: Prisma.TransactionClient,
    opts: { templateId?: bigint; name?: unknown }
  ) {
    if (opts.name !== undefined) return (await BudgetTemplateService.create(userId, opts.name, db)).template_id;
    return opts.templateId;
  }

  static async fromBudget(
    userId: bigint,
    budgetId: bigint,
    dbClient = undefined,
    opts: { templateId?: bigint; name?: unknown } = {}
  ) {
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
      // A pre-phase budget may hold a parent + subcategory pair: keep the parent's lump sum only.
      const parentRows = await db.categories.findMany({
        where: { users_user_id: userId, category_id: { in: rows.map((r) => r.categoryId) } },
        select: { category_id: true, parent_category_id: true },
      });
      const parentOf = new Map(parentRows.map((c) => [c.category_id, c.parent_category_id]));
      const budgeted = new Set(rows.map((r) => r.categoryId));
      const kept = rows.filter((r) => {
        const parent = parentOf.get(r.categoryId);
        return !(parent && budgeted.has(parent));
      });
      await BudgetTemplateService.store(userId, kept, db, await BudgetTemplateService.target(userId, db, opts));
    }, dbClient);
  }

  /**
   * Turns per-category amounts (cents) into template rows: only active categories that can be budgeted,
   * and a parent plus subcategory pair becomes the parent's lump sum, as a budget requires.
   */
  private static async rowsFromAmounts(userId: bigint, amounts: Map<string, { debit: number; credit: number }>) {
    const categories = await prisma.categories.findMany({
      where: { users_user_id: userId },
      select: { category_id: true, status: true, exclude_from_budgets: true, parent_category_id: true },
    });
    const eligible = new Set(
      categories
        .filter((c) => c.status === MYFIN.CATEGORY_STATUS.ACTIVE && !c.exclude_from_budgets)
        .map((c) => c.category_id.toString())
    );
    const parentOf = new Map(categories.map((c) => [c.category_id.toString(), c.parent_category_id?.toString() ?? null]));
    const merged = new Map<string, { debit: number; credit: number }>();
    for (const [id, value] of amounts) {
      if (!eligible.has(id) || (value.debit <= 0 && value.credit <= 0)) continue;
      const parent = parentOf.get(id);
      // roll into the parent when it can hold the lump sum
      const key = parent && eligible.has(parent) && amounts.has(parent) ? parent : id;
      const entry = merged.get(key) ?? { debit: 0, credit: 0 };
      entry.debit += value.debit;
      entry.credit += value.credit;
      merged.set(key, entry);
    }
    return [...merged].map(
      ([id, value]): CentsRow => ({
        categoryId: BigInt(id),
        debit: BigInt(Math.round(value.debit)),
        credit: BigInt(Math.round(value.credit)),
        expense: [],
        income: [],
      })
    );
  }

  /** Saves the typical month (average of the last 6 completed months) as a template. */
  static async fromTypicalMonth(userId: bigint, opts: { templateId?: bigint; name?: unknown }, now: number = nowSeconds()) {
    const d = new Date((now + IST_OFFSET_SECONDS) * 1000);
    const typical = await typicalMonth(userId, { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }, SUGGESTION_MONTHS);
    const amounts = new Map<string, { debit: number; credit: number }>();
    for (const [id, entry] of typical.byCategory) {
      amounts.set(id, entry.kind === 'income' ? { debit: 0, credit: entry.avgCents } : { debit: entry.avgCents, credit: 0 });
    }
    const rows = await BudgetTemplateService.rowsFromAmounts(userId, amounts);
    return performDatabaseRequest(async (db) => {
      await BudgetTemplateService.store(userId, rows, db, await BudgetTemplateService.target(userId, db, opts));
    });
  }

  /** Saves what one month actually looked like (spending and income per category) as a template. */
  static async fromMonth(userId: bigint, ym: YearMonth, opts: { templateId?: bigint; name?: unknown }) {
    const rule = await salaryRuleFor(userId);
    const rows = await fetchRows(userId, [ym], [monthRangeIST(ym)], rule);
    const amounts = new Map<string, { debit: number; credit: number }>();
    for (const row of rows) {
      if (row.categoryId == null) continue;
      const entry = amounts.get(row.categoryId) ?? { debit: 0, credit: 0 };
      if (row.type === MYFIN.TRX_TYPES.INCOME) entry.credit += row.cents;
      else entry.debit += row.cents;
      amounts.set(row.categoryId, entry);
    }
    const cents = await BudgetTemplateService.rowsFromAmounts(userId, amounts);
    return performDatabaseRequest(async (db) => {
      await BudgetTemplateService.store(userId, cents, db, await BudgetTemplateService.target(userId, db, opts));
    });
  }

  static async createBudgetFromTemplate(userId: bigint, month: number, year: number, templateId?: bigint) {
    const exists = () => APIError.conflict('A budget already exists for this month.');
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.budgets.findFirst({
          where: { users_user_id: userId, month, year },
          select: { budget_id: true },
        });
        if (existing) throw exists();
        const { rows } = await BudgetTemplateService.get(userId, tx, templateId);
        const categories = await tx.categories.findMany({
          where: { users_user_id: userId, category_id: { in: rows.map((row) => row.category_id) } },
          select: { category_id: true, status: true, parent_category_id: true },
        });
        const activeIds = new Set(
          categories.filter((c) => c.status === MYFIN.CATEGORY_STATUS.ACTIVE).map((c) => c.category_id)
        );
        // A stored parent + subcategory pair must not block the month: keep the parent's lump sum,
        // but only when that parent is itself usable (active).
        const parentOf = new Map(categories.map((c) => [c.category_id, c.parent_category_id]));
        const inTemplate = new Set(rows.map((row) => row.category_id));
        const usable = (row: TemplateRow) => {
          if (!activeIds.has(row.category_id)) return false;
          const parent = parentOf.get(row.category_id);
          return !(parent && inTemplate.has(parent) && activeIds.has(parent));
        };
        const skipped_category_ids = rows.filter((row) => !usable(row)).map((row) => row.category_id);
        const values = rows.filter(usable);
        const budget_id = await BudgetService.createBudget(userId, month, year, values, '', tx as never);
        return { budget_id, skipped_category_ids };
      });
    } catch (e) {
      // A concurrent request created the same month between the check and the insert.
      if ((e as { code?: string }).code === 'P2002') throw exists();
      throw e;
    }
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
    const templates = await tx.budget_templates.findMany({ where: { users_user_id: userId } });
    for (const template of templates)
      await BudgetTemplateService.mergeCategoryInTemplate(template.template_id, sourceId, targetId, names, tx);
  }

  private static async mergeCategoryInTemplate(
    template_id: bigint,
    sourceId: bigint,
    targetId: bigint,
    names: { source: string; target: string },
    tx: Prisma.TransactionClient
  ) {
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
