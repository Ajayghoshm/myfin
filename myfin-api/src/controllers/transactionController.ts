import type { NextFunction, Request, Response } from 'express';
import joi from 'joi';
import { MYFIN } from '../consts.js';
import APIError from '../errorHandling/apiError.js';
import { dayStartIST } from '../services/insights/insightsPrimitives.js';
import AccountService from '../services/accountService.js';
import CategoryService from '../services/categoryService.js';
import EntityService from '../services/entityService.js';
import TransactionService from '../services/transactionService.js';
import { salaryRuleFor } from '../services/insights/analyticsRules.js';
import Logger from '../utils/Logger.js';
import ConvertUtils from '../utils/convertUtils.js';
import PhonePeImportService from '../services/phonePeImportService.js';
import ShareInbox from '../share/shareInbox.js';
import CommonsController from './commonsController.js';

// READ
const getAllTrxForUserSchema = joi
  .object({
    trx_limit: joi.number().default(300).min(1).max(300),
  })
  .unknown(true);

const getTransactionsForUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const trx = await getAllTrxForUserSchema.validateAsync(req.query);

    const trxList = await TransactionService.getTransactionsForUser(
      sessionData.userId,
      trx.trx_limit
    );
    res.send(trxList);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

/** Structured filter fields shared by the list and bulk-update `filter` (snake_case over HTTP). */
const structuredFilterKeys = {
  date_from: joi.number().integer().empty(''),
  date_to: joi.number().integer().empty(''),
  category_id: joi
    .alternatives()
    .try(joi.number().integer().positive(), joi.string().valid('none'))
    .empty(''),
  payee_key: joi.string().max(255).empty(''),
  account_id: joi.number().integer().positive().empty(''),
  effective_month: joi
    .string()
    .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
    .empty(''),
  day: joi
    .string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .custom((v, helpers) => (dayStartIST(v) == null ? helpers.error('any.invalid') : v))
    .empty(''),
  cost_kind: joi.string().valid('fixed', 'flexible', 'unsorted').empty(''),
  yearly_cost: joi.string().valid('linked', 'unlinked').empty(''),
  amount_lt: joi.number().integer().positive().empty(''),
  adjustment: joi.string().valid('write_off').empty(''),
};

type StructuredFilterInput = {
  date_from?: number;
  date_to?: number;
  category_id?: number | 'none';
  payee_key?: string;
  account_id?: number;
  effective_month?: string;
  day?: string;
  cost_kind?: 'fixed' | 'flexible' | 'unsorted';
  yearly_cost?: 'linked' | 'unlinked';
  amount_lt?: number;
  adjustment?: 'write_off';
  type?: string;
};

const toTransactionFilter = (input: StructuredFilterInput) => ({
  dateFrom: input.date_from,
  dateTo: input.date_to,
  categoryId:
    input.category_id === undefined
      ? undefined
      : input.category_id === 'none'
        ? ('none' as const)
        : BigInt(input.category_id),
  payeeKey: input.payee_key,
  accountId: input.account_id === undefined ? undefined : BigInt(input.account_id),
  // An income/expense drill-down (an effective month, a day, or a full calendar date range as used
  // by #17 "saved") mirrors Insights, which never counts balance adjustments or debt principal rows
  // (lent/borrowed/repaid); a plain month view, or the write-offs list, still lists them.
  excludeAdjustments:
    (input.effective_month !== undefined ||
      input.day !== undefined ||
      (input.date_from !== undefined && input.date_to !== undefined)) &&
    input.adjustment === undefined &&
    (input.type === MYFIN.TRX_TYPES.EXPENSE || input.type === MYFIN.TRX_TYPES.INCOME)
      ? true
      : undefined,
  adjustment: input.adjustment,
  day: input.day,
  costKind: input.cost_kind,
  yearlyCost: input.yearly_cost,
  amountLt: input.amount_lt,
  effectiveMonth:
    input.effective_month === undefined
      ? undefined
      : {
          year: Number(input.effective_month.slice(0, 4)),
          month: Number(input.effective_month.slice(5, 7)),
        },
});

