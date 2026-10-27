import { Prisma } from '../generated/prisma/client.js';
import { performDatabaseRequest, prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import APIError from '../errorHandling/apiError.js';
import DateTimeUtils from '../utils/DateTimeUtils.js';
import Logger from '../utils/Logger.js';
import ConvertUtils from '../utils/convertUtils.js';
import AccountService from './accountService.js';
import CategoryService from './categoryService.js';
import EntityService from './entityService.js';
import RuleService from './ruleService.js';
import TagService, { Tag } from './tagService.js';
import { getExistingExternalIds } from './phonePeImportService.js';
import UserService from './userService.js';
import {
  NO_SALARY_RULE,
  type SalaryRule,
  effectiveMonthOf,
  effectiveMonthSql,
  formatYearMonth,
} from './insights/analyticsRules.js';
import { type YearMonth, payeeKeySql } from './insights/insightsPrimitives.js';

const getTransactionsForUser = async (
  userId: bigint,
  trxLimit: number
) => prisma.$queryRaw`SELECT transaction_id,
                             transactions.date_timestamp,
                             (transactions.amount / 100) as amount,
                             transactions.type,
                             transactions.is_essential,
                             transactions.description,
                             entities.entity_id,
                             entities.name               as entity_name,
                             categories_category_id,
                             categories.name             as category_name,
                             accounts_account_from_id,
                             acc_to.name                 as account_to_name,
                             accounts_account_to_id,
                             acc_from.name               as account_from_name
                      FROM transactions
                             LEFT JOIN accounts ON accounts.account_id = transactions.accounts_account_from_id
                             LEFT JOIN categories
                                       ON categories.category_id = transactions.categories_category_id
                             LEFT JOIN entities ON entities.entity_id = transactions.entities_entity_id
                             LEFT JOIN accounts acc_to
                                       ON acc_to.account_id = transactions.accounts_account_to_id
                             LEFT JOIN accounts acc_from
                                       ON acc_from.account_id = transactions.accounts_account_from_id
                      WHERE acc_to.users_user_id = ${userId}
                         OR acc_from.users_user_id = ${userId}
                      GROUP BY transaction_id
                      ORDER BY transactions.date_timestamp DESC
                      LIMIT ${trxLimit}`;

const doesTransactionBelongToUser = async (
  userId: bigint,
  transactionId: bigint,
  dbClient = prisma
) => {
  // Get the transaction
  const trx = await dbClient.transactions.findFirst({
    where: {
      transaction_id: transactionId,
    },
  });
  if (!trx) return false;
  const result = await dbClient.accounts.findFirst({
    where: {
      OR: [
        { account_id: trx.accounts_account_from_id || -1 },
        { account_id: trx.accounts_account_to_id || -1 },
      ],
    },
  });

  return result !== null;
};

const getAllTagsForTransaction = async (
  userId: bigint,
  transactionId: bigint,
  dbClient = undefined
) =>
  performDatabaseRequest(async (prismaTx) => {
    // Make sure transaction belongs to user
    const transactionBelongsToUser = await doesTransactionBelongToUser(
      userId,
      transactionId,
      prismaTx
    );
    if (!transactionBelongsToUser) {
      throw APIError.notAuthorized();
    }

    const tags = await prismaTx.transaction_has_tags.findMany({
      where: {
        transactions_transaction_id: transactionId,
      },
      select: {
        tags: true,
      },
    });

    let tagsData = [];
    if (Array.isArray(tags)) {
      tagsData = tags.map((tag) => tag.tags);
    }

    return tagsData;
  }, dbClient);

export type CostKind = 'fixed' | 'flexible' | 'unsorted';

/** Structured filters shared by the list, its count, bulk updates and the insights drill-down. */
export type TransactionFilter = {
  query?: string;
  type?: string | null;
  /** Epoch seconds, inclusive. */
  dateFrom?: number;
  /** Epoch seconds, exclusive. */
  dateTo?: number;
  /** A category id, or 'none' for uncategorised transactions. */
  categoryId?: bigint | 'none';
  payeeKey?: string;
  /** Matches either side of a transaction. */
  accountId?: bigint;
  /** Rows whose effective month is this month (see `effectiveMonthSql`); needs `salaryRule` to shift late salaries. */
  effectiveMonth?: YearMonth;
  /** Already-resolved rule; callers resolve it with `salaryRuleFor`. Without it nothing shifts. */
  salaryRule?: SalaryRule;
  /** Leave out balance adjustments (`is_adjustment`). */
  excludeAdjustments?: boolean;
  /** Expense split by the category's `is_fixed` flag; 'unsorted' = expenses without a category. */
  costKind?: CostKind;
  /** Only rows linked / not linked to a yearly cost. */
  yearlyCost?: 'linked' | 'unlinked';
  /** Cents: only rows with an amount strictly below this. */
  amountLt?: number;
};

export type TransactionListOptions = Omit<TransactionFilter, 'query'> & {
  sortBy?: 'date' | 'amount' | 'type';
  sortDir?: 'asc' | 'desc';
};

/**
 * "AND …" predicates for the structured filter fields (everything except search and ownership).
 * References only `transactions.*` columns and `payeeKeySql`, so it can be appended to tag-free
 * aggregation queries. Emits an empty fragment when no field is set.
 */
export function structuredFilterSql(filter: TransactionFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (filter.type != null) parts.push(Prisma.sql`transactions.type = ${filter.type}`);
  if (filter.dateFrom != null) parts.push(Prisma.sql`transactions.date_timestamp >= ${filter.dateFrom}`);
  if (filter.dateTo != null) parts.push(Prisma.sql`transactions.date_timestamp < ${filter.dateTo}`);
  if (filter.categoryId === 'none') {
    parts.push(Prisma.sql`transactions.categories_category_id IS NULL`);
  } else if (filter.categoryId != null) {
    parts.push(Prisma.sql`transactions.categories_category_id = ${filter.categoryId}`);
  }
  if (filter.payeeKey != null) parts.push(Prisma.sql`${payeeKeySql} = ${filter.payeeKey}`);
  if (filter.accountId != null) {
    parts.push(
      Prisma.sql`(transactions.accounts_account_from_id = ${filter.accountId} OR transactions.accounts_account_to_id = ${filter.accountId})`
    );
  }
  if (filter.effectiveMonth != null) {
    parts.push(effectiveMonthSql(filter.effectiveMonth, filter.salaryRule ?? NO_SALARY_RULE));
  }
  if (filter.excludeAdjustments) parts.push(Prisma.sql`transactions.is_adjustment = false`);
  if (filter.costKind === 'unsorted') {
    parts.push(
      Prisma.sql`transactions.type = 'E' AND transactions.categories_category_id IS NULL`
    );
  } else if (filter.costKind != null) {
    const fixed = filter.costKind === 'fixed' ? 1 : 0;
    parts.push(
      Prisma.sql`transactions.type = 'E' AND transactions.categories_category_id IN (SELECT category_id FROM categories WHERE is_fixed = ${fixed})`
    );
  }
  if (filter.yearlyCost === 'linked') parts.push(Prisma.sql`transactions.yearly_cost_id IS NOT NULL`);
  else if (filter.yearlyCost === 'unlinked') parts.push(Prisma.sql`transactions.yearly_cost_id IS NULL`);
  if (filter.amountLt != null) parts.push(Prisma.sql`transactions.amount < ${filter.amountLt}`);
  if (parts.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(parts, ' AND ')}`;
}

/**
 * FROM/JOIN/WHERE shared by the transactions list, its filtered count and bulk updates by filter,
 * so "select all matching" always matches exactly what the list shows.
 */
const filteredTransactionsFrom = (userId: bigint, filter: TransactionFilter) => {
  const query = `%${filter.query ?? ''}%`;
  return Prisma.sql`FROM transactions
                      LEFT JOIN accounts ON accounts.account_id = transactions.accounts_account_from_id
                      LEFT JOIN categories
                                ON categories.category_id = transactions.categories_category_id
                      LEFT JOIN entities ON entities.entity_id = transactions.entities_entity_id
                      LEFT JOIN accounts acc_to
                                ON acc_to.account_id = transactions.accounts_account_to_id
                      LEFT JOIN accounts acc_from
                                ON acc_from.account_id = transactions.accounts_account_from_id
                      LEFT JOIN transaction_has_tags ON transaction_has_tags.transactions_transaction_id = transactions.transaction_id
                      LEFT JOIN tags ON tags.tag_id = transaction_has_tags.tags_tag_id
                    WHERE (acc_to.users_user_id = ${userId} OR acc_from.users_user_id = ${userId})
                      AND (transactions.description LIKE ${query}
                        OR acc_from.name LIKE ${query}
                        OR acc_to.name LIKE ${query}
                        OR (amount / 100) LIKE ${query}
                        OR entities.name LIKE ${query}
                        OR categories.name LIKE ${query}
                        OR tags.name LIKE ${query})
                      ${structuredFilterSql(filter)}`;
};

const getFilteredTransactionsByForUser = async (
  userId: bigint,
  page: number,
  pageSize: number,
  searchQuery: string,
  options: TransactionListOptions = {}
) => {
  const offsetValue = page * pageSize;
  const filter: TransactionFilter = {
    query: searchQuery,
    type: options.type,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    categoryId: options.categoryId,
    payeeKey: options.payeeKey,
    accountId: options.accountId,
    effectiveMonth: options.effectiveMonth,
    salaryRule: options.salaryRule,
    excludeAdjustments: options.excludeAdjustments,
    costKind: options.costKind,
    yearlyCost: options.yearlyCost,
    amountLt: options.amountLt,
  };
  // ORDER BY can't be parameterised, so only whitelisted fragments are interpolated
  const sortDir = Prisma.raw(options.sortDir === 'asc' ? 'ASC' : 'DESC');
  const newestFirst = Prisma.sql`transactions.date_timestamp DESC, transactions.transaction_id DESC`;
  let orderBy: Prisma.Sql;
  switch (options.sortBy) {
    case 'amount':
      orderBy = Prisma.sql`transactions.amount ${sortDir}, ${newestFirst}`;
      break;
    case 'type':
      orderBy = Prisma.sql`transactions.type ${sortDir}, ${newestFirst}`;
      break;
    default:
      orderBy = newestFirst;
  }

  // main query for list of results (limited by pageSize and offsetValue)
  const mainQuery = prisma.$queryRaw`SELECT transaction_id,
                                            transactions.is_essential,
                                            transactions.is_adjustment,
                                            transactions.yearly_cost_id,
                                            transactions.date_timestamp,
                                            (transactions.amount / 100) as amount,
                                            transactions.type,
                                            transactions.description,
                                            entities.entity_id,
                                            entities.name               as entity_name,
                                            categories_category_id,
                                            categories.name             as category_name,
                                            categories.icon_key         as category_icon_key,
                                            accounts_account_from_id,
                                            acc_to.name                 as account_to_name,
                                            accounts_account_to_id,
                                            acc_from.name               as account_from_name,
                                            GROUP_CONCAT(tags.name) as tag_names
                                     ${filteredTransactionsFrom(userId, filter)}
                                     GROUP BY transaction_id
                                     ORDER BY ${orderBy}
                                     LIMIT ${pageSize} OFFSET ${offsetValue}`;

  // count of total of filtered results
  const countQuery = prisma.$queryRaw`SELECT count(*) as 'count'
                                      FROM (SELECT transactions.date_timestamp, GROUP_CONCAT(tags.name) as tag_names
                                            ${filteredTransactionsFrom(userId, filter)}
                                            GROUP BY transaction_id) trx`;

  const totalCountQuery = prisma.$queryRaw`SELECT count(*) as 'count'
                                           FROM (SELECT transactions.date_timestamp
                                                 from transactions
                                                        LEFT JOIN accounts ON accounts.account_id = transactions.accounts_account_from_id
                                                        LEFT JOIN categories
                                                                  ON categories.category_id = transactions.categories_category_id
                                                        LEFT JOIN entities ON entities.entity_id = transactions.entities_entity_id
                                                        LEFT JOIN accounts acc_to
                                                                  ON acc_to.account_id = transactions.accounts_account_to_id
                                                        LEFT JOIN accounts acc_from
                                                                  ON acc_from.account_id = transactions.accounts_account_from_id
                                                 WHERE (acc_to.users_user_id = ${userId} OR acc_from.users_user_id = ${userId})
                                                 GROUP BY transaction_id) trx`;

  const [mainQueryResult, countQueryResult, totalCountQueryResult] = await prisma.$transaction([
    mainQuery,
    countQuery,
    totalCountQuery,
  ]);

  // Attach associated tags to transaction
  const promises = [];

  if (Array.isArray(mainQueryResult)) {
    for (const trx of mainQueryResult) {
      trx.tags = await getAllTagsForTransaction(userId, trx.transaction_id);
      trx.effective_month = formatYearMonth(
        effectiveMonthOf(
          {
            type: trx.type,
            categoryId: trx.categories_category_id == null ? null : String(trx.categories_category_id),
            date: Number(trx.date_timestamp),
          },
          options.salaryRule ?? NO_SALARY_RULE
        )
      );
    }
  }

  await Promise.all(promises);

  return {
    results: mainQueryResult,
    filtered_count: countQueryResult[0].count,
    total_count: totalCountQueryResult[0].count,
  };
};
const createTransactionStep0 = async (userId: bigint, dbClient = undefined) => {
  const [entities, categories, accounts, tags] = await performDatabaseRequest(async (_) => {
    const ents = await EntityService.getAllEntitiesForUser(userId);
    const cats = await CategoryService.getAllCategoriesForUser(userId);
    const accs = await AccountService.getActiveAccountsForUser(userId);
    const tags = await TagService.getAllTagsForUser(userId);

    return [ents, cats, accs, tags];
  }, dbClient);

  return {
    entities: entities,
    categories: categories,
    accounts: accounts,
    tags: tags,
  };
};

export type CreateTransactionType = {
  amount: number;
  type: string;
  description: string;
  entity_id?: bigint;
  account_from_id?: bigint;
  account_to_id?: bigint;
  category_id?: bigint;
  date_timestamp: number;
  is_essential: boolean;
  tags?: Array<string>;
  external_id?: string;
  /** Set only by the balance-check write-off; never exposed on the HTTP endpoints. */
  is_adjustment?: boolean;
};
/** Accounts whose balance a transaction moves: `to` for income, `from` for expense, both for a transfer. */
const accountsAffectedBy = (trx: { type: string; account_from_id?: bigint; account_to_id?: bigint }) => {
  switch (trx.type) {
    case MYFIN.TRX_TYPES.INCOME:
      return [trx.account_to_id];
    case MYFIN.TRX_TYPES.EXPENSE:
      return [trx.account_from_id];
    case MYFIN.TRX_TYPES.TRANSFER:
    default:
      return [trx.account_to_id, trx.account_from_id];
  }
};

/** Recalculates an account's balance snapshots from `fromTimestamp` until now and stores the new balance. */
const updateAccountBalanceFrom = async (
  userId: bigint,
  accountId: bigint,
  fromTimestamp: number,
  prismaTx
) => {
  const newBalance = await AccountService.recalculateBalanceForAccountIncrementally(
    accountId,
    fromTimestamp,
    DateTimeUtils.getCurrentUnixTimestamp() + 1,
    prismaTx
  );
  await AccountService.setNewAccountBalance(userId, accountId, newBalance, prismaTx);
};

const createTransaction = async (
  userId: bigint,
  trx: CreateTransactionType,
  dbClient = undefined,
  // Bulk imports insert every row first and then recalculate each account once (see createTransactionsInBulk).
  options: { skipBalanceUpdate?: boolean } = {}
) => {
  //Logger.addStringifiedLog(trx);
  trx.amount = ConvertUtils.convertFloatToBigInteger(trx.amount);
  return performDatabaseRequest(async (prismaTx) => {
    // Add transaction
    const addedTrx = await prismaTx.transactions.create({
      data: {
        date_timestamp: trx.date_timestamp,
        amount: trx.amount,
        type: trx.type,
        description: trx.description,
        entities_entity_id: trx.entity_id,
        accounts_account_from_id: trx.account_from_id,
        accounts_account_to_id: trx.account_to_id,
        categories_category_id: trx.category_id,
        is_essential: trx.is_essential,
        external_id: trx.external_id || undefined,
        is_adjustment: trx.is_adjustment ?? false,
      },
    });

    // Set last update timestamp
    await UserService.setupLastUpdateTimestamp(
      userId,
      DateTimeUtils.getCurrentUnixTimestamp(),
      prismaTx
    );

    // Associate tags with transaction
    await Promise.all(
      trx.tags?.map(async (tagName) => {
        const tag = await TagService.addTagToTransactionByName(
          userId,
          addedTrx.transaction_id,
          tagName,
          true,
          prismaTx
        );
        return tag;
      }) || []
    );

    if (!options.skipBalanceUpdate) {
      const fromTimestamp = trx.date_timestamp - 1;
      for (const accountId of accountsAffectedBy(trx)) {
        await updateAccountBalanceFrom(userId, accountId, fromTimestamp, prismaTx);
      }
    }

    return addedTrx;
  }, dbClient);
};

const createTransactionsInBulk = async (
  userId: bigint,
  trxList: Array<CreateTransactionType>,
  dbClient = undefined
) =>
  performDatabaseRequest(async (prismaTx) => {
    let importedCnt = 0;
    let skippedCnt = 0;
    const createdIds: bigint[] = [];

    // Rows carrying an external_id (e.g. PhonePe) are skipped if already stored for this user,
    // or if repeated earlier in this same list. Rows without one (paste import) always import.
    const externalIds = [...new Set(trxList.map((t) => t.external_id).filter((id) => !!id))];
    if (externalIds.length > 0) {
      // Serialise concurrent imports for this user: without this lock (and with no unique
      // constraint on external_id) two in-flight saves could both miss each other's rows.
      // It must be the first read in the transaction, so the dedup read below sees the
      // rows committed by a save that held the lock before us.
      await prismaTx.$queryRaw`SELECT user_id FROM users WHERE user_id = ${userId} FOR UPDATE`;
    }
    const existingIds = await getExistingExternalIds(userId, externalIds, prismaTx);
    const seenIds = new Set<string>();
    const earliestDateByAccount = new Map<string, { accountId: bigint; date: number }>();
    const ownership = new Map<string, boolean>();
    const accountBelongsToUser = async (accountId: bigint) => {
      const key = String(accountId);
      if (!ownership.has(key)) {
        ownership.set(key, await AccountService.doesAccountBelongToUser(userId, accountId, prismaTx));
      }
      return ownership.get(key);
    };

    for (const trx of trxList) {
      if (
        !trx.date_timestamp ||
        !trx.amount ||
        !trx.type ||
        (!trx.account_from_id && !trx.account_to_id)
      ) {
        continue;
      }

      if (trx.external_id) {
        if (existingIds.has(trx.external_id) || seenIds.has(trx.external_id)) {
          skippedCnt++;
          continue;
        }
        seenIds.add(trx.external_id);
      }

      // Both accounts (if defined) need to belong to the user making the request
      for (const accountId of [trx.account_from_id, trx.account_to_id]) {
        if (accountId && !(await accountBelongsToUser(accountId))) {
          throw APIError.notAuthorized();
        }
      }

      const created = await createTransaction(userId, trx, prismaTx, { skipBalanceUpdate: true });
      createdIds.push(created.transaction_id);
      for (const accountId of accountsAffectedBy(trx)) {
        if (!accountId) continue;
        const key = String(accountId);
        const earliest = earliestDateByAccount.get(key);
        if (!earliest || trx.date_timestamp < earliest.date) {
          earliestDateByAccount.set(key, { accountId, date: trx.date_timestamp });
        }
      }
      importedCnt++;
    }

    // Recalculating balances once per account (from its earliest new row) instead of once per row
    // keeps large imports linear; the end state is the same as per-row recalculation.
    for (const { accountId, date } of earliestDateByAccount.values()) {
      await updateAccountBalanceFrom(userId, accountId, date - 1, prismaTx);
    }

    return { imported: importedCnt, skipped: skippedCnt, created_ids: createdIds };
  }, dbClient, { timeout: 60_000, maxWait: 10_000 });

const deleteTransaction = async (userId: bigint, transactionId: number, dbClient = undefined) => {
  await performDatabaseRequest(async (prismaTx) => {
    const trx = await prismaTx.transactions
      .findUniqueOrThrow({
        where: {
          transaction_id: transactionId,
        },
      })
      .catch((err) => {
        throw APIError.notFound(`Transaction could not be found.`);
      });

    const oldTimestamp = trx.date_timestamp;
    const oldType = trx.type;
    const oldAccountTo = trx.accounts_account_to_id;
    const oldAccountFrom = trx.accounts_account_from_id;
    Logger.addStringifiedLog(trx);
    // Make sure account belongs to user
    const accountsCount = await prismaTx.accounts.count({
      where: {
        // @ts-expect-error expected
        account_id: { in: [oldAccountTo || -1, oldAccountFrom || -1] },
        users_user_id: userId,
      },
    });
    if (accountsCount === 0) {
      throw APIError.notFound(`Account could not be found.`);
    }

    // Delete trx references from transaction_has_tags
    await prismaTx.transaction_has_tags.deleteMany({
      where: {
        transactions_transaction_id: transactionId,
      },
    });

    // Delete transaction
    await prismaTx.transactions.delete({
      where: {
        transaction_id: transactionId,
      },
    });

    await UserService.setupLastUpdateTimestamp(
      userId,
      DateTimeUtils.getCurrentUnixTimestamp(),
      prismaTx
    );

    // Rollback the effect of oldAmount
    let newBalance;
    switch (oldType) {
      case MYFIN.TRX_TYPES.INCOME:
        newBalance = await AccountService.recalculateBalanceForAccountIncrementally(
          oldAccountTo,
          oldTimestamp - 1n,
          DateTimeUtils.getCurrentUnixTimestamp() + 1,
          prismaTx
        );
        await AccountService.setNewAccountBalance(userId, oldAccountTo, newBalance, prismaTx);
        break;
      case MYFIN.TRX_TYPES.EXPENSE:
        newBalance = await AccountService.recalculateBalanceForAccountIncrementally(
          oldAccountFrom,
          oldTimestamp - 1n,
          DateTimeUtils.getCurrentUnixTimestamp() + 1,
          prismaTx
        );
        await AccountService.setNewAccountBalance(userId, oldAccountFrom, newBalance, prismaTx);
        break;
      case MYFIN.TRX_TYPES.TRANSFER:
      default:
        newBalance = await AccountService.recalculateBalanceForAccountIncrementally(
          oldAccountTo,
          oldTimestamp - 1n,
          DateTimeUtils.getCurrentUnixTimestamp() + 1,
          prismaTx
        );
        await AccountService.setNewAccountBalance(userId, oldAccountTo, newBalance, prismaTx);
        newBalance = await AccountService.recalculateBalanceForAccountIncrementally(
          oldAccountFrom,
          oldTimestamp - 1n,
          DateTimeUtils.getCurrentUnixTimestamp() + 1,
          prismaTx
        );
        await AccountService.setNewAccountBalance(userId, oldAccountFrom, newBalance, prismaTx);
        break;
    }
  }, undefined);
};

export type UpdatedTrxType = {
  new_amount: number;
  new_type: string;
  new_description: string;
  new_entity_id: bigint;
  new_account_from_id: bigint;
  new_account_to_id: bigint;
  new_category_id: bigint;
  new_date_timestamp: number;
  new_is_essential: boolean;
  transaction_id: bigint;
  tags: Array<string>;
  /* SPLIT TRX */
  is_split: boolean;
  split_amount?: number;
  split_category?: bigint;
  split_entity?: bigint;
  split_type?: string;
  split_account_from?: bigint;
  split_account_to?: bigint;
  split_description?: string;
  split_is_essential?: boolean;
  split_tags: Array<string>;
};
const updateTransaction = async (
  userId: bigint,
  updatedTrx: UpdatedTrxType,
  dbClient = undefined
) => {
  const trx = {
    ...updatedTrx,
    ...{
      new_amount: ConvertUtils.convertFloatToBigInteger(updatedTrx.new_amount),
    },
  };
  /* trx.amount = ConvertUtils.convertFloatToBigInteger(trx.amount); */
  await performDatabaseRequest(async (prismaTx) => {
    const outdatedTrx = await prismaTx.transactions.findUniqueOrThrow({
      where: { transaction_id: trx.transaction_id },
    });

    const oldType = outdatedTrx.type;
    const oldTimestamp = outdatedTrx.date_timestamp;
    const oldAccountTo = outdatedTrx.accounts_account_to_id;
    const oldAccountFrom = outdatedTrx.accounts_account_from_id;

    const affectedAccounts = new Map<bigint, number>();
    const addAffectedAccount = (
      accountId: bigint | number | null | undefined,
      timestamp: bigint | number
    ) => {
      if (!accountId) return;

      const normalizedAccountId = BigInt(accountId);
      const recalculationStart = Number(timestamp) - 1;
      const existingStart = affectedAccounts.get(normalizedAccountId);
      const earliestStart =
        existingStart === undefined
          ? recalculationStart
          : Math.min(existingStart, recalculationStart);
      affectedAccounts.set(normalizedAccountId, earliestStart);
    };

    const addAccountsForTransaction = (
      type: string,
      accountFromId: bigint | number | null | undefined,
      accountToId: bigint | number | null | undefined,
      timestamp: bigint | number
    ) => {
      if (type === MYFIN.TRX_TYPES.INCOME) {
        addAffectedAccount(accountToId, timestamp);
      } else if (type === MYFIN.TRX_TYPES.EXPENSE) {
        addAffectedAccount(accountFromId, timestamp);
      } else {
        addAffectedAccount(accountFromId, timestamp);
        addAffectedAccount(accountToId, timestamp);
      }
    };

    addAccountsForTransaction(oldType, oldAccountFrom, oldAccountTo, oldTimestamp);
    addAccountsForTransaction(
      trx.new_type,
      trx.new_account_from_id,
      trx.new_account_to_id,
      trx.new_date_timestamp
    );

    // Make sure account(s) belong to user
    if (trx.new_account_from_id) {
      await AccountService.doesAccountBelongToUser(userId, trx.new_account_from_id, prismaTx).catch(
        (err) => {
          throw APIError.notAuthorized();
        }
      );
    }

    if (trx.new_account_to_id) {
      await AccountService.doesAccountBelongToUser(userId, trx.new_account_to_id, prismaTx).catch(
        (err) => {
          throw APIError.notAuthorized();
        }
      );
    }

    if (trx.split_account_from) {
      await AccountService.doesAccountBelongToUser(userId, trx.split_account_from, prismaTx).catch(
        (err) => {
          throw APIError.notAuthorized();
        }
      );
    }
    if (trx.split_account_to) {
      await AccountService.doesAccountBelongToUser(userId, trx.split_account_to, prismaTx).catch(
        (err) => {
          throw APIError.notAuthorized();
        }
      );
    }

    Logger.addStringifiedLog(trx);

    await prismaTx.transactions.update({
      where: { transaction_id: trx.transaction_id },
      data: {
        date_timestamp: trx.new_date_timestamp,
        amount: trx.new_amount,
        type: trx.new_type,
        description: trx.new_description,
        entities_entity_id: trx.new_entity_id ?? null,
        accounts_account_from_id: trx.new_account_from_id ?? null,
        accounts_account_to_id: trx.new_account_to_id ?? null,
        categories_category_id: trx.new_category_id ?? null,
        is_essential: trx.new_is_essential,
      },
    });

    await UserService.setupLastUpdateTimestamp(
      userId,
      DateTimeUtils.getCurrentUnixTimestamp(),
      prismaTx
    );

    const recalculationEnd = DateTimeUtils.getCurrentUnixTimestamp() + 1;
    for (const [accountId, recalculationStart] of affectedAccounts) {
      const newBalance = await AccountService.recalculateBalanceForAccountIncrementally(
        accountId,
        recalculationStart,
        recalculationEnd,
        prismaTx
      );
      await AccountService.setNewAccountBalance(userId, accountId, newBalance, prismaTx);
    }
  }, dbClient);

  // Remove all tags
  await TagService.deleteAllTagsFromTransaction(userId, updatedTrx.transaction_id, dbClient);

  // Add new tags
  if (Array.isArray(updatedTrx.tags)) {
    const promises = [];
    updatedTrx.tags?.forEach((tagName) => {
      promises.push(
        TagService.addTagToTransactionByName(
          userId,
          updatedTrx.transaction_id,
          tagName,
          true,
          dbClient
        )
      );
    });

    await Promise.all(promises);
  }

  // SPLIT HANDLING
  if (trx.is_split === true) {
    await createTransaction(userId, {
      date_timestamp: trx.new_date_timestamp,
      amount: trx.split_amount,
      type: trx.split_type,
      description: trx.split_description,
      entity_id: trx.split_entity,
      category_id: trx.split_category,
      account_from_id: trx.split_account_from,
      account_to_id: trx.split_account_to,
      is_essential: trx.split_is_essential,
      tags: trx.split_tags,
    });
  }
};

const getAllTransactionsForUserInCategoryAndInMonth = async (
  userId: bigint,
  month: number,
  year: number,
  catId: bigint,
  type: string,
  dbClient = prisma
) => {
  const nextMonth = month < 12 ? month + 1 : 1;
  const nextMonthsYear = month < 12 ? year : year + 1;
  const maxDate = new Date(nextMonthsYear, nextMonth - 1, 1);
  const minDate = new Date(year, month - 1, 1);
  Logger.addLog(`min date: ${DateTimeUtils.getUnixTimestampFromDate(minDate)}`);
  Logger.addLog(`max date: ${DateTimeUtils.getUnixTimestampFromDate(maxDate)}`);
  return dbClient.$queryRaw`SELECT transaction_id,
                                   transactions.date_timestamp,
                                   transactions.is_essential,
                                   (transactions.amount / 100) as amount,
                                   transactions.type,
                                   transactions.description,
                                   entities.entity_id,
                                   entities.name               as entity_name,
                                   categories_category_id,
                                   categories.name             as category_name,
                                   accounts_account_from_id,
                                   acc_to.name                 as account_to_name,
                                   accounts_account_to_id,
                                   acc_from.name               as account_from_name
                            FROM transactions
                                   LEFT JOIN accounts ON accounts.account_id = transactions.accounts_account_from_id
                                   LEFT JOIN categories
                                             ON categories.category_id = transactions.categories_category_id
                                   LEFT JOIN entities ON entities.entity_id = transactions.entities_entity_id
                                   LEFT JOIN accounts acc_to
                                             ON acc_to.account_id = transactions.accounts_account_to_id
                                   LEFT JOIN accounts acc_from
                                             ON acc_from.account_id = transactions.accounts_account_from_id
                            WHERE (acc_to.users_user_id = ${userId}
                              OR acc_from.users_user_id = ${userId})
                              AND categories.category_id = ${catId == -1n ? ' NULL ' : ` ${catId} `}
                              AND (transactions.type = ${type}
                              OR transactions.type = 'T')
                              AND transactions.date_timestamp >= ${DateTimeUtils.getUnixTimestampFromDate(
                                minDate
                              )}
                              AND transactions.date_timestamp <= ${DateTimeUtils.getUnixTimestampFromDate(
                                maxDate
                              )}
                            GROUP BY transaction_id
                            ORDER BY transactions.date_timestamp
                                DESC`;
};

const getCountOfUserTransactions = async (userId: bigint, dbClient = prisma) => {
  const rawData = await dbClient.$queryRaw`SELECT count(DISTINCT (transaction_id)) as 'count'
                                           FROM transactions
                                                  LEFT JOIN accounts ON transactions.accounts_account_from_id =
                                                                        accounts.account_id or
                                                                        transactions.accounts_account_to_id =
                                                                        accounts.account_id
                                           WHERE accounts.users_user_id = ${userId}`;
  return rawData[0].count;
};

export interface RuleInstructions {
  matching_rule?: bigint;
  date?: number;
  description?: string;
  amount?: number;
  type?: string;
  selectedCategoryID?: bigint;
  selectedEntityID?: bigint;
  selectedAccountFromID?: bigint;
  selectedAccountToID?: bigint;
  isEssential?: boolean;
}

const autoCategorizeTransaction = async (
  userId: bigint,
  description: string,
  amount: number,
  type: string,
  accountsFromId?: bigint,
  accountsToId?: bigint,
  date?: number,
  entitiesCache?: Array<{ entity_id: bigint; name: string }>,
  categoriesCache?: Array<{ category_id: bigint; name: string }>,
  dbClient = undefined
): Promise<RuleInstructions> =>
  performDatabaseRequest(async (prismaTx) => {
    if (!dbClient) dbClient = prismaTx;
    const matchedRule = await RuleService.getRuleForTransaction(
      userId,
      description,
      amount,
      type,
      accountsFromId,
      accountsToId,
      MYFIN.RULES.MATCHING.IGNORE,
      MYFIN.RULES.MATCHING.IGNORE,
      entitiesCache,
      categoriesCache,
      dbClient
    );
    Logger.addLog('Rule found:');
    Logger.addStringifiedLog(matchedRule);

    return {
      matching_rule: matchedRule?.rule_id,
      date: date,
      description: description,
      amount: amount,
      type: type,
      selectedCategoryID: matchedRule?.assign_category_id,
      selectedEntityID: matchedRule?.assign_entity_id,
      selectedAccountFromID: matchedRule?.assign_account_from_id ?? accountsFromId, //(type == MYFIN.TRX_TYPES.INCOME) ? matchedRule?.assign_account_from_id : accountsFromId,
      selectedAccountToID: matchedRule?.assign_account_to_id ?? accountsToId, //(type == MYFIN.TRX_TYPES.INCOME) ? accountsToId :  matchedRule?.assign_account_to_id,//matchedRule?.assign_account_to_id || accountsToId,
      isEssential: matchedRule?.assign_is_essential,
    };
  }, dbClient) as Promise<RuleInstructions>;

interface TransactionPreRuleInstructions {
  date?: number;
  description?: string;
  amount?: number;
  type?: string;
  accounts_account_from_id?: bigint;
  accounts_account_to_id?: bigint;
}

const autoCategorizeTransactionList = async (
  userId: bigint,
  accountId: bigint,
  trxList: Array<TransactionPreRuleInstructions>,
  dbClient = undefined
) => {
  // Fetch entities and categories ONCE for all transactions to avoid N queries
  const entitiesCache = (await EntityService.getAllEntitiesForUser(
    userId,
    { entity_id: true, name: true },
    dbClient
  )) as Array<{ entity_id: bigint; name: string }>;

  const categoriesCache = (await CategoryService.getAllCategoriesForUser(
    userId,
    { category_id: true, name: true },
    dbClient
  )) as Array<{ category_id: bigint; name: string }>;

  const promises = [];
  for (const trx of trxList) {
    promises.push(
      autoCategorizeTransaction(
        userId,
        trx.description,
        trx.amount,
        trx.type,
        trx.type == MYFIN.TRX_TYPES.INCOME ? null : accountId,
        trx.type != MYFIN.TRX_TYPES.INCOME ? null : accountId,
        trx.date,
        entitiesCache,
        categoriesCache,
        dbClient
      )
    );
  }

  return Promise.all(promises);
};

const getYearOfFirstTransactionForUser = async (
  userId: bigint,
  dbClient = prisma
): Promise<number> => {
  const result = await dbClient.$queryRaw`SELECT YEAR(FROM_UNIXTIME(date_timestamp)) as 'year'
                                          FROM transactions
                                                 LEFT JOIN accounts account_from
                                                            ON account_from.account_id = transactions.accounts_account_from_id
                                                 LEFT JOIN accounts account_to
                                                            ON account_to.account_id = transactions.accounts_account_to_id
                                          WHERE account_from.users_user_id = ${userId}
                                             OR account_to.users_user_id = ${userId}
                                          ORDER BY date_timestamp ASC
                                          LIMIT 1`;

  return result[0].year;
};

const getDateTimestampOfFirstTransactionForUser = async (
  userId: bigint,
  dbClient = prisma
): Promise<number> => {
  const result = await dbClient.$queryRaw`SELECT date_timestamp
                                          FROM transactions
                                                 LEFT JOIN accounts account_from
                                                            ON account_from.account_id = transactions.accounts_account_from_id
                                                 LEFT JOIN accounts account_to
                                                            ON account_to.account_id = transactions.accounts_account_to_id
                                          WHERE account_from.users_user_id = ${userId}
                                             OR account_to.users_user_id = ${userId}
                                          ORDER BY date_timestamp ASC
                                          LIMIT 1`;
  return result[0]?.date_timestamp ?? 0;
};

const deleteAllTransactionsFromUser = async (userId: bigint, dbClient = prisma) => {
  return dbClient.$queryRaw`DELETE transactions FROM transactions 
LEFT JOIN accounts acc_to ON acc_to.account_id = transactions.accounts_account_to_id 
LEFT JOIN accounts acc_from ON acc_from.account_id = transactions.accounts_account_from_id
WHERE acc_to.users_user_id = ${userId} OR acc_from.users_user_id = ${userId} `;
};

export type BulkUpdateSelection =
  | { transaction_ids: bigint[]; filter?: undefined }
  | { filter: TransactionFilter; transaction_ids?: undefined };

export type BulkUpdateChanges = {
  category_id?: bigint | null;
  entity_id?: bigint | null;
  is_essential?: boolean;
};

/**
 * Sets category, entity and/or the essential flag on many transactions at once.
 * A field left undefined is unchanged; null clears it. Amounts, dates and accounts
 * are never touched, so no balance recalculation is needed.
 * @returns the number of transactions updated
 */
const bulkUpdateTransactions = async (
  userId: bigint,
  selection: BulkUpdateSelection,
  changes: BulkUpdateChanges
): Promise<number> => {
  const data: Prisma.transactionsUncheckedUpdateManyInput = {};
  if (changes.category_id !== undefined) data.categories_category_id = changes.category_id;
  if (changes.entity_id !== undefined) data.entities_entity_id = changes.entity_id;
  if (changes.is_essential !== undefined) data.is_essential = changes.is_essential;
  if (Object.keys(data).length === 0) throw APIError.badRequest('No changes were given.');

  return performDatabaseRequest(async (prismaTx) => {
    if (
      changes.category_id != null &&
      (await prismaTx.categories.count({
        where: { category_id: changes.category_id, users_user_id: userId },
      })) === 0
    ) {
      throw APIError.notAuthorized();
    }
    if (
      changes.entity_id != null &&
      (await prismaTx.entities.count({
        where: { entity_id: changes.entity_id, users_user_id: userId },
      })) === 0
    ) {
      throw APIError.notAuthorized();
    }

    let transactionIds: bigint[];
    if (selection.filter) {
      const rows: Array<{ transaction_id: bigint }> = await prismaTx.$queryRaw`SELECT DISTINCT transactions.transaction_id
        ${filteredTransactionsFrom(userId, selection.filter)}`;
      transactionIds = rows.map((row) => row.transaction_id);
    } else {
      const requestedIds = [...new Set(selection.transaction_ids.map((id) => BigInt(id)))];
      if (requestedIds.length === 0) throw APIError.badRequest('No transactions were selected.');
      const owned = await prismaTx.transactions.count({
        where: {
          transaction_id: { in: requestedIds },
          OR: [
            { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: userId } },
            { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId } },
          ],
        },
      });
      if (owned !== requestedIds.length) throw APIError.notAuthorized();
      transactionIds = requestedIds;
    }
    if (transactionIds.length === 0) return 0;

    const result = await prismaTx.transactions.updateMany({
      where: { transaction_id: { in: transactionIds } },
      data,
    });
    await UserService.setupLastUpdateTimestamp(
      userId,
      DateTimeUtils.getCurrentUnixTimestamp(),
      prismaTx
    );
    return result.count;
  });
};

export default {
  getTransactionsForUser,
  getFilteredTransactionsByForUser,
  bulkUpdateTransactions,
  createTransactionStep0,
  createTransaction,
  deleteTransaction,
  updateTransaction,
  getAllTransactionsForUserInCategoryAndInMonth,
  getCountOfUserTransactions,
  autoCategorizeTransaction,
  autoCategorizeTransactionList,
  createTransactionsInBulk,
  getYearOfFirstTransactionForUser,
  getDateTimestampOfFirstTransactionForUser,
  deleteAllTransactionsFromUser,
  doesTransactionBelongToUser,
};
