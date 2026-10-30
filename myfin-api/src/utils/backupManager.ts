import { normalizeItems, validateCents } from '../services/budgetAllocationService.js';
import { createRequire } from 'node:module';
import { prisma } from '../config/prisma.js';
import { MYFIN } from '../consts.js';
import { RestoreUserErrorCodes } from '../controllers/userController.js';
import { validateLegacyData } from '../services/legacyValidation.js';
import { dayStartIST } from '../services/insights/insightsPrimitives.js';
import { EVENT_KINDS, EVENT_REPEATS } from '../services/routines/eventDates.js';
import { MILESTONE_KINDS } from '../services/routines/milestoneKinds.js';
import { MAX_RETIREMENT_AGE } from '../services/financialProfileService.js';
import { ageOn } from '../services/wealth/retirementMath.js';
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
  goal_has_assets?: Prisma.goal_has_assetGetPayload<object>[];
  transactions?: Prisma.transactionsGetPayload<object>[];
  /** Balance checks. Absent in backups made before balance check. */
  balance_checks?: Prisma.balance_checksGetPayload<object>[];
  /** Import instrument to account mappings. Absent in older backups. */
  import_instrument_mappings?: { source: string; instrument_key: string; accounts_account_id: bigint }[];
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
  /** "If something happens to me" file entries. Absent in older backups. */
  legacy_entries?: {
    entry_id: bigint;
    kind: string;
    account_id: bigint | null;
    data: unknown;
    sort_order: number;
    created_at: bigint | number;
    updated_at: bigint | number;
  }[];
  /** Per-month records (health score, review); past months frozen. Absent in older backups. */
  monthly_records?: {
    month: number;
    kind: string;
    data: unknown;
    frozen_at: bigint | number | string | null;
  }[];
  /** Event reminders (#6). All four are absent in older backups. */
  events?: {
    event_id: bigint;
    name: string;
    kind: string;
    date: string;
    repeat: string;
    amount: bigint | number | null;
    gift_budget: bigint | number | null;
    account_id: bigint | null;
    category_id: bigint | null;
    payee_key: string | null;
    tag_id: bigint | null;
    source_key: string | null;
    active: boolean;
    created_at: bigint | number;
  }[];
  event_occurrences?: {
    occurrence_id: bigint;
    events_event_id: bigint;
    date: string;
    status: string;
    done_at: bigint | number | null;
    /** Absent in backups made before done_manual. */
    done_manual?: boolean;
  }[];
  event_occurrence_transactions?: { occurrence_id: bigint; transaction_id: bigint }[];
  event_suggestion_dismissals?: { key: string }[];
  /** Transaction tags (ruling E4). Absent in older backups, which then restore without tag links. */
  transaction_has_tags?: { transaction_id: bigint; tag_id: bigint }[];
  /** Milestones (#21). goal_funded / debt_cleared keys (and data ids) are goal / debt ids. Absent in older backups. */
  milestones?: {
    milestone_id: bigint;
    kind: string;
    key: string;
    achieved_at: bigint | number | string;
    dismissed: boolean;
    data: unknown;
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
    /** Absent in backups made before loans. */
    original_amount?: bigint | number | null;
    original_category_id?: bigint | null;
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
    date_of_birth?: string | null;
    retirement_age?: number;
    expected_return_pct?: number | string | { toString(): string };
    inflation_pct?: number | string | { toString(): string };
    swr_pct?: number | string | { toString(): string };
    retirement_spending_basis?: string;
    family_support_monthly?: bigint | number;
    family_support_years?: number;
    /** First milestone evaluation (#21); absent in older backups. */
    milestones_evaluated_at?: bigint | number | string | null;
  } | null;
}

/** A backup number: a JSON number or numeric string; undefined when absent (null/undefined), NaN when malformed. */
function backupNumber(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  if (typeof v === 'object' && typeof (v as { toString(): string }).toString === 'function') {
    const text = String(v);
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  }
  return Number.NaN;
}