const getFilteredTrxByPageSchema = joi
  .object({
    page_size: joi.number().default(MYFIN.DEFAULT_TRANSACTIONS_FETCH_LIMIT).min(1).max(300),
    query: joi.string().empty('').default(''),
    sort_by: joi.string().valid('date', 'amount', 'type').empty('').default('date'),
    sort_dir: joi.string().valid('asc', 'desc').empty('').default('desc'),
    type: joi
      .string()
      .valid(MYFIN.TRX_TYPES.EXPENSE, MYFIN.TRX_TYPES.INCOME, MYFIN.TRX_TYPES.TRANSFER)
      .empty(''),
    ...structuredFilterKeys,
  })
  .unknown(true);

const getFilteredTrxByPage = async (req, res, next) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const trx = await getFilteredTrxByPageSchema.validateAsync(req.query);
    const trxList = await TransactionService.getFilteredTransactionsByForUser(
      sessionData.userId,
      req.params.page,
      trx.page_size,
      trx.query,
      {
        sortBy: trx.sort_by,
        sortDir: trx.sort_dir,
        type: trx.type,
        ...toTransactionFilter(trx),
        salaryRule: await salaryRuleFor(sessionData.userId),
      }
    );
    res.send(trxList);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

// CREATE
const createTransactionStep0 = async (req, res, next) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const data = await TransactionService.createTransactionStep0(sessionData.userId);
    res.json(data);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const createTransactionSchema = joi.object({
  amount: joi.number().required(),
  type: joi.string().trim().required(),
  description: joi.string().trim().allow('').default(''),
  entity_id: joi.number().empty(''),
  account_from_id: joi.number().empty(''),
  account_to_id: joi.number().empty(''),
  category_id: joi.number().empty(''),
  date_timestamp: joi.number().required(),
  is_essential: joi.boolean().required(),
  tags: joi.any().default('[]').optional(), // ex: ["tag 1","tag 2",<_new_or_existing_tag_name>]
});

const createTransaction = async (req, res, next) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const trx = await createTransactionSchema.validateAsync(req.body);
    const created = await TransactionService.createTransaction(sessionData.userId, {
      ...trx,
      tags: JSON.parse(trx.tags),
    });
    res.json({ message: 'Transaction successfully created', transaction_id: created.transaction_id });
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

// UPDATE
const updateTransactionSchema = joi.object({
  new_amount: joi.number().required(),
  new_type: joi.string().trim().required(),
  new_description: joi.string().trim().allow('').default(''),
  new_entity_id: joi.number().empty(''),
  new_account_from_id: joi.number().empty(''),
  new_account_to_id: joi.number().empty(''),
  new_category_id: joi.number().empty(''),
  new_date_timestamp: joi.number().required(),
  new_is_essential: joi.boolean().required(),
  transaction_id: joi.number().required(),
  tags: joi.any().default('[]').optional(), // ex: ["tag 1","tag 2",<_new_or_existing_tag_name>]
  /* SPLIT TRX */
  is_split: joi.boolean().default(false),
  split_amount: joi.number().empty('').optional(),
  split_category: joi.number().empty('').optional(),
  split_entity: joi.number().empty('').optional(),
  split_type: joi.string().trim().empty('').optional(),
  split_account_from: joi.number().empty('').optional(),
  split_account_to: joi.number().empty('').optional(),
  split_description: joi.string().empty('').trim().optional(),
  split_is_essential: joi.boolean().empty('').default(false).optional(),
  split_tags: joi.any().default('[]').optional(), // ex: ["tag 1","tag 2",<_new_or_existing_tag_name>]
});

const updateTransaction = async (req, res, next) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const trx = await updateTransactionSchema.validateAsync(req.body);
    await TransactionService.updateTransaction(sessionData.userId, {
      ...trx,
      tags: JSON.parse(trx.tags),
      split_tags: JSON.parse(trx.split_tags),
    });
    res.json(`Transaction successfully updated`);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

