import { normalizeItems, validateCents } from '../services/budgetAllocationService.js';
import { createRequire } from 'node:module';
import { prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import { RestoreUserErrorCodes } from '../controllers/userController.js';
import APIError from '../errorHandling/apiError.js';
import type { Prisma } from '../generated/prisma/client.js';
import AccountService from '../services/accountService.js';
import CategoryService from '../services/categoryService.js';
import EntityService from '../services/entityService.js';
import RuleService from '../services/ruleService.js';
import TagService from '../services/tagService.js';
import UserService from '../services/userService.js';
import Logger from './Logger.js';
import ConvertUtils from './convertUtils.js';
import { isSameMajorVersion } from './textUtils.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

export interface BackupData {
  apiVersion: string;
  accounts?: Prisma.accountsGetPayload<object>[];
  balances_snapshot?: Prisma.balances_snapshotGetPayload<object>[];
  budgets?: Prisma.budgetsGetPayload<object>[];
  budgets_has_categories?: Prisma.budgets_has_categoriesGetPayload<object>[];
  budget_category_items?: Prisma.budget_category_itemsGetPayload<object>[];
  categories?: Prisma.categoriesGetPayload<object>[];
  entities?: Prisma.entitiesGetPayload<object>[];
  tags?: Prisma.tagsGetPayload<object>[];
  invest_asset_evo_snapshot?: Prisma.invest_asset_evo_snapshotGetPayload<object>[];
  invest_assets?: Prisma.invest_assetsGetPayload<object>[];
  invest_desired_allocations?: Prisma.invest_desired_allocationsGetPayload<object>[];
  invest_transactions?: Prisma.invest_transactionsGetPayload<object>[];
  rules?: Prisma.rulesGetPayload<object>[];
  goals?: Prisma.goalsGetPayload<object>[];
  goal_has_accounts?: Prisma.goal_has_accountGetPayload<object>[];
  transactions?: Prisma.transactionsGetPayload<object>[];
  /** Balance checks. Absent in backups made before balance check. */
  balance_checks?: Prisma.balance_checksGetPayload<object>[];
  /** Person/merchant corrections. Absent in backups made before insights. */
  payee_classifications?: { payee_key: string; kind: string }[];
  /** Yearly (sinking fund) costs and dismissed suggestions. Absent in older backups. */
  yearly_costs?: {
    yearly_cost_id: bigint;
    name: string;
    amount: bigint | number;
    due_month: number;
    category_id: bigint | null;
    active: boolean;
    created_at: bigint | number;
  }[];
  yearly_cost_dismissals?: { payee_key: string }[];
  /** Planned (future) transactions. Absent in older backups. */
  planned_transactions?: {
    planned_id: bigint;
    date_timestamp: bigint | number;
    amount: bigint | number;
    type: string;
    accounts_account_from_id: bigint | null;
    accounts_account_to_id: bigint | null;
    categories_category_id: bigint | null;
    description: string;
    salary_plan_id: bigint | null;
    bucket: string | null;
    created_at: bigint | number;
  }[];
  /** Salary-day plans. Absent in older backups. */
  salary_plans?: {
    salary_plan_id: bigint;
    month: number;
    salary_transaction_id: bigint | null;
    salary_amount: bigint | number;
    buckets: unknown;
    created_at: bigint | number;
  }[];
  /** Debts (lent, borrowed, loans). Absent in older backups. */
  debts?: {
    debt_id: bigint;
    kind: string;
    counterparty_name: string;
    counterparty_key: string | null;
    principal: bigint | number;
    rate: unknown;
    tenure_months: number | null;
    emi: bigint | number | null;
    emi_day: number | null;
    account_id: bigint | null;
    loan_account_id: bigint | null;
    start_date: bigint | number;
    due_date: bigint | number | null;
    note: string | null;
    status: string;
    created_at: bigint | number;
  }[];
  /** Debt repayments / EMIs. Absent in older backups. */
  debt_payments?: {
    payment_id: bigint;
    debts_debt_id: bigint;
    date: bigint | number;
    amount: bigint | number;
    principal_part: bigint | number;
    interest_part: bigint | number;
    transaction_id: bigint | null;
    principal_transaction_id: bigint | null;
    installment_no: number | null;
    manual: boolean;
  }[];
  /** Financial profile settings. Absent (or null) in older backups / when never set. */
  financial_profile?: {
    salary_category_id: bigint | null;
    salary_cutoff_day: number;
    updated_at: bigint;
    savings_target_mode?: string;
    savings_target_value?: bigint | number;
    savings_target_account_id?: bigint | null;
    sinking_fund_account_id?: bigint | null;
    emergency_fund_target_months?: number;
    emergency_topup_percent?: number;
    small_spend_cutoff?: bigint | number;
  } | null;
}

class BackupManager {
  static async createBackup(userId: bigint, dbClient = prisma): Promise<BackupData> {
    const [
      accounts,
      balancesSnapshot,
      budgets,
      budgetsHasCategories,
      categories,
      entities,
      tags,
      investAssetEvoSnapshot,
      investAssets,
      investDesiredAllocations,
      investTransactions,
      rules,
      goals,
      goalHasAccounts,
      transactions,
    ] = await Promise.all([
      // Accounts
      dbClient.accounts.findMany({
        where: { users_user_id: userId },
      }),

      // Balances snapshots
      dbClient.balances_snapshot.findMany({
        where: {
          accounts: { users_user_id: userId },
        },
      }),

      // Budgets
      dbClient.budgets.findMany({
        where: { users_user_id: userId },
      }),

      // Budget has categories
      dbClient.budgets_has_categories.findMany({
        where: { budgets_users_user_id: userId },
      }),

      // Categories
      dbClient.categories.findMany({
        where: { users_user_id: userId },
      }),

      // Entities
      dbClient.entities.findMany({
        where: { users_user_id: userId },
      }),

      // Tags
      dbClient.tags.findMany({
        where: { users_user_id: userId },
      }),

      // Investment snapshots
      dbClient.invest_asset_evo_snapshot.findMany({
        where: {
          invest_assets: { users_user_id: userId },
        },
      }),

      // Invest assets
      dbClient.invest_assets.findMany({
        where: { users_user_id: userId },
      }),

      // Desired allocations
      dbClient.invest_desired_allocations.findMany({
        where: { users_user_id: userId },
      }),

      // Investment transactions
      dbClient.invest_transactions.findMany({
        where: {
          invest_assets: { users_user_id: userId },
        },
      }),

      // Rules
      dbClient.rules.findMany({
        where: { users_user_id: userId },
      }),

      // Goals
      dbClient.goals.findMany({
        where: { users_user_id: userId },
      }),

      dbClient.goal_has_account.findMany({
        where: { goals: { users_user_id: userId } },
      }),

      // Transactions
      dbClient.transactions.findMany({
        where: {
          OR: [
            { accounts_transactions_accounts_account_from_idToaccounts: { users_user_id: userId } },
            { accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: userId } },
          ],
        },
      }),
    ]);

    return {
      apiVersion: version,
      accounts,
      balances_snapshot: balancesSnapshot,
      budgets,
      budgets_has_categories: budgetsHasCategories,
      budget_category_items: await dbClient.budget_category_items.findMany({
        where: { budgets_users_user_id: userId },
        orderBy: [{ sort_order: 'asc' }, { item_id: 'asc' }],
      }),
      categories,
      entities,
      tags,
      invest_asset_evo_snapshot: investAssetEvoSnapshot,
      invest_assets: investAssets,
      invest_desired_allocations: investDesiredAllocations,
      invest_transactions: investTransactions,
      rules,
      goals,
      goal_has_accounts: goalHasAccounts,
      transactions,
      balance_checks: await dbClient.balance_checks.findMany({
        where: { accounts: { users_user_id: userId } },
        orderBy: { check_id: 'asc' },
      }),
      payee_classifications: await dbClient.payee_classifications.findMany({
        where: { users_user_id: userId },
        select: { payee_key: true, kind: true },
        orderBy: { payee_key: 'asc' },
      }),
      yearly_costs: await dbClient.yearly_costs.findMany({
        where: { users_user_id: userId },
        orderBy: { yearly_cost_id: 'asc' },
      }),
      yearly_cost_dismissals: await dbClient.yearly_cost_dismissals.findMany({
        where: { users_user_id: userId },
        select: { payee_key: true },
        orderBy: { payee_key: 'asc' },
      }),
      planned_transactions: await dbClient.planned_transactions.findMany({
        where: { users_user_id: userId },
        orderBy: { planned_id: 'asc' },
      }),
      salary_plans: await dbClient.salary_plans.findMany({
        where: { users_user_id: userId },
        orderBy: { salary_plan_id: 'asc' },
      }),
      debts: await dbClient.debts.findMany({
        where: { users_user_id: userId },
        orderBy: { debt_id: 'asc' },
      }),
      debt_payments: await dbClient.debt_payments.findMany({
        where: { debts: { users_user_id: userId } },
        orderBy: { payment_id: 'asc' },
      }),
      financial_profile: await dbClient.user_financial_profile
        .findUnique({
          where: { users_user_id: userId },
          select: {
            salary_category_id: true,
            salary_cutoff_day: true,
            updated_at: true,
            savings_target_mode: true,
            savings_target_value: true,
            savings_target_account_id: true,
            sinking_fund_account_id: true,
            emergency_fund_target_months: true,
            emergency_topup_percent: true,
            small_spend_cutoff: true,
          },
        })
        .then((row) => row ?? null),
    };
  }

  static async restoreBackup(userId: bigint, data: BackupData, dbClient = prisma) {
    if (!isSameMajorVersion(data.apiVersion, version)) {
      throw APIError.notAcceptable(
        'This backups is not compatible with your API version.',
        RestoreUserErrorCodes.IncompatibleVersions
      );
    }

    // We need to map the previous ids to the newly generated ones to maintain the already existing associations between entities
    const accountIdMap: Map<bigint, bigint> = new Map(); // <old id, new id>
    const categoryIdMap: Map<bigint, bigint> = new Map(); // <old id, new id>
    const entityIdMap: Map<bigint, bigint> = new Map(); // <old id, new id>
    const tagIdMap: Map<bigint, bigint> = new Map(); // <old id, new id>
    const assetIdMap: Map<bigint, bigint> = new Map(); // <old id, new id>
    const budgetIdMap: Map<bigint, bigint> = new Map(); // <old id, new id>
    const goalIdMap: Map<bigint, bigint> = new Map(); // <old id, new id>

    const restoredItems = data.budget_category_items ?? [];
    const parentKey = (row: {
      budgets_budget_id: unknown;
      budgets_users_user_id: unknown;
      categories_category_id: unknown;
    }) => `${row.budgets_budget_id}:${row.budgets_users_user_id}:${row.categories_category_id}`;
    const parents = new Map(
      (data.budgets_has_categories ?? []).map((row) => [parentKey(row), row])
    );
    const totals = new Map<string, bigint>();
    for (const item of restoredItems) {
      if (
        !parents.has(parentKey(item)) ||
        !['EXPENSE', 'INCOME'].includes(item.direction) ||
        !/^\d+$/.test(String(item.amount))
      )
        throw APIError.badRequest(
          'Invalid budget breakdown in backup.',
          'BUDGET_BREAKDOWN_INVALID'
        );
      const cents = BigInt(item.amount);
      normalizeItems([
        {
          label: item.label,
          amount: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`,
          sort_order: item.sort_order,
        },
      ]);
      const key = `${parentKey(item)}:${item.direction}`;
      totals.set(key, (totals.get(key) ?? 0n) + cents);
    }
    for (const [key, parent] of parents) {
      for (const direction of ['EXPENSE', 'INCOME']) {
        const sum = totals.get(`${key}:${direction}`);
        if (sum !== undefined) validateCents(sum);
        if (
          sum !== undefined &&
          (sum > BigInt(Number.MAX_SAFE_INTEGER) ||
            sum !==
              BigInt(
                direction === 'EXPENSE' ? parent.planned_amount_debit : parent.planned_amount_credit
              ))
        )
          throw APIError.badRequest(
            'Budget breakdown totals in backup do not match their allocation.',
            'BUDGET_BREAKDOWN_CONFLICT'
          );
      }
    }

    // Validate payee classifications before wiping anything
    const classifications = data.payee_classifications ?? [];
    for (const c of classifications) {
      if (
        typeof c?.payee_key !== 'string' ||
        c.payee_key.length === 0 ||
        c.payee_key.length > 255 ||
        (c.kind !== 'person' && c.kind !== 'merchant')
      ) {
        throw APIError.notAcceptable(
          'Payee classification not recognized in backup',
          RestoreUserErrorCodes.MalformedBackup
        );
      }
    }

    // Validate financial profile before wiping anything
    const profile = data.financial_profile ?? null;
    if (
      profile !== null &&
      (!Number.isInteger(profile.salary_cutoff_day) ||
        profile.salary_cutoff_day < 1 ||
        profile.salary_cutoff_day > 28)
    ) {
      throw APIError.notAcceptable(
        'Financial profile not recognized in backup',
        RestoreUserErrorCodes.MalformedBackup
      );
    }

    // Validate yearly costs and dismissals before wiping anything
    const yearlyCosts = data.yearly_costs ?? [];
    for (const c of yearlyCosts) {
      if (
        typeof c?.name !== 'string' ||
        c.name.length === 0 ||
        c.name.length > 255 ||
        !Number.isInteger(c.due_month) ||
        c.due_month < 1 ||
        c.due_month > 12 ||
        !/^\d+$/.test(String(c.amount))
      ) {
        throw APIError.notAcceptable(
          'Yearly cost not recognized in backup',
          RestoreUserErrorCodes.MalformedBackup
        );
      }
    }
    const plannedRows = data.planned_transactions ?? [];
    for (const r of plannedRows) {
      if (
        typeof r?.description !== 'string' ||
        r.description.length > 255 ||
        typeof r.type !== 'string' ||
        r.type.length !== 1 ||
        !/^\d+$/.test(String(r.amount)) ||
        !/^\d+$/.test(String(r.date_timestamp))
      ) {
        throw APIError.notAcceptable(
          'Planned transaction not recognized in backup',
          RestoreUserErrorCodes.MalformedBackup
        );
      }
    }
    const salaryPlans = data.salary_plans ?? [];
    for (const p of salaryPlans) {
      if (
        !Number.isInteger(p?.month) ||
        p.month < 190001 ||
        p.month % 100 < 1 ||
        p.month % 100 > 12 ||
        !/^\d+$/.test(String(p.salary_amount)) ||
        !Array.isArray(p.buckets)
      ) {
        throw APIError.notAcceptable(
          'Salary plan not recognized in backup',
          RestoreUserErrorCodes.MalformedBackup
        );
      }
    }
    const DEBT_KINDS = ['lent', 'borrowed', 'loan'];
    const isWhole = (v: unknown) => /^-?\d+$/.test(String(v));
    const debts = data.debts ?? [];
    for (const d of debts) {
      if (
        !DEBT_KINDS.includes(d?.kind) ||
        typeof d.counterparty_name !== 'string' ||
        d.counterparty_name.length > 255 ||
        !isWhole(d.principal) ||
        !isWhole(d.start_date) ||
        (d.due_date != null && !isWhole(d.due_date)) ||
        (d.emi != null && !isWhole(d.emi)) ||
        (d.rate != null && !Number.isFinite(Number(d.rate)))
      ) {
        throw APIError.notAcceptable('Debt not recognized in backup', RestoreUserErrorCodes.MalformedBackup);
      }
    }
    const debtIdsInBackup = new Set(debts.map((d) => String(d.debt_id)));
    const DEBT_ROLES = ['lend', 'borrow', 'repayment', 'disbursement', 'interest', 'principal'];
    for (const trx of data.transactions ?? []) {
      if (trx?.debt_role != null && !DEBT_ROLES.includes(trx.debt_role)) {
        throw APIError.notAcceptable(
          `Debt role not recognized for transaction #${trx.transaction_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }
    }
    const debtPayments = data.debt_payments ?? [];
    for (const p of debtPayments) {
      if (
        !debtIdsInBackup.has(String(p?.debts_debt_id)) ||
        !isWhole(p.date) ||
        !isWhole(p.amount) ||
        !isWhole(p.principal_part) ||
        (p.interest_part != null && !isWhole(p.interest_part))
      ) {
        throw APIError.notAcceptable(
          'Debt payment not recognized in backup',
          RestoreUserErrorCodes.MalformedBackup
        );
      }
    }
    const dismissals = data.yearly_cost_dismissals ?? [];
    for (const d of dismissals) {
      if (typeof d?.payee_key !== 'string' || d.payee_key.length === 0 || d.payee_key.length > 255) {
        throw APIError.notAcceptable(
          'Yearly cost dismissal not recognized in backup',
          RestoreUserErrorCodes.MalformedBackup
        );
      }
    }

    // Delete all previous records
    Logger.addLog('BackupManager > Restore | Deleting all user data...');
    await UserService.deleteAllUserData(userId, dbClient);
    Logger.addLog('BackupManager > Restore | Data successfully deleted!');

    // region Accounts
    const accountPromises = data.accounts.map(async (account) => {
      if (!Object.values(MYFIN.ACCOUNT_TYPES).includes(account.type)) {
        throw APIError.notAcceptable(
          `Account type not recognized for account #${account.account_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }

      if (!Object.values(MYFIN.ACCOUNT_STATUS).includes(account.status)) {
        throw APIError.notAcceptable(
          `Account status not recognized for account #${account.account_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }

      if (typeof account.exclude_from_budgets !== 'boolean') {
        throw APIError.notAcceptable(
          `Account exclude_from_budgets flag not recognized for account #${account.account_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }

      const newAccount = await dbClient.accounts.create({
        data: {
          name: account.name,
          type: account.type,
          description: account.description,
          exclude_from_budgets: account.exclude_from_budgets,
          status: account.status,
          users_user_id: userId,
          current_balance: account.current_balance,
          created_timestamp: account.created_timestamp,
          updated_timestamp: account.updated_timestamp,
          color_gradient: account.color_gradient,
          stale_after_days: account.stale_after_days ?? null,
          is_emergency_fund: account.is_emergency_fund ?? false,
        },
      });

      // Map old ID to new ID
      accountIdMap.set(account.account_id, newAccount.account_id);
      return newAccount;
    });
    // endregion
    // region Categories
    const categoryPromises = data.categories.map(async (category) => {
      if (!Object.values([0, 1]).includes(category.exclude_from_budgets)) {
        throw APIError.notAcceptable(
          `Category exclude_from_budgets flag not recognized for category #${category.category_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }

      if (!Object.values(MYFIN.CATEGORY_STATUS).includes(category.status)) {
        throw APIError.notAcceptable(
          `Category status not recognized for category #${category.category_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }

      const newCategory = await CategoryService.createCategory(
        {
          type: category.type,
          users_user_id: userId,
          name: category.name,
          description: category.description,
          color_gradient: category.color_gradient,
          icon_key: category.icon_key,
          status: category.status,
          exclude_from_budgets: category.exclude_from_budgets,
          is_fixed: category.is_fixed ?? false,
        },
        dbClient
      );
      // Map old ID to new ID
      categoryIdMap.set(category.category_id, newCategory.category_id);
      return newCategory;
    });
    // endregion
    // region Entities
    const entityPromises = data.entities.map(async (entity) => {
      const newEntity = await EntityService.createEntity(
        {
          users_user_id: userId,
          name: entity.name,
        },
        dbClient
      );

      // Map old ID to new ID
      entityIdMap.set(entity.entity_id, newEntity.entity_id);
      return newEntity;
    });
    // endregion
    // region Tags
    const tagPromises = data.tags.map(async (tag) => {
      const newTag = await TagService.createTag(
        {
          users_user_id: userId,
          name: tag.name,
          description: tag.description,
        },
        dbClient
      );

      // Map old ID to new ID
      tagIdMap.set(tag.tag_id, newTag.tag_id);
      return newTag;
    });
    // endregion
    // region Invest Assets
    const assetPromises = data.invest_assets.map(async (asset) => {
      if (!Object.values(MYFIN.INVEST.ASSET_TYPE).includes(asset.type)) {
        throw APIError.notAcceptable(
          `Asset type not recognized for asset #${asset.asset_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }

      const newAsset = await dbClient.invest_assets.create({
        data: {
          name: asset.name,
          ticker: asset.ticker,
          units: asset.units,
          type: asset.type,
          broker: asset.broker,
          created_at: asset.created_at,
          updated_at: asset.updated_at,
          users_user_id: userId,
        },
      });

      // Map old ID to new ID
      assetIdMap.set(asset.asset_id, newAsset.asset_id);
      return newAsset;
    });
    // endregion
    // region Budgets
    const budgetPromises = data.budgets.map(async (budget) => {
      const newBudget = await dbClient.budgets.create({
        data: {
          month: budget.month,
          year: budget.year,
          observations: budget.observations,
          is_open: budget.is_open,
          users_user_id: userId,
        },
      });

      // Map old ID to new ID
      budgetIdMap.set(budget.budget_id, newBudget.budget_id);
      return newBudget;
    });
    // endregion
    //region Goals
    const goalPromises = data.goals.map(async (goal) => {
      const newGoal = await dbClient.goals.create({
        data: {
          name: goal.name,
          description: goal.description,
          amount: goal.amount,
          created_at: goal.created_at,
          updated_at: goal.updated_at,
          users_user_id: userId,
          due_date: goal.due_date,
          priority: goal.priority,
          is_archived: goal.is_archived,
        },
      });

      // Map old ID to new ID
      goalIdMap.set(goal.goal_id, newGoal.goal_id);
      return newGoal;
    });
    //endregion
    Logger.addLog('BackupManager > Restore | Importing core entities...');
    await Promise.all([
      ...accountPromises,
      ...categoryPromises,
      ...entityPromises,
      ...tagPromises,
      ...assetPromises,
      ...budgetPromises,
      ...goalPromises,
    ]);
    Logger.addLog('BackupManager > Restore | Core entities successfully imported!');

    // region Yearly costs (before transactions, which link to them)
    const yearlyCostIdMap: Map<bigint, bigint> = new Map(); // <old id, new id>
    for (const c of yearlyCosts) {
      const created = await dbClient.yearly_costs.create({
        data: {
          users_user_id: userId,
          name: c.name,
          amount: BigInt(c.amount),
          due_month: c.due_month,
          // Keyed by the raw backup value (a Number after a JSON round trip), like every other map
          category_id: c.category_id != null ? (categoryIdMap.get(c.category_id) ?? null) : null,
          active: c.active ?? true,
          created_at: BigInt(c.created_at ?? 0),
        },
      });
      yearlyCostIdMap.set(c.yearly_cost_id, created.yearly_cost_id);
    }
    if (dismissals.length > 0) {
      await dbClient.yearly_cost_dismissals.createMany({
        data: dismissals.map((d) => ({ users_user_id: userId, payee_key: d.payee_key })),
        skipDuplicates: true,
      });
    }
    // endregion

    // region Debts (before transactions, which link to them)
    // <old id as text, new id>; text keys because ids may come back as numbers or strings after a JSON round trip
    const debtIdMap = new Map<string, bigint>();
    for (const d of debts) {
      const mapAccount = (v: bigint | null) => (v != null ? (accountIdMap.get(v) ?? null) : null);
      const created = await dbClient.debts.create({
        data: {
          users_user_id: userId,
          kind: d.kind,
          counterparty_name: d.counterparty_name,
          counterparty_key: d.counterparty_key ?? null,
          principal: BigInt(d.principal),
          rate: d.rate != null ? String(d.rate) : '0',
          tenure_months: d.tenure_months ?? null,
          emi: d.emi != null ? BigInt(d.emi) : null,
          emi_day: d.emi_day ?? null,
          // Keyed by the raw backup value (a Number after a JSON round trip), like every other map
          account_id: mapAccount(d.account_id),
          loan_account_id: mapAccount(d.loan_account_id),
          start_date: BigInt(d.start_date),
          due_date: d.due_date != null ? BigInt(d.due_date) : null,
          note: d.note ?? null,
          status: d.status === 'settled' ? 'settled' : 'open',
          created_at: BigInt(d.created_at ?? 0),
        },
      });
      debtIdMap.set(String(d.debt_id), created.debt_id);
    }
    // endregion

    // region Rules
    // check if all values are valid
    const rulePromises = data.rules.map(async (rule) => {
      if (
        !Object.values(MYFIN.RULES.OPERATOR).includes(rule.matcher_account_from_id_operator) ||
        !Object.values(MYFIN.RULES.OPERATOR).includes(rule.matcher_account_to_id_operator) ||
        !Object.values(MYFIN.RULES.OPERATOR).includes(rule.matcher_amount_operator) ||
        !Object.values(MYFIN.RULES.OPERATOR).includes(rule.matcher_type_operator) ||
        !Object.values(MYFIN.RULES.OPERATOR).includes(rule.matcher_description_operator)
      ) {
        throw APIError.notAcceptable(
          `Rule operator not recognized for rule #${rule.rule_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }

      if (typeof rule.assign_is_essential !== 'boolean') {
        throw APIError.notAcceptable(
          `Rule assign_is_essential flag not recognized for rule #${rule.rule_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }

      const newRule = await RuleService.createRule(
        userId,
        {
          users_user_id: userId,
          matcher_description_operator: rule.matcher_description_operator,
          matcher_description_value: rule.matcher_description_value,
          matcher_amount_operator: rule.matcher_amount_operator,
          matcher_amount_value: rule.matcher_amount_value
            ? ConvertUtils.convertBigIntegerToFloat(rule.matcher_amount_value)
            : undefined,
          matcher_type_operator: rule.matcher_type_operator,
          matcher_type_value: rule.matcher_type_value,
          matcher_account_to_id_operator: rule.matcher_account_to_id_operator,
          matcher_account_to_id_value: accountIdMap.get(rule.matcher_account_to_id_value),
          matcher_account_from_id_operator: rule.matcher_account_from_id_operator,
          matcher_account_from_id_value: accountIdMap.get(rule.matcher_account_from_id_value),
          assign_category_id: categoryIdMap.get(rule.assign_category_id),
          assign_entity_id: entityIdMap.get(rule.assign_entity_id),
          assign_account_to_id: accountIdMap.get(rule.assign_account_to_id),
          assign_account_from_id: accountIdMap.get(rule.assign_account_from_id),
          assign_type: rule.assign_type,
          assign_is_essential: rule.assign_is_essential,
        },
        dbClient
      );
      return newRule;
    });
    // endregion

    //region Transactions
    const trxPromises = data.transactions.map(async (trx) => {
      if (!Object.values(MYFIN.TRX_TYPES).includes(trx.type)) {
        throw APIError.notAcceptable(
          `Transaction type not recognized for transaction #${trx.transaction_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }

      const newTrx = await dbClient.transactions.create({
        data: {
          date_timestamp: trx.date_timestamp,
          description: trx.description,
          amount: trx.amount,
          type: trx.type,
          entities_entity_id: entityIdMap.get(trx.entities_entity_id),
          accounts_account_from_id: accountIdMap.get(trx.accounts_account_from_id),
          accounts_account_to_id: accountIdMap.get(trx.accounts_account_to_id),
          categories_category_id: categoryIdMap.get(trx.categories_category_id),
          is_essential: trx.is_essential,
          // Older backups predate adjustments.
          is_adjustment: trx.is_adjustment ?? false,
          // Older backups have no external_id; keep it when present so re-imports still dedupe.
          external_id: trx.external_id ?? undefined,
          yearly_cost_id:
            trx.yearly_cost_id != null ? (yearlyCostIdMap.get(trx.yearly_cost_id) ?? null) : null,
          // Older backups predate debts.
          debt_id: trx.debt_id != null ? (debtIdMap.get(String(trx.debt_id)) ?? null) : null,
          debt_role: trx.debt_id != null && debtIdMap.has(String(trx.debt_id)) ? (trx.debt_role ?? null) : null,
        },
      });
      return newTrx;
    });
    // endregion
    // region Asset Transactions
    const assetTrxPromises = data.invest_transactions.map(async (trx) => {
      if (!Object.values(MYFIN.INVEST.TRX_TYPE).includes(trx.type)) {
        throw APIError.notAcceptable(
          `Asset transaction type not recognized for transaction #${trx.transaction_id}`,
          RestoreUserErrorCodes.MalformedBackup
        );
      }

      const newTrx = await dbClient.invest_transactions.create({
        data: {
          date_timestamp: trx.date_timestamp,
          units: trx.units,
          fees_taxes_amount: trx.fees_taxes_amount,
          fees_taxes_units: trx.fees_taxes_units,
          total_price: trx.total_price,
          note: trx.note,
          type: trx.type,
          invest_assets_asset_id: assetIdMap.get(trx.invest_assets_asset_id),
          created_at: trx.created_at,
          updated_at: trx.updated_at,
        },
      });
      return newTrx;
    });
    // endregion

    Logger.addLog('BackupManager > Restore | Importing transactions...');
    const [, restoredTrx] = await Promise.all([
      Promise.all(rulePromises),
      Promise.all(trxPromises),
      Promise.all(assetTrxPromises),
    ]);
    // <old id as text, new id>; text keys because ids may come back as numbers or strings after a JSON round trip
    const transactionIdMap = new Map<string, bigint>();
    data.transactions.forEach((trx, i) => {
      transactionIdMap.set(String(trx.transaction_id), restoredTrx[i].transaction_id);
    });
    Logger.addLog('BackupManager > Restore | Transactions successfully imported!');

    // region Asset Evolution Snapshots
    const assetEvoSnapshots = data.invest_asset_evo_snapshot.map(async (snapshot) => {
      const newSnapshot = await dbClient.invest_asset_evo_snapshot.create({
        data: {
          month: snapshot.month,
          year: snapshot.year,
          units: snapshot.units,
          invested_amount: snapshot.invested_amount,
          current_value: snapshot.current_value,
          invest_assets_asset_id: assetIdMap.get(snapshot.invest_assets_asset_id),
          created_at: snapshot.created_at,
          updated_at: snapshot.updated_at,
          withdrawn_amount: snapshot.withdrawn_amount,
          income_amount: snapshot.income_amount ?? 0,
          cost_amount: snapshot.cost_amount ?? 0,
        },
      });
      return newSnapshot;
    });
    // endregion

    // region Budget Categories
    const budgetCategoriesPromises = (data.budgets_has_categories ?? []).map(async (category) => {
      const newBudgetCategory = await dbClient.budgets_has_categories.create({
        data: {
          budgets_budget_id: budgetIdMap.get(category.budgets_budget_id),
          budgets_users_user_id: userId,
          categories_category_id: categoryIdMap.get(category.categories_category_id),
          planned_amount_credit: category.planned_amount_credit,
          planned_amount_debit: category.planned_amount_debit,
          current_amount: category.current_amount,
        },
      });

      return newBudgetCategory;
    });
    // endregion

    await Promise.all(budgetCategoriesPromises);
    for (const item of restoredItems) {
      const parent = parents.get(parentKey(item));
      await dbClient.budget_category_items.create({
        data: {
          budgets_budget_id: budgetIdMap.get(parent.budgets_budget_id),
          budgets_users_user_id: userId,
          categories_category_id: categoryIdMap.get(parent.categories_category_id),
          direction: item.direction,
          label: item.label.trim(),
          amount: BigInt(item.amount),
          sort_order: item.sort_order,
        },
      });
    }

    // region Goal Accounts
    const goalAccountsPromises = data.goal_has_accounts.map(async (account) => {
      const newGoalAccount = await dbClient.goal_has_account.create({
        data: {
          accounts_account_id: accountIdMap.get(account.accounts_account_id),
          goals_goal_id: goalIdMap.get(account.goals_goal_id),
          match_type: account.match_type,
          match_value: account.match_value,
        },
      });

      return newGoalAccount;
    });
    // endregion

    // region Balance checks (the adjustment transaction id is not remapped: it is dropped)
    for (const check of data.balance_checks ?? []) {
      const accountId = accountIdMap.get(check.accounts_account_id);
      if (accountId == null) continue;
      await dbClient.balance_checks.create({
        data: {
          accounts_account_id: accountId,
          checked_at: BigInt(check.checked_at),
          real_balance: BigInt(check.real_balance),
          myfin_balance: BigInt(check.myfin_balance),
          result: check.result,
          adjustment_transaction_id: null,
        },
      });
    }
    // endregion

    // region Salary plans, then planned transactions (which point at plans), then the plans' bucket links
    const salaryPlanIdMap = new Map<string, bigint>();
    for (const p of salaryPlans) {
      const created = await dbClient.salary_plans.create({
        data: {
          users_user_id: userId,
          month: p.month,
          salary_transaction_id:
            p.salary_transaction_id != null ? (transactionIdMap.get(String(p.salary_transaction_id)) ?? null) : null,
          salary_amount: BigInt(p.salary_amount),
          buckets: [],
          created_at: BigInt(p.created_at ?? 0),
        },
      });
      salaryPlanIdMap.set(String(p.salary_plan_id), created.salary_plan_id);
    }
    const plannedIdMap = new Map<string, bigint>();
    for (const r of plannedRows) {
      const fromId = r.accounts_account_from_id != null ? accountIdMap.get(r.accounts_account_from_id) : null;
      const toId = r.accounts_account_to_id != null ? accountIdMap.get(r.accounts_account_to_id) : null;
      // Drop rows whose accounts are missing from the backup
      if (fromId === undefined || toId === undefined) continue;
      if (fromId == null && toId == null) continue;
      const created = await dbClient.planned_transactions.create({
        data: {
          users_user_id: userId,
          date_timestamp: BigInt(r.date_timestamp),
          amount: BigInt(r.amount),
          type: r.type,
          accounts_account_from_id: fromId,
          accounts_account_to_id: toId,
          categories_category_id:
            r.categories_category_id != null ? (categoryIdMap.get(r.categories_category_id) ?? null) : null,
          description: r.description,
          salary_plan_id:
            r.salary_plan_id != null ? (salaryPlanIdMap.get(String(r.salary_plan_id)) ?? null) : null,
          bucket: r.bucket ?? null,
          created_at: BigInt(r.created_at ?? 0),
        },
      });
      plannedIdMap.set(String(r.planned_id), created.planned_id);
    }
    const accountIdByText = new Map<string, bigint>();
    for (const [oldId, newId] of accountIdMap) accountIdByText.set(String(oldId), newId);
    for (const p of salaryPlans) {
      const buckets = (p.buckets as Record<string, unknown>[]).map((b) => {
        const mapped = (v: unknown, map: Map<string, bigint>) =>
          v == null ? null : (map.get(String(v))?.toString() ?? null);
        const plannedId = mapped(b.planned_id, plannedIdMap);
        const transactionId = mapped(b.transaction_id, transactionIdMap);
        const state = b.state === 'planned' && plannedId == null ? 'none' : b.state;
        return {
          ...b,
          account_to_id: mapped(b.account_to_id, accountIdByText),
          planned_id: plannedId,
          transaction_id: transactionId,
          state,
        };
      });
      await dbClient.salary_plans.update({
        where: { salary_plan_id: salaryPlanIdMap.get(String(p.salary_plan_id)) },
        data: { buckets: buckets as Prisma.InputJsonValue },
      });
    }
    // endregion

    // region Debt payments (after transactions, whose ids they point at)
    for (const p of debtPayments) {
      const mapTrx = (v: bigint | null) => (v != null ? (transactionIdMap.get(String(v)) ?? null) : null);
      await dbClient.debt_payments.create({
        data: {
          debts_debt_id: debtIdMap.get(String(p.debts_debt_id)),
          date: BigInt(p.date),
          amount: BigInt(p.amount),
          principal_part: BigInt(p.principal_part),
          interest_part: BigInt(p.interest_part ?? 0),
          transaction_id: mapTrx(p.transaction_id),
          principal_transaction_id: mapTrx(p.principal_transaction_id),
          installment_no: p.installment_no ?? null,
          manual: p.manual === true,
        },
      });
    }
    // endregion

    // region Payee classifications
    if (classifications.length > 0) {
      await dbClient.payee_classifications.createMany({
        data: classifications.map((c) => ({
          users_user_id: userId,
          payee_key: c.payee_key,
          kind: c.kind,
        })),
        skipDuplicates: true,
      });
    }
    // endregion

    // region Financial profile
    if (profile) {
      const oldCategoryId = profile.salary_category_id;
      await dbClient.user_financial_profile.create({
        data: {
          users_user_id: userId,
          salary_category_id:
            oldCategoryId != null
              ? // Keyed by the raw backup value (a Number after a JSON round trip), like every other map
                (categoryIdMap.get(oldCategoryId) ?? null)
              : null,
          salary_cutoff_day: profile.salary_cutoff_day,
          savings_target_mode: profile.savings_target_mode ?? 'amount',
          savings_target_value: BigInt(profile.savings_target_value ?? 0),
          // Keyed by the raw backup value (a Number after a JSON round trip), like every other map
          savings_target_account_id:
            profile.savings_target_account_id != null
              ? (accountIdMap.get(profile.savings_target_account_id) ?? null)
              : null,
          sinking_fund_account_id:
            profile.sinking_fund_account_id != null
              ? (accountIdMap.get(profile.sinking_fund_account_id) ?? null)
              : null,
          emergency_fund_target_months: profile.emergency_fund_target_months ?? 6,
          emergency_topup_percent: profile.emergency_topup_percent ?? 10,
          small_spend_cutoff: BigInt(profile.small_spend_cutoff ?? 20000),
          updated_at: BigInt(profile.updated_at),
        },
      });
    }
    // endregion

    Logger.addLog('BackupManager > Restore | Recalculating balances...');
    await Promise.all([
      AccountService.recalculateAllUserAccountsBalances(userId, dbClient),
      ...budgetCategoriesPromises,
      ...assetEvoSnapshots,
      ...goalAccountsPromises,
    ]);
    Logger.addLog('BackupManager > Restore | Balances successfully recalculated!');

    return Promise.resolve('ok');
  }
}

export default BackupManager;