/** Absent, or a finite number in [min, max] (integer when `integer`). */
const inRange = (v: unknown, min: number, max: number, integer = false) => {
  const n = backupNumber(v);
  return n === undefined || (Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n)));
};

/** Absent, or whole non-negative cents (number or string). */
const isCents = (v: unknown) => v === null || v === undefined || /^\d+$/.test(String(v));

/** Retirement and planning fields of a backed-up financial profile, with the profile API's ranges. */
function validProfileExtras(p: NonNullable<BackupData['financial_profile']>): boolean {
  return (
    inRange(p.expected_return_pct, 0, 30) &&
    inRange(p.inflation_pct, 0, 20) &&
    inRange(p.swr_pct, 1, 10) &&
    inRange(p.retirement_age, 1, MAX_RETIREMENT_AGE, true) &&
    inRange(p.family_support_years, 0, 60, true) &&
    (p.date_of_birth == null || (typeof p.date_of_birth === 'string' && ageOn(p.date_of_birth, nowSeconds()) !== null)) &&
    (p.retirement_spending_basis == null || p.retirement_spending_basis === 'all' || p.retirement_spending_basis === 'fixed') &&
    isCents(p.family_support_monthly) &&
    isCents(p.savings_target_value) &&
    isCents(p.small_spend_cutoff) &&
    isCents(p.milestones_evaluated_at)
  );
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

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
      goalHasAssets,
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

      dbClient.goal_has_asset.findMany({
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
      goal_has_assets: goalHasAssets,
      transactions,
      balance_checks: await dbClient.balance_checks.findMany({
        where: { accounts: { users_user_id: userId } },
        orderBy: { check_id: 'asc' },
      }),
      import_instrument_mappings: await dbClient.import_instrument_mappings.findMany({
        where: { users_user_id: userId },
        select: { source: true, instrument_key: true, accounts_account_id: true },
        orderBy: { mapping_id: 'asc' },
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
      legacy_entries: await dbClient.legacy_entries.findMany({
        where: { users_user_id: userId },
        orderBy: { entry_id: 'asc' },
      }),
      monthly_records: await dbClient.monthly_records.findMany({
        where: { users_user_id: userId },
        select: { month: true, kind: true, data: true, frozen_at: true },
        orderBy: [{ month: 'asc' }, { kind: 'asc' }],
      }),
      events: await dbClient.events.findMany({
        where: { users_user_id: userId },
        orderBy: { event_id: 'asc' },
      }),
      event_occurrences: await dbClient.event_occurrences.findMany({
        where: { events: { users_user_id: userId } },
        orderBy: { occurrence_id: 'asc' },
      }),
      event_occurrence_transactions: await dbClient.event_occurrence_transactions.findMany({
        where: { occurrence: { events: { users_user_id: userId } } },
        orderBy: [{ occurrence_id: 'asc' }, { transaction_id: 'asc' }],
      }),
      event_suggestion_dismissals: await dbClient.event_suggestion_dismissals.findMany({
        where: { users_user_id: userId },
        select: { key: true },
        orderBy: { key: 'asc' },
      }),
      transaction_has_tags: (
        await dbClient.transaction_has_tags.findMany({
          where: { tags: { users_user_id: userId } },
          select: { transactions_transaction_id: true, tags_tag_id: true },
          orderBy: [{ tags_tag_id: 'asc' }, { transactions_transaction_id: 'asc' }],
        })
      ).map((l) => ({ transaction_id: l.transactions_transaction_id, tag_id: l.tags_tag_id })),
      milestones: await dbClient.milestones.findMany({
        where: { users_user_id: userId },
        select: { milestone_id: true, kind: true, key: true, achieved_at: true, dismissed: true, data: true },
        orderBy: { milestone_id: 'asc' },
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
            date_of_birth: true,
            retirement_age: true,
            expected_return_pct: true,
            inflation_pct: true,
            swr_pct: true,
            retirement_spending_basis: true,
            family_support_monthly: true,
            family_support_years: true,
            milestones_evaluated_at: true,
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

    // Validate financial profile before wiping anything (same ranges as the profile API)
    const profile = data.financial_profile ?? null;
    if (
      profile !== null &&
      (!Number.isInteger(profile.salary_cutoff_day) ||
        profile.salary_cutoff_day < 1 ||
        profile.salary_cutoff_day > 28 ||
        !validProfileExtras(profile))
    ) {
      throw APIError.notAcceptable(
        'Financial profile not recognized in backup',
        RestoreUserErrorCodes.MalformedBackup
      );
    }

    // Validate goal asset links before wiping anything
    const goalIdsInBackup = new Set((data.goals ?? []).map((g) => String(g.goal_id)));
    const assetIdsInBackup = new Set((data.invest_assets ?? []).map((a) => String(a.asset_id)));
    for (const link of data.goal_has_assets ?? []) {
      const value = backupNumber(link?.match_value);
      if (
        !goalIdsInBackup.has(String(link?.goals_goal_id)) ||
        !assetIdsInBackup.has(String(link?.invest_assets_asset_id)) ||
        (link.match_type !== MYFIN.GOALS.MATCH_TYPE.RELATIVE && link.match_type !== MYFIN.GOALS.MATCH_TYPE.ABSOLUTE) ||
        value === undefined ||
        !(value >= 0)
      ) {
        throw APIError.notAcceptable('Goal asset link not recognized in backup', RestoreUserErrorCodes.MalformedBackup);
      }
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
    for (const e of data.legacy_entries ?? []) {
      try {
        if (!['account', 'policy', 'contact', 'instruction'].includes(e?.kind)) throw new Error('kind');
        await validateLegacyData(e.kind as 'account', e.data);
      } catch {
        throw APIError.notAcceptable(
          'Legacy file entry not recognized in backup',
          RestoreUserErrorCodes.MalformedBackup
        );
      }
    }
    const recordKeys = new Set<string>();
    for (const r of data.monthly_records ?? []) {
      const key = `${r?.month}:${r?.kind}`;
      if (
        !Number.isInteger(r?.month) ||
        r.month < 190001 ||
        r.month % 100 < 1 ||
        r.month % 100 > 12 ||
        (r.kind !== 'health' && r.kind !== 'review') ||
        r.data === null ||
        typeof r.data !== 'object' ||
        (r.frozen_at != null && !/^\d+$/.test(String(r.frozen_at))) ||
        recordKeys.has(key)
      ) {
        throw APIError.notAcceptable(
          'Monthly record not recognized in backup',
          RestoreUserErrorCodes.MalformedBackup
        );
      }
      recordKeys.add(key);
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
        (p.interest_part != null && !isWhole(p.interest_part)) ||
        (p.original_amount != null && !isWhole(p.original_amount))
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

    // Validate event reminders before wiping anything
    const badEvent = (what: string) =>
      APIError.notAcceptable(`${what} not recognized in backup`, RestoreUserErrorCodes.MalformedBackup);
    const isKey = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 255;
    const events = data.events ?? [];
    const eventIds = new Set<string>();
    const sourceKeys = new Set<string>();
    for (const e of events) {
      if (
        !isWhole(e?.event_id) ||
        eventIds.has(String(e.event_id)) ||
        !isKey(e.name) ||
        !(EVENT_KINDS as readonly string[]).includes(e.kind) ||
        !(EVENT_REPEATS as readonly string[]).includes(e.repeat) ||
        typeof e.date !== 'string' ||
        dayStartIST(e.date) == null ||
        !isCents(e.amount) ||
        !isCents(e.gift_budget) ||
        (e.payee_key != null && !isKey(e.payee_key)) ||
        (e.source_key != null && (!isKey(e.source_key) || sourceKeys.has(e.source_key))) ||
        !isWhole(e.created_at) ||
        typeof e.active !== 'boolean'
      ) {
        throw badEvent('Event');
      }
      eventIds.add(String(e.event_id));
      if (e.source_key != null) sourceKeys.add(e.source_key);
    }
    const occurrences = data.event_occurrences ?? [];
    const occurrenceIds = new Set<string>();
    const occurrenceDays = new Set<string>();
    for (const o of occurrences) {
      const day = `${o?.events_event_id}|${o?.date}`;
      if (
        !isWhole(o?.occurrence_id) ||
        occurrenceIds.has(String(o.occurrence_id)) ||
        !eventIds.has(String(o.events_event_id)) ||
        typeof o.date !== 'string' ||
        dayStartIST(o.date) == null ||
        occurrenceDays.has(day) ||
        (o.status !== 'pending' && o.status !== 'done') ||
        (o.done_at != null && !isWhole(o.done_at)) ||
        (o.done_manual != null && typeof o.done_manual !== 'boolean')
      ) {
        throw badEvent('Event occurrence');
      }
      occurrenceIds.add(String(o.occurrence_id));
      occurrenceDays.add(day);
    }
    const transactionIdsInBackup = new Set((data.transactions ?? []).map((t) => String(t.transaction_id)));
    const linkedTransactions = new Set<string>();
    const occurrenceLinks = data.event_occurrence_transactions ?? [];
    for (const l of occurrenceLinks) {
      if (
        !occurrenceIds.has(String(l?.occurrence_id)) ||
        !transactionIdsInBackup.has(String(l.transaction_id)) ||
        linkedTransactions.has(String(l.transaction_id))
      ) {
        throw badEvent('Event transaction link');
      }
      linkedTransactions.add(String(l.transaction_id));
    }
    const tagIdsInBackup = new Set((data.tags ?? []).map((t) => String(t.tag_id)));
    const tagLinks = data.transaction_has_tags ?? [];
    for (const l of tagLinks) {
      if (!transactionIdsInBackup.has(String(l?.transaction_id)) || !tagIdsInBackup.has(String(l.tag_id))) {
        throw APIError.notAcceptable('Transaction tag not recognized in backup', RestoreUserErrorCodes.MalformedBackup);
      }
    }
    const eventDismissals = data.event_suggestion_dismissals ?? [];
    for (const d of eventDismissals) {
      if (!isKey(d?.key)) throw badEvent('Event suggestion dismissal');
    }
    const milestones = data.milestones ?? [];
    const milestoneKeys = new Set<string>();
    for (const m of milestones) {
      const unique = `${m?.kind}:${m?.key}`;
      if (
        !(MILESTONE_KINDS as readonly string[]).includes(m?.kind) ||
        typeof m.key !== 'string' ||
        m.key.length === 0 ||
        m.key.length > 64 ||
        !/^\d+$/.test(String(m.achieved_at)) ||
        typeof m.dismissed !== 'boolean' ||
        (m.data != null && typeof m.data !== 'object') ||
        milestoneKeys.has(unique) ||
        (m.kind === 'goal_funded' && !goalIdsInBackup.has(m.key)) ||
        (m.kind === 'debt_cleared' && !debtIdsInBackup.has(m.key))
      ) {
        throw APIError.notAcceptable('Milestone not recognized in backup', RestoreUserErrorCodes.MalformedBackup);
      }
      milestoneKeys.add(unique);
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
          is_retirement: account.is_retirement ?? false,
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
      // built-in type codes or a user-defined type name (see investAssetsController)
      if (typeof asset.type !== 'string' || asset.type.trim() === '' || asset.type.length > 75) {
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
          is_retirement: asset.is_retirement ?? false,
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

    // region Monthly records (no ids to remap)
    for (const r of data.monthly_records ?? []) {
      await dbClient.monthly_records.create({
        data: {
          users_user_id: userId,
          month: r.month,
          kind: r.kind,
          data: r.data as Prisma.InputJsonValue,
          frozen_at: r.frozen_at != null ? BigInt(r.frozen_at) : null,
        },
      });
    }
    // endregion

    // region Legacy file entries
    for (const e of data.legacy_entries ?? []) {
      const mappedAccount = e.account_id != null ? (accountIdMap.get(e.account_id) ?? null) : null;
      if (e.kind === 'account' && mappedAccount == null) continue;
      await dbClient.legacy_entries.create({
        data: {
          users_user_id: userId,
          kind: e.kind,
          // Keyed by the raw backup value; account entries without a restored account are dropped
          account_id: mappedAccount,
          data: (e.data ?? {}) as Prisma.InputJsonValue,
          sort_order: e.sort_order ?? 0,
          created_at: BigInt(e.created_at ?? 0),
          updated_at: BigInt(e.updated_at ?? 0),
        },
      });
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

    // region Goal Assets (old backups have none)
    const goalAssetsPromises = (data.goal_has_assets ?? []).map((link) =>
      dbClient.goal_has_asset.create({
        data: {
          invest_assets_asset_id: assetIdMap.get(link.invest_assets_asset_id),
          goals_goal_id: goalIdMap.get(link.goals_goal_id),
          match_type: link.match_type,
          match_value: link.match_value,
        },
      })
    );
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
          original_amount: p.original_amount != null ? BigInt(p.original_amount) : null,
          original_category_id:
            p.original_category_id != null ? (categoryIdMap.get(p.original_category_id) ?? null) : null,
        },
      });
    }
    // endregion

    // region Transaction tags (after transactions and tags)
    if (tagLinks.length > 0) {
      const rows = tagLinks
        .map((l) => ({
          transactions_transaction_id: transactionIdMap.get(String(l.transaction_id)),
          // Keyed by the raw backup value, like the map itself
          tags_tag_id: tagIdMap.get(l.tag_id),
        }))
        .filter(
          (r): r is { transactions_transaction_id: bigint; tags_tag_id: bigint } =>
            r.transactions_transaction_id != null && r.tags_tag_id != null
        );
      if (rows.length > 0) await dbClient.transaction_has_tags.createMany({ data: rows, skipDuplicates: true });
    }
    // endregion

    // region Event reminders (after transactions, which links point at)
    {
      const text = (map: Map<unknown, bigint>) => new Map([...map].map(([k, v]) => [String(k), v]));
      const accountsByText = text(accountIdMap);
      const yearlyByText = text(yearlyCostIdMap);
      // Suggestion keys hold account / yearly cost ids: point them at the restored rows (null when gone)
      const remapKey = (key: string): string | null => {
        const m = /^(card|yearly):(.+)$/.exec(key);
        if (!m) return key;
        const mapped = (m[1] === 'card' ? accountsByText : yearlyByText).get(m[2]);
        return mapped != null ? `${m[1]}:${mapped}` : null;
      };
      const eventIdMap = new Map<string, bigint>();
      for (const e of events) {
        const created = await dbClient.events.create({
          data: {
            users_user_id: userId,
            name: e.name,
            kind: e.kind,
            date: e.date,
            repeat: e.repeat,
            amount: e.amount != null ? BigInt(e.amount) : null,
            gift_budget: e.gift_budget != null ? BigInt(e.gift_budget) : null,
            // Keyed by the raw backup value (a Number after a JSON round trip), like every other map
            account_id: e.account_id != null ? (accountIdMap.get(e.account_id) ?? null) : null,
            category_id: e.category_id != null ? (categoryIdMap.get(e.category_id) ?? null) : null,
            payee_key: e.payee_key ?? null,
            tag_id: e.tag_id != null ? (tagIdMap.get(e.tag_id) ?? null) : null,
            source_key: e.source_key != null ? remapKey(e.source_key) : null,
            active: e.active !== false,
            created_at: BigInt(e.created_at ?? 0),
          },
        });
        eventIdMap.set(String(e.event_id), created.event_id);
      }
      const occurrenceIdMap = new Map<string, bigint>();
      for (const o of occurrences) {
        const created = await dbClient.event_occurrences.create({
          data: {
            events_event_id: eventIdMap.get(String(o.events_event_id)),
            date: o.date,
            status: o.status,
            done_at: o.done_at != null ? BigInt(o.done_at) : null,
            // Older backups: a done occurrence without links was marked by hand
            done_manual:
              o.done_manual ??
              (o.status === 'done' && !occurrenceLinks.some((l) => String(l.occurrence_id) === String(o.occurrence_id))),
          },
        });
        occurrenceIdMap.set(String(o.occurrence_id), created.occurrence_id);
      }
      for (const l of occurrenceLinks) {
        const transactionId = transactionIdMap.get(String(l.transaction_id));
        if (transactionId == null) continue;
        await dbClient.event_occurrence_transactions.create({
          data: { occurrence_id: occurrenceIdMap.get(String(l.occurrence_id)), transaction_id: transactionId },
        });
      }
      const keys = [...new Set(eventDismissals.map((d) => remapKey(d.key)).filter((k): k is string => k != null))];
      if (keys.length > 0) {
        await dbClient.event_suggestion_dismissals.createMany({
          data: keys.map((key) => ({ users_user_id: userId, key })),
          skipDuplicates: true,
        });
      }
    }
    // endregion

    // region Milestones (goal and debt ids remapped in the key and in data)
    if (milestones.length > 0) {
      const goalIdByText = new Map<string, bigint>();
      for (const [oldId, newId] of goalIdMap) goalIdByText.set(String(oldId), newId);
      const restored = milestones.flatMap((m) => {
        const map = m.kind === 'goal_funded' ? goalIdByText : m.kind === 'debt_cleared' ? debtIdMap : null;
        let key = m.key;
        let json = (m.data ?? null) as Record<string, unknown> | null;
        if (map) {
          const newId = map.get(m.key);
          if (newId == null) return [];
          key = newId.toString();
          const idField = m.kind === 'goal_funded' ? 'goal_id' : 'debt_id';
          json = { ...(json ?? {}), [idField]: key };
        }
        return [
          {
            users_user_id: userId,
            kind: m.kind,
            key,
            achieved_at: BigInt(m.achieved_at),
            dismissed: m.dismissed,
            ...(json != null ? { data: json as Prisma.InputJsonValue } : {}),
          },
        ];
      });
      await dbClient.milestones.createMany({ data: restored, skipDuplicates: true });
    }
    // endregion

    // region Import instrument mappings
    for (const m of data.import_instrument_mappings ?? []) {
      const accountId = accountIdMap.get(m.accounts_account_id);
      if (accountId == null) continue;
      await dbClient.import_instrument_mappings.upsert({
        where: {
          users_user_id_source_instrument_key: {
            users_user_id: userId,
            source: m.source,
            instrument_key: m.instrument_key,
          },
        },
        create: {
          users_user_id: userId,
          source: m.source,
          instrument_key: m.instrument_key,
          accounts_account_id: accountId,
        },
        update: { accounts_account_id: accountId },
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
          date_of_birth: profile.date_of_birth ?? null,
          retirement_age: profile.retirement_age ?? 60,
          expected_return_pct: Number(profile.expected_return_pct ?? 10),
          inflation_pct: Number(profile.inflation_pct ?? 6),
          swr_pct: Number(profile.swr_pct ?? 3.5),
          retirement_spending_basis: profile.retirement_spending_basis === 'fixed' ? 'fixed' : 'all',
          family_support_monthly: BigInt(profile.family_support_monthly ?? 0),
          family_support_years: profile.family_support_years ?? 0,
          milestones_evaluated_at:
            profile.milestones_evaluated_at != null ? BigInt(profile.milestones_evaluated_at) : null,
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
      ...goalAssetsPromises,
    ]);
    Logger.addLog('BackupManager > Restore | Balances successfully recalculated!');

    return Promise.resolve('ok');
  }
}

export default BackupManager;
