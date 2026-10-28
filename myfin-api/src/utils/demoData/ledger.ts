import { COLOR_GRADIENTS, MYFIN } from '../../consts.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { invest_transactions_type } from '../../generated/prisma/client.js';
import AccountService from '../../services/accountService.js';
import CategoryService from '../../services/categoryService.js';
import EntityService from '../../services/entityService.js';
import { dayStartIST } from '../../services/insights/insightsPrimitives.js';
import InvestAssetService from '../../services/investAssetService.js';
import InvestTransactionsService from '../../services/investTransactionsService.js';
import { createPlanned } from '../../services/planning/plannedTransactionService.js';
import { addDays } from '../../services/routines/eventDates.js';
import RuleService from '../../services/ruleService.js';
import UserService from '../../services/userService.js';
import DateTimeUtils from '../DateTimeUtils.js';
import {
  type AccountKey,
  CAR_INSURANCE,
  type CategoryKey,
  type DemoCalendar,
  type EntityKey,
  dayEpoch,
  demoBudgets,
  demoInvestments,
  demoTransactions,
  monthAt,
} from './dataset.js';

/** Ids of what the ledger step created, for the feature step. */
export type DemoLedger = {
  accounts: Record<AccountKey, bigint>;
  categories: Record<CategoryKey, bigint>;
  assets: { nifty: bigint; ppf: bigint };
  /** Keyed rows (see DemoTrx.key). */
  trx: Map<string, bigint>;
};

const gradient = (i: number) => COLOR_GRADIENTS[i % COLOR_GRADIENTS.length];

const CATEGORIES: Array<{
  key: CategoryKey;
  name: string;
  icon: string;
  fixed?: boolean;
  type?: string;
  description?: string;
}> = [
  { key: 'salary', name: 'Salary', icon: 'salary', description: 'Monthly salary' },
  { key: 'bonus', name: 'Bonus & other income', icon: 'cash' },
  // Same name and type the loan service looks up, so matched EMIs reuse it
  {
    key: 'loanInterest',
    name: 'Loan interest',
    icon: 'banking',
    fixed: true,
    type: MYFIN.TRX_TYPES.EXPENSE,
    description: 'Home loan interest',
  },
  {
    key: 'utilities',
    name: 'Utilities',
    icon: 'utilities',
    fixed: true,
    description: 'Electricity and water',
  },
  { key: 'mobile', name: 'Mobile & internet', icon: 'internet', fixed: true },
  {
    key: 'insurance',
    name: 'Insurance',
    icon: 'insurance',
    description: 'Life and car insurance premiums',
  },
  { key: 'groceries', name: 'Groceries', icon: 'groceries' },
  {
    key: 'eatingOut',
    name: 'Eating out',
    icon: 'restaurant',
    description: 'Food delivery, tea and snacks',
  },
  { key: 'fuel', name: 'Fuel & transport', icon: 'fuel' },
  { key: 'shopping', name: 'Shopping', icon: 'shopping' },
  { key: 'entertainment', name: 'Entertainment', icon: 'entertainment' },
  { key: 'health', name: 'Health', icon: 'pharmacy' },
  { key: 'gifts', name: 'Gifts', icon: 'gifts' },
];

const ENTITIES: Array<[EntityKey, string]> = [
  ['employer', 'Nimbus Software'],
  ['dmart', 'DMart'],
  ['relianceFresh', 'Reliance Fresh'],
  ['swiggy', 'Swiggy'],
  ['zomato', 'Zomato'],
  ['kseb', 'KSEB'],
  ['indianOil', 'Indian Oil'],
  ['amazon', 'Amazon'],
  ['hdfc', 'HDFC Bank'],
  ['zerodha', 'Zerodha'],
  ['lic', 'LIC'],
  ['croma', 'Croma'],
  ['pvr', 'PVR Cinemas'],
];

const ACCOUNTS: Array<{
  key: AccountKey;
  name: string;
  type: string;
  description: string;
  emergency?: boolean;
}> = [
  {
    key: 'salary',
    name: 'HDFC Salary',
    type: MYFIN.ACCOUNT_TYPES.CHECKING,
    description: 'Salary account',
  },
  {
    key: 'savings',
    name: 'SBI Savings',
    type: MYFIN.ACCOUNT_TYPES.SAVINGS,
    description: 'Emergency fund',
    emergency: true,
  },
  {
    key: 'sinking',
    name: 'Sinking fund',
    type: MYFIN.ACCOUNT_TYPES.SAVINGS,
    description: 'Set aside for yearly costs',
  },
  {
    key: 'invest',
    name: 'Zerodha',
    type: MYFIN.ACCOUNT_TYPES.INVESTING,
    description: 'Demat and mutual funds',
  },
  {
    key: 'card',
    name: 'HDFC Credit Card',
    type: MYFIN.ACCOUNT_TYPES.CREDIT,
    description: 'Credit card',
  },
];

