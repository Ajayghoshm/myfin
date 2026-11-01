import { performDatabaseRequest, prisma } from '../config/prisma.js';
import { MYFIN, normalizeCategoryIconKey } from '../consts.js';
import APIError from '../errorHandling/apiError.js';
import { Prisma } from '../generated/prisma/client.js';
import DateTimeUtils from '../utils/DateTimeUtils.js';
import Logger from '../utils/Logger.js';
import ConvertUtils from '../utils/convertUtils.js';
import TransactionService from './transactionService.js';

const BudgetHasCategories = prisma.budgets_has_categories;

interface Category {
  category_id?: bigint;
  name?: string;
  description?: string;
  color_gradient?: string;
  icon_key?: string;
  status?: string;
  type?: string;
  exclude_from_budgets?: number;
  is_fixed?: boolean;
  users_user_id?: bigint;
  parent_category_id?: bigint | null;
}

export interface CalculatedCategoryAmounts {
  category_balance_credit: number;
  category_balance_debit: number;
}

class CategoryService {
  /**
   * Fetches all categories associated with ***userId***.
   * @param userId - user id
   * @param selectAttributes - category attributes to be returned. *Undefined* will return them all.
   * @param dbClient - the db client
   */
  static async getAllCategoriesForUser(
    userId: bigint,
    selectAttributes = undefined,
    dbClient = prisma
  ): Promise<Array<Prisma.categoriesWhereInput>> {
    return dbClient.categories.findMany({
      where: { users_user_id: userId },
      select: selectAttributes,
    });
  }

  /**
   * Enforces the one-level hierarchy: the parent must belong to the user, must not be the
   * category itself, must not have a parent, and the category must not have children.
   */
  private static async assertValidParent(
    userId: bigint,
    categoryId: bigint | undefined,
    parentId: bigint | null | undefined,
    dbClient = prisma
  ): Promise<void> {
    if (parentId === null || parentId === undefined) return;
    if (categoryId !== undefined && categoryId === parentId) {
      throw APIError.notAcceptable('A category cannot be its own parent.');
    }
    const parent = await dbClient.categories.findFirst({
      where: { category_id: parentId, users_user_id: userId },
      select: { parent_category_id: true },
    });
    if (!parent) {
      throw APIError.notAcceptable('Parent category not found.');
    }
    if (parent.parent_category_id !== null) {
      throw APIError.notAcceptable('A subcategory cannot be used as a parent.');
    }
    if (categoryId !== undefined) {
      const childCount = await dbClient.categories.count({
        where: { parent_category_id: categoryId, users_user_id: userId },
      });
      if (childCount > 0) {
        throw APIError.notAcceptable('A category with subcategories cannot have a parent.');
      }
    }
  }

  static async setCategoryParent(
    userId: bigint,
    categoryId: bigint,
    parentId: bigint | null,
    dbClient = prisma
  ): Promise<void> {
    const existing = await dbClient.categories.findFirst({
      where: { category_id: categoryId, users_user_id: userId },
      select: { category_id: true },
    });
    if (!existing) {
      throw APIError.notFound('Category not found.');
    }
    await CategoryService.assertValidParent(userId, categoryId, parentId, dbClient);
    if (parentId !== null) {
      const budgeted = {
        OR: [
          { planned_amount_debit: { gt: 0n } },
          { planned_amount_credit: { gt: 0n } },
          { breakdown_items: { some: {} } },
        ],
      };
      const [rows, parentRows] = await Promise.all([
        dbClient.budgets_has_categories.findMany({
          where: { budgets_users_user_id: userId, categories_category_id: categoryId, ...budgeted },
          select: { budgets_budget_id: true },
        }),
        dbClient.budgets_has_categories.findMany({
          where: { budgets_users_user_id: userId, categories_category_id: parentId, ...budgeted },
          select: { budgets_budget_id: true },
        }),
      ]);
      const parentBudgets = new Set(parentRows.map((r) => r.budgets_budget_id));
      if (rows.some((r) => parentBudgets.has(r.budgets_budget_id))) {
        throw APIError.notAcceptable(
          'Both this category and the new parent are budgeted in the same budget. Clear the amounts of one of them in that budget first.'
        );
      }
    }
    await dbClient.categories.update({
      where: { category_id: categoryId },
      data: { parent_category_id: parentId },
    });
  }