// DELETE
const deleteTransactionSchema = joi.object({
  transaction_id: joi.number().required(),
});

const deleteTransaction = async (req, res, next) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const trx = await deleteTransactionSchema.validateAsync(req.body);
    await TransactionService.deleteTransaction(sessionData.userId, trx.transaction_id);
    res.json(`Transaction successfully deleted`);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const transactionsForUserInCategoryAndInMonthSchema = joi
  .object({
    month: joi.number().required(),
    year: joi.number().required(),
    cat_id: joi.number().required(),
    type: joi
      .string()
      .allow(MYFIN.TRX_TYPES.EXPENSE, MYFIN.TRX_TYPES.INCOME, MYFIN.TRX_TYPES.TRANSFER),
  })
  .unknown(true);
const getAllTransactionsForUserInCategoryAndInMonth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await transactionsForUserInCategoryAndInMonthSchema.validateAsync(req.query);
    const data = await TransactionService.getAllTransactionsForUserInCategoryAndInMonth(
      sessionData.userId,
      input.month,
      input.year,
      input.cat_id,
      input.type
    );
    res.json(data);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const autoCategorizeTransactionSchema = joi.object({
  description: joi.string().required(),
  amount: joi.number().required(),
  type: joi
    .string()
    .allow(MYFIN.TRX_TYPES.EXPENSE, MYFIN.TRX_TYPES.INCOME, MYFIN.TRX_TYPES.TRANSFER),
  account_from_id: joi.number().required(),
  account_to_id: joi.number().required(),
});
const autoCategorizeTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await autoCategorizeTransactionSchema.validateAsync(req.body);
    const data = await TransactionService.autoCategorizeTransaction(
      sessionData.userId,
      input.description,
      input.amount,
      input.type,
      input.account_from_id,
      input.account_to_id
    );
    res.json(data);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const importTransactionsStep0 = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const data = await AccountService.getAllAccountsForUserWithAmounts(sessionData.userId, true);
    res.json(data);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const importTrxStep1Schema = joi.object({
  account_id: joi.number().required(),
  trx_list: joi.any(),
});

const importTransactionsStep1 = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await importTrxStep1Schema.validateAsync(req.body);

    if (!(await AccountService.doesAccountBelongToUser(sessionData.userId, input.account_id))) {
      throw APIError.notAuthorized();
    }

    const [fillData, categories, entities, accounts] = await Promise.all([
      TransactionService.autoCategorizeTransactionList(
        sessionData.userId,
        input.account_id,
        JSON.parse(input.trx_list)
      ),
      CategoryService.getAllCategoriesForUser(sessionData.userId, {
        category_id: true,
        name: true,
      }),
      EntityService.getAllEntitiesForUser(sessionData.userId, { entity_id: true, name: true }),
      AccountService.getAccountsForUser(sessionData.userId, {
        account_id: true,
        name: true,
        current_balance: true,
      }),
    ]);

    res.json({
      fillData,
      categories,
      entities,
      accounts: accounts.map((acc) => ({
        account_id: acc.account_id,
        name: acc.name,
        balance: ConvertUtils.convertBigIntegerToFloat(acc.current_balance),
      })),
    });
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const importTrxStep2Schema = joi.object({
  trx_list: joi.any(),
});

const importTransactionsStep2 = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await importTrxStep2Schema.validateAsync(req.body);

    const { imported, skipped, created_ids } = await TransactionService.createTransactionsInBulk(
      sessionData.userId,
      JSON.parse(input.trx_list)
    );
    res.json({ imported, skipped, created_ids });
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const listShareInbox = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await CommonsController.checkAuthSessionValidity(req);
    res.json(await ShareInbox.list());
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const getShareInboxFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await CommonsController.checkAuthSessionValidity(req);
    const csv = await ShareInbox.read(String(req.params.id));
    if (csv === null) return next(APIError.notFound('Inbox file not found'));
    res.json({ csv });
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const deleteShareInboxFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await CommonsController.checkAuthSessionValidity(req);
    const removed = await ShareInbox.remove(String(req.params.id));
    if (!removed) return next(APIError.notFound('Inbox file not found'));
    res.json({ deleted: true });
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const importPhonePePreviewSchema = joi.object({
  csv: joi.string().required(),
});