async function createCategories(userId: bigint, tx: PrismaClient) {
  const out = {} as Record<CategoryKey, bigint>;
  for (const [i, c] of CATEGORIES.entries()) {
    const created = await CategoryService.createCategory(
      {
        type: c.type ?? 'M',
        users_user_id: userId,
        name: c.name,
        description: c.description ?? '',
        color_gradient: gradient(i),
        icon_key: c.icon,
        status: MYFIN.CATEGORY_STATUS.ACTIVE,
        exclude_from_budgets: 0,
        is_fixed: c.fixed ?? false,
      } as never,
      tx
    );
    out[c.key] = created.category_id;
  }
  return out;
}

async function createEntities(userId: bigint, tx: PrismaClient) {
  const out = {} as Record<EntityKey, bigint>;
  for (const [key, name] of ENTITIES) {
    const created = await EntityService.createEntity({ users_user_id: userId, name } as never, tx);
    out[key] = created.entity_id;
  }
  return out;
}

async function createAccounts(userId: bigint, now: number, tx: PrismaClient) {
  const out = {} as Record<AccountKey, bigint>;
  for (const [i, a] of ACCOUNTS.entries()) {
    const created = await AccountService.createAccount(
      {
        users_user_id: userId,
        name: a.name,
        description: a.description,
        exclude_from_budgets: false,
        type: a.type,
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        current_balance: 0,
        color_gradient: gradient(i + 3),
        is_emergency_fund: a.emergency ?? false,
        created_timestamp: now,
        updated_timestamp: now,
      } as never,
      userId,
      tx
    );
    out[a.key] = created.account_id;
  }
  return out;
}

async function createRules(
  userId: bigint,
  categories: Record<CategoryKey, bigint>,
  entities: Record<EntityKey, bigint>,
  tx: PrismaClient
) {
  const { OPERATOR } = MYFIN.RULES;
  const rule = (
    description: string,
    type: string | null,
    category: CategoryKey,
    entity: EntityKey,
    essential: boolean
  ) =>
    RuleService.createRule(
      userId,
      {
        users_user_id: userId,
        matcher_description_operator: OPERATOR.CONTAINS,
        matcher_description_value: description,
        matcher_amount_operator: OPERATOR.IGNORE,
        matcher_amount_value: 0,
        matcher_type_operator: type ? OPERATOR.EQUALS : OPERATOR.IGNORE,
        matcher_type_value: type,
        matcher_account_to_id_operator: OPERATOR.IGNORE,
        matcher_account_to_id_value: null,
        matcher_account_from_id_operator: OPERATOR.IGNORE,
        matcher_account_from_id_value: null,
        assign_category_id: categories[category],
        assign_entity_id: entities[entity],
        assign_account_to_id: null,
        assign_account_from_id: null,
        assign_type: null,
        assign_is_essential: essential,
      } as never,
      tx
    );
  await rule('SALARY', MYFIN.TRX_TYPES.INCOME, 'salary', 'employer', false);
  await rule('SWIGGY', null, 'eatingOut', 'swiggy', false);
  await rule('DMART', null, 'groceries', 'dmart', true);
  await rule('KSEB', null, 'utilities', 'kseb', true);
}

async function createInvestments(userId: bigint, cal: DemoCalendar, tx: PrismaClient) {
  const nifty = await InvestAssetService.createAsset(
    userId,
    {
      name: 'Nifty 50 index fund',
      ticker: 'NIFTY50',
      units: 0,
      type: MYFIN.INVEST.ASSET_TYPE.INDEX_FUNDS,
      broker: 'Zerodha',
    } as never,
    tx
  );
  const ppf = await InvestAssetService.createAsset(
    userId,
    {
      name: 'Public Provident Fund',
      ticker: 'PPF',
      units: 0,
      type: MYFIN.INVEST.ASSET_TYPE.FIXED_INCOME,
      broker: 'SBI',
    } as never,
    tx
  );
  const ids = { nifty: nifty.asset_id, ppf: ppf.asset_id };
  const { buys, values } = demoInvestments(cal);
  // In date order: each buy recalculates the asset's snapshots from its month on
  for (const b of buys)
    await InvestTransactionsService.createTransaction(
      userId,
      ids[b.asset],
      BigInt(b.date),
      b.note,
      b.rupees,
      b.units,
      0,
      0,
      invest_transactions_type.B,
      tx as never
    );
  for (const v of values)
    await InvestAssetService.updateCurrentAssetValue(
      userId,
      ids[v.asset],
      v.rupees,
      v.ym.month,
      v.ym.year,
      tx as never
    );
  return ids;
}