  /**
   * Merges ***sourceId*** into ***targetId***: everything that references the source category is
   * re-pointed to the target, the source's subcategories are re-parented to the target and the
   * source is deleted. All or nothing.
   */
  static async mergeCategories(userId: bigint, sourceId: bigint, targetId: bigint): Promise<void> {
    if (sourceId === targetId) {
      throw APIError.notAcceptable('A category cannot be merged into itself.');
    }
    await prisma.$transaction(async (tx) => {
      const [source, target] = await Promise.all([
        tx.categories.findFirst({
          where: { category_id: sourceId, users_user_id: userId },
          select: { category_id: true, name: true },
        }),
        tx.categories.findFirst({
          where: { category_id: targetId, users_user_id: userId },
          select: { parent_category_id: true, name: true },
        }),
      ]);
      if (!source || !target) {
        throw APIError.notFound('Category not found.');
      }
      if (target.parent_category_id === sourceId) {
        throw APIError.notAcceptable('Cannot merge a category into one of its own subcategories.');
      }
      const childCount = await tx.categories.count({
        where: { parent_category_id: sourceId, users_user_id: userId },
      });
      if (childCount > 0 && target.parent_category_id !== null) {
        throw APIError.notAcceptable(
          'A category with subcategories cannot be merged into a subcategory.'
        );
      }

      await tx.categories.updateMany({
        where: { parent_category_id: sourceId, users_user_id: userId },
        data: { parent_category_id: targetId },
      });

      await tx.transactions.updateMany({
        where: { categories_category_id: sourceId },
        data: { categories_category_id: targetId },
      });
      await tx.rules.updateMany({
        where: { users_user_id: userId, assign_category_id: sourceId },
        data: { assign_category_id: targetId },
      });
      await tx.yearly_costs.updateMany({
        where: { users_user_id: userId, category_id: sourceId },
        data: { category_id: targetId },
      });
      await tx.planned_transactions.updateMany({
        where: { users_user_id: userId, categories_category_id: sourceId },
        data: { categories_category_id: targetId },
      });
      await tx.debt_payments.updateMany({
        where: { original_category_id: sourceId, debts: { users_user_id: userId } },
        data: { original_category_id: targetId },
      });
      await tx.events.updateMany({
        where: { users_user_id: userId, category_id: sourceId },
        data: { category_id: targetId },
      });
      await tx.user_financial_profile.updateMany({
        where: { users_user_id: userId, salary_category_id: sourceId },
        data: { salary_category_id: targetId },
      });

      const sourceRows = await tx.budgets_has_categories.findMany({
        where: { budgets_users_user_id: userId, categories_category_id: sourceId },
      });
      for (const row of sourceRows) {
        const key = {
          budgets_budget_id: row.budgets_budget_id,
          budgets_users_user_id: userId,
        };
        const targetRow = await tx.budgets_has_categories.findUnique({
          where: {
            budgets_budget_id_budgets_users_user_id_categories_category_id: {
              ...key,
              categories_category_id: targetId,
            },
          },
        });
        let movedItemsOffset = 0;
        if (targetRow) {
          const [srcItems, tgtItems] = await Promise.all([
            tx.budget_category_items.findMany({
              where: { ...key, categories_category_id: sourceId },
            }),
            tx.budget_category_items.findMany({
              where: { ...key, categories_category_id: targetId },
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
          // Keep "planned amount == sum of breakdown items" wherever items exist.
          for (const { direction, srcAmount, tgtAmount } of leftovers) {
            const srcHas = srcItems.some((i) => i.direction === direction);
            const tgtHas = tgtItems.some((i) => i.direction === direction);
            if (srcHas === tgtHas) continue;
            const [amount, name] = srcHas ? [tgtAmount, target.name] : [srcAmount, source.name];
            if (amount === 0n) continue;
            await tx.budget_category_items.create({
              data: {
                ...key,
                categories_category_id: targetId,
                direction,
                label: name,
                amount,
                sort_order: nextOrder++,
              },
            });
          }
          await tx.budgets_has_categories.update({
            where: {
              budgets_budget_id_budgets_users_user_id_categories_category_id: {
                ...key,
                categories_category_id: targetId,
              },
            },
            data: {
              planned_amount_credit: { increment: row.planned_amount_credit },
              planned_amount_debit: { increment: row.planned_amount_debit },
              current_amount: { increment: row.current_amount },
            },
          });
        } else {
          await tx.budgets_has_categories.create({
            data: {
              ...key,
              categories_category_id: targetId,
              planned_amount_credit: row.planned_amount_credit,
              planned_amount_debit: row.planned_amount_debit,
              current_amount: row.current_amount,
            },
          });
        }
        await tx.budget_category_items.updateMany({
          where: { ...key, categories_category_id: sourceId },
          data: {
            categories_category_id: targetId,
            ...(movedItemsOffset > 0 ? { sort_order: { increment: movedItemsOffset } } : {}),
          },
        });
        await tx.budgets_has_categories.delete({
          where: {
            budgets_budget_id_budgets_users_user_id_categories_category_id: {
              ...key,
              categories_category_id: sourceId,
            },
          },
        });
      }

      await tx.categories.delete({ where: { category_id: sourceId } });
    });
  }

  static async createCategory(category: Category, dbClient = prisma) {
    await CategoryService.assertValidParent(
      category.users_user_id,
      undefined,
      category.parent_category_id,
      dbClient
    );
    return dbClient.categories.create({
      data: {
        name: category.name,
        description: category.description,
        color_gradient: category.color_gradient,
        icon_key: normalizeCategoryIconKey(category.icon_key),
        status: category.status,
        exclude_from_budgets: category.exclude_from_budgets,
        is_fixed: category.is_fixed ?? false,
        type: category.type,
        users_user_id: category.users_user_id,
        parent_category_id: category.parent_category_id ?? null,
      },
    });
  }

  static async deleteCategory(userId: bigint, categoryId: number, dbClient = prisma) {
    const childCount = await dbClient.categories.count({
      where: { parent_category_id: BigInt(categoryId), users_user_id: userId },
    });
    if (childCount > 0) {
      throw APIError.notAcceptable('Cannot delete a category that has subcategories.');
    }
    const deleteBudgetHasCategoriesRefs = BudgetHasCategories.deleteMany({
      where: {
        categories_category_id: categoryId,
        budgets_users_user_id: userId,
      },
    });
    const deleteCat = dbClient.categories.delete({
      where: {
        users_user_id: userId,
        category_id: categoryId,
      },
    });

    // Events matched on this category fall back to no category
    const unlinkEvents = dbClient.events.updateMany({
      where: { users_user_id: userId, category_id: BigInt(categoryId) },
      data: { category_id: null },
    });

    return prisma.$transaction([deleteBudgetHasCategoriesRefs, unlinkEvents, deleteCat]);
  }

  static async updateCategory(
    userId: bigint,
    categoryId,
    category: Omit<Prisma.categoriesUpdateInput, 'parent' | 'children' | 'parent_category_id'>,
    dbClient = prisma
  ) {
    return dbClient.categories.update({
      where: {
        users_user_id: userId,
        category_id: categoryId,
      },
      data: category,
    });
  }

  private static buildSqlForExcludedAccountsList(excludedAccs) {
    if (!excludedAccs || excludedAccs.length === 0) {
      return ' -1 ';
    }
    let sql = '';
    for (let cnt = 0; cnt < excludedAccs.length; cnt++) {
      const acc = excludedAccs[cnt].account_id;
      sql += ` '${acc}' `;

      if (cnt !== excludedAccs.length - 1) {
        sql += ', ';
      }
    }
    sql += '';
    return sql;
  }

  static async getAverageAmountForCategoryInLast12Months(
    userId: number | bigint,
    categoryId: number | bigint,
    dbClient = prisma
  ) {
    const firstTimestamp = await TransactionService.getDateTimestampOfFirstTransactionForUser(
      userId as bigint,
      dbClient
    );
    const nrOfTotalMonthsFromFirstTrx = DateTimeUtils.getFullMonthsBetweenDates(
      new Date(Number(firstTimestamp) * 1000),
      new Date()
    );
    const monthYearFrom12MonthsAgo = DateTimeUtils.decrementMonthByX(
      DateTimeUtils.getMonthNumberFromTimestamp(),
      DateTimeUtils.getYearFromTimestamp(),
      12
    );
    const beginDate = new Date(
      monthYearFrom12MonthsAgo.year,
      monthYearFrom12MonthsAgo.month - 1,
      1
    );
    const sumAmounts = (
      await this.getAmountForCategoryInPeriod(
        categoryId,
        beginDate.getTime() / 1000,
        DateTimeUtils.getCurrentUnixTimestamp(),
        true,
        dbClient
      )
    )[0];

    const divisor = nrOfTotalMonthsFromFirstTrx > 12 ? 12 : nrOfTotalMonthsFromFirstTrx;
    return {
      category_balance_credit:
        ConvertUtils.convertBigIntegerToFloat(BigInt(sumAmounts.category_balance_credit ?? 0)) /
        divisor,
      category_balance_debit:
        ConvertUtils.convertBigIntegerToFloat(BigInt(sumAmounts.category_balance_debit ?? 0)) /
        divisor,
    };
  }

  static async getAmountForCategoryInPeriod(
    categoryId: number | bigint,
    fromDate: number,
    toDate: number,
    includeTransfers = true,
    dbClient = prisma
  ): Promise<{
    category_balance_credit: number;
    category_balance_debit: number;
  }> {
    return performDatabaseRequest(async (prismaTx) => {
      const listOfAccountsToExclude = await prismaTx.accounts.findMany({
        where: { exclude_from_budgets: true },
      });

      let sqlQuery;

      if (includeTransfers && listOfAccountsToExclude.length > 0) {
        sqlQuery = prismaTx.$queryRaw`
          SELECT
            SUM(IF(type = 'I', amount, 0)) AS category_balance_credit,
            SUM(IF(type = 'E' OR (type = 'T' AND accounts_account_to_id IN (${Prisma.join(
              listOfAccountsToExclude.map((a) => a.account_id)
            )})), amount, 0)) AS category_balance_debit
          FROM transactions
          WHERE date_timestamp BETWEEN ${fromDate} AND ${toDate}
            AND categories_category_id = ${categoryId}
        `;
      } else {
        // Exclude the IN (...) condition when the list is empty
        sqlQuery = prismaTx.$queryRaw`
        SELECT sum(if(type = 'I', amount, 0)) as 'category_balance_credit',
               sum(if(type = 'E', amount, 0)) as 'category_balance_debit'
        FROM transactions
        WHERE date_timestamp BETWEEN ${fromDate} AND ${toDate}
          AND categories_category_id = ${categoryId}`;
      }

      return sqlQuery;
    }, dbClient);
  }

  static async getAmountForCategoryInMonth(
    categoryId: bigint,
    month: number,
    year: number,
    includeTransfers = true,
    dbClient = prisma
  ): Promise<CalculatedCategoryAmounts> {
    return performDatabaseRequest(async (prismaTx) => {
      const nextMonth = month < 12 ? month + 1 : 1;
      const nextMonthsYear = month < 12 ? year : year + 1;
      const maxDate = DateTimeUtils.getUnixTimestampFromDate(
        new Date(nextMonthsYear, nextMonth - 1, 1)
      );
      const minDate = DateTimeUtils.getUnixTimestampFromDate(new Date(year, month - 1, 1));
      /* Logger.addLog(`cat id: ${categoryId} | month: ${month} | year: ${year} | minDate: ${minDate} | maxDate: ${maxDate}`); */
      const amounts = await this.getAmountForCategoryInPeriod(
        categoryId,
        minDate,
        maxDate,
        includeTransfers,
        prismaTx
      );

      return amounts[0];
    }, dbClient);
  }

  static async getAmountForCategoryInYear(
    categoryId: bigint,
    year: number,
    includeTransfers = true,
    dbClient = prisma
  ): Promise<CalculatedCategoryAmounts> {
    const maxDate = DateTimeUtils.getUnixTimestampFromDate(new Date(year, 11, 31));
    const minDate = DateTimeUtils.getUnixTimestampFromDate(new Date(year, 0, 1));
    /* Logger.addLog(`cat id: ${categoryId} | month: ${month} | year: ${year} | minDate: ${minDate} | maxDate: ${maxDate}`); */
    const amounts = await this.getAmountForCategoryInPeriod(
      categoryId,
      minDate,
      maxDate,
      includeTransfers,
      dbClient
    );

    return amounts[0];
  }

  static async getAverageAmountForCategoryInLifetime(
    userId: number | bigint,
    categoryId: number | bigint,
    dbClient = prisma
  ) {
    const firstTimestamp = await TransactionService.getDateTimestampOfFirstTransactionForUser(
      userId as bigint,
      dbClient
    );
    const nrOfTotalMonthsFromFirstTrx = DateTimeUtils.getFullMonthsBetweenDates(
      new Date(Number(firstTimestamp) * 1000),
      new Date()
    );
    const sumAmounts = (
      await this.getAmountForCategoryInPeriod(
        categoryId,
        0,
        DateTimeUtils.getCurrentUnixTimestamp(),
        true,
        dbClient
      )
    )[0];

    return {
      category_balance_credit:
        ConvertUtils.convertBigIntegerToFloat(BigInt(sumAmounts.category_balance_credit ?? 0)) /
        nrOfTotalMonthsFromFirstTrx,
      category_balance_debit:
        ConvertUtils.convertBigIntegerToFloat(BigInt(sumAmounts.category_balance_debit ?? 0)) /
        nrOfTotalMonthsFromFirstTrx,
    };
  }

  /**
   * Gets all (active) categories for the user, with planned & current amounts
   * related to a specific budget
   */
  static async getAllCategoriesForBudget(
    userId: number | bigint,
    budgetId: number | bigint,
    dbClient = prisma
  ): Promise<Array<Prisma.categoriesUpdateInput>> {
    return dbClient.$queryRaw`SELECT users_user_id,
                                     category_id,
                                     name,
                                     status,
                                     type,
                                     description,
                                     color_gradient,
                                     icon_key,
                                     parent_category_id,
                                     budgets_budget_id,
                                     exclude_from_budgets,
                                     truncate((coalesce(planned_amount_credit, 0) / 100), 2) as planned_amount_credit,
                                     truncate((coalesce(planned_amount_debit, 0) / 100), 2)  as planned_amount_debit,
                                     truncate((coalesce(current_amount, 0) / 100), 2)        as current_amount
                              FROM (SELECT *
                                    FROM budgets_has_categories
                                    WHERE budgets_users_user_id = ${userId}
                                      AND (budgets_budget_id = ${budgetId})) b
                                     RIGHT JOIN categories ON categories.category_id = b.categories_category_id
                              WHERE users_user_id = ${userId}
                                AND status = ${MYFIN.CATEGORY_STATUS.ACTIVE}`;
  }

  static async getCountOfUserCategories(userId: bigint, dbClient = prisma) {
    return dbClient.categories.count({
      where: { users_user_id: userId },
    });
  }
}

export default CategoryService;