const importPhonePePreview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await importPhonePePreviewSchema.validateAsync(req.body);

    const preview = await PhonePeImportService.previewPhonePeImport(sessionData.userId, input.csv);
    res.json(preview);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const importPhonePeCategorizeSchema = joi.object({
  csv: joi.string().required(),
  mappings: joi.string().required(),
});

const phonePeMappingsSchema = joi
  .array()
  .items(
    joi.object({
      key: joi.string().max(64).required(),
      account_id: joi.alternatives(joi.number().integer(), joi.string().pattern(/^\d+$/)).required(),
    })
  )
  .max(100)
  .unique('key');

const importPhonePeCategorize = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await importPhonePeCategorizeSchema.validateAsync(req.body);

    let parsedMappings: unknown;
    try {
      parsedMappings = JSON.parse(input.mappings);
    } catch {
      throw APIError.badRequest('Invalid mappings');
    }
    const mappings = await phonePeMappingsSchema.validateAsync(parsedMappings);

    const result = await PhonePeImportService.categorizePhonePeImport(
      sessionData.userId,
      input.csv,
      mappings.map((m: { key: string; account_id: number | string }) => ({
        key: m.key,
        account_id: BigInt(m.account_id),
      }))
    );
    res.json(result);
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

const bulkUpdateTransactionsSchema = joi
  .object({
    transaction_ids: joi.array().items(joi.number().integer().positive()).min(1).max(5000),
    filter: joi.object({
      query: joi.string().allow('').default(''),
      type: joi
        .string()
        .valid(MYFIN.TRX_TYPES.EXPENSE, MYFIN.TRX_TYPES.INCOME, MYFIN.TRX_TYPES.TRANSFER)
        .empty(''),
      ...structuredFilterKeys,
    }),
    category_id: joi.number().integer().positive().allow(null),
    entity_id: joi.number().integer().positive().allow(null),
    is_essential: joi.boolean(),
  })
  .xor('transaction_ids', 'filter');

const bulkUpdateTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionData = await CommonsController.checkAuthSessionValidity(req);
    const input = await bulkUpdateTransactionsSchema.validateAsync(req.body);
    const toBigIntOrNull = (value?: number | null) =>
      value === undefined ? undefined : value === null ? null : BigInt(value);
    const updated = await TransactionService.bulkUpdateTransactions(
      sessionData.userId,
      input.filter
        ? {
            filter: {
              query: input.filter.query,
              type: input.filter.type,
              ...toTransactionFilter(input.filter),
              salaryRule: await salaryRuleFor(sessionData.userId),
            },
          }
        : { transaction_ids: input.transaction_ids.map((id: number) => BigInt(id)) },
      {
        category_id: toBigIntOrNull(input.category_id),
        entity_id: toBigIntOrNull(input.entity_id),
        is_essential: input.is_essential,
      }
    );
    res.json({ updated });
  } catch (err) {
    Logger.addLog(err);
    next(err || APIError.internalServerError());
  }
};

export default {
  bulkUpdateTransactions,
  getTransactionsForUser,
  getFilteredTrxByPage,
  createTransactionStep0,
  createTransaction,
  deleteTransaction,
  updateTransaction,
  getAllTransactionsForUserInCategoryAndInMonth,
  autoCategorizeTransaction,
  importTransactionsStep0,
  importTransactionsStep1,
  importTransactionsStep2,
  importPhonePePreview,
  importPhonePeCategorize,
  listShareInbox,
  getShareInboxFile,
  deleteShareInboxFile,
};

export { toTransactionFilter };