async function createBudgets(
  userId: bigint,
  cal: DemoCalendar,
  rows: ReturnType<typeof demoTransactions>,
  categories: Record<CategoryKey, bigint>,
  tx: PrismaClient
) {
  for (const b of demoBudgets(cal, rows)) {
    const budget = await tx.budgets.create({
      data: {
        month: b.ym.month,
        year: b.ym.year,
        observations: b.observations,
        is_open: b.isOpen,
        users_user_id: userId,
      },
    });
    await tx.budgets_has_categories.createMany({
      data: b.lines.map((l) => ({
        budgets_budget_id: budget.budget_id,
        budgets_users_user_id: userId,
        categories_category_id: categories[l.category],
        planned_amount_debit: l.debit * 100,
        planned_amount_credit: l.credit * 100,
        current_amount: 0,
      })),
    });
  }
}

/** Planned one-off payments in the coming weeks (the salary plan adds its own rows later). */
async function createPlannedPayments(
  userId: bigint,
  cal: DemoCalendar,
  ledger: Omit<DemoLedger, 'trx' | 'assets'>,
  tx: PrismaClient
) {
  const inDays = (days: number) => (dayStartIST(addDays(cal.today, days)) as number) + 10 * 3600;
  const due = monthAt(cal, 3);
  await createPlanned(
    userId,
    [
      {
        date_timestamp: inDays(12),
        amount: 5_001_00,
        type: MYFIN.TRX_TYPES.EXPENSE,
        account_from_id: ledger.accounts.salary,
        category_id: ledger.categories.gifts,
        description: 'Wedding gift - Rahul',
      },
      {
        date_timestamp: inDays(20),
        amount: 4_500_00,
        type: MYFIN.TRX_TYPES.EXPENSE,
        account_from_id: ledger.accounts.salary,
        category_id: ledger.categories.fuel,
        description: 'Car service',
      },
      {
        date_timestamp: dayEpoch(due, 10),
        amount: CAR_INSURANCE * 100,
        type: MYFIN.TRX_TYPES.EXPENSE,
        account_from_id: ledger.accounts.sinking,
        category_id: ledger.categories.insurance,
        description: 'Car insurance renewal',
      },
    ],
    tx as never
  );
}

/**
 * Everything that can be written inside one database transaction: the wipe, currency, categories,
 * entities, accounts, rules, bank and card rows, investments, budgets and planned payments, then
 * every account balance recalculated.
 */
export async function createLedger(
  userId: bigint,
  cal: DemoCalendar,
  tx: PrismaClient
): Promise<DemoLedger> {
  await UserService.deleteAllUserData(userId, tx);
  await UserService.changeCurrency(userId, MYFIN.CURRENCIES.INR.code, tx);

  const categories = await createCategories(userId, tx);
  const entities = await createEntities(userId, tx);
  const accounts = await createAccounts(userId, cal.now, tx);
  await createRules(userId, categories, entities, tx);

  const rows = demoTransactions(cal);
  const trx = new Map<string, bigint>();
  for (const r of rows) {
    const created = await tx.transactions.create({
      data: {
        date_timestamp: r.date,
        amount: Math.round(r.rupees * 100),
        type: r.type,
        description: r.description,
        entities_entity_id: r.entity ? entities[r.entity] : null,
        accounts_account_from_id: r.from ? accounts[r.from] : null,
        accounts_account_to_id: r.to ? accounts[r.to] : null,
        categories_category_id: r.category ? categories[r.category] : null,
        is_essential: r.essential ?? false,
        is_adjustment: r.adjustment ?? false,
      },
    });
    if (r.key) trx.set(r.key, created.transaction_id);
  }

  const assets = await createInvestments(userId, cal, tx);
  await createBudgets(userId, cal, rows, categories, tx);
  await createPlannedPayments(userId, cal, { accounts, categories }, tx);

  for (const accountId of Object.values(accounts)) {
    const balance = await AccountService.recalculateBalanceForAccountIncrementally(
      accountId,
      0,
      DateTimeUtils.getCurrentUnixTimestamp() + 1,
      tx
    );
    await AccountService.setNewAccountBalance(userId, accountId, balance, tx);
  }
  return { accounts, categories, assets, trx };
}
