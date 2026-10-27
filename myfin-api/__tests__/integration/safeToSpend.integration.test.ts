import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService, { type TransactionFilter } from '../../src/services/transactionService.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import { createYearlyCost } from '../../src/services/planning/yearlyCostService.js';
import { safeToSpend } from '../../src/services/planning/safeToSpendService.js';
import { salaryRuleFor } from '../../src/services/insights/analyticsRules.js';
import { toTransactionFilter } from '../../src/controllers/transactionController.js';

const DAY = 86_400;
const AUG: YearMonth = { year: 2026, month: 8 };
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const NOV: YearMonth = { year: 2026, month: 11 };
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
const T = MYFIN.TRX_TYPES.TRANSFER;
const at = (ym: YearMonth, day: number) => monthRangeIST(ym).from + (day - 1) * DAY + 3600;
const NOW = monthRangeIST(NOV).from + 19 * DAY + 10 * 3600; // 2026-11-20 10:00 IST

async function setup() {
  const user = await UserService.createUser({ username: 'sts', password: '123', email: 'sts@x.com' });
  const uid = user.user_id;
  const bank = await AccountService.createAccount(
    { name: 'Bank', type: MYFIN.ACCOUNT_TYPES.CHECKING, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: uid },
    uid
  );
  const mkAcc = (name: string, ef = false) =>
    prisma.accounts.create({
      data: { name, type: MYFIN.ACCOUNT_TYPES.SAVINGS, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: uid, is_emergency_fund: ef },
    });
  const mkCat = (name: string, type: string, is_fixed = false) =>
    prisma.categories.create({ data: { name, type, users_user_id: uid, is_fixed } });
  const add = (t: { type: string; amount: number; ym: YearMonth; day: number; description: string; categoryId?: bigint; to?: bigint }) =>
    TransactionService.createTransaction(uid, {
      account_from_id: t.type === E || t.type === T ? bank.account_id : null,
      account_to_id: t.type === I ? bank.account_id : (t.to ?? null),
      amount: t.amount,
      category_id: t.categoryId ?? null,
      date_timestamp: at(t.ym, t.day),
      description: t.description,
      entity_id: null,
      is_essential: false,
      tags: [],
      type: t.type,
    });
  return { uid, bank, mkAcc, mkCat, add };
}

const drillSum = async (userId: bigint, filter: TransactionFilter) => {
  const { query, ...options } = filter;
  const result = await TransactionService.getFilteredTransactionsByForUser(userId, 0, 1000, query ?? '', options);
  const rows = result.results as Array<{ amount: unknown }>;
  return Math.round(rows.reduce((s, r) => s + Number(r.amount) * 100, 0)) / 100;
};

describe('safe to spend', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let rent: { category_id: bigint };
  let groceries: { category_id: bigint };
  let savings: { account_id: bigint };
  beforeEach(async () => {
    ctx = await setup();
    const salary = await ctx.mkCat('Salary', I);
    rent = await ctx.mkCat('Rent', E, true);
    groceries = await ctx.mkCat('Groceries', E);
    for (const ym of [AUG, SEP, OCT]) {
      await ctx.add({ type: I, amount: 100000, ym, day: 1, description: 'Salary', categoryId: salary.category_id });
      await ctx.add({ type: E, amount: 30000, ym, day: 2, description: 'Paid to LANDLORD', categoryId: rent.category_id });
      await ctx.add({ type: E, amount: 10000, ym, day: 3, description: 'Paid to GROCER', categoryId: groceries.category_id });
    }
    await ctx.add({ type: I, amount: 100000, ym: NOV, day: 1, description: 'Salary', categoryId: salary.category_id });
    await ctx.add({ type: E, amount: 6000, ym: NOV, day: 4, description: 'Paid to GROCER', categoryId: groceries.category_id });
    savings = await ctx.mkAcc('S');
    await updateFinancialProfile(ctx.uid, {
      savings_target_mode: 'percent',
      savings_target_value: 20,
      savings_target_account_id: savings.account_id,
    });
    await createYearlyCost(ctx.uid, { name: 'Insurance', amount: 12000, due_month: 3 });
    await ctx.add({ type: T, amount: 5000, ym: NOV, day: 3, description: 'To savings', to: savings.account_id });
  });

  test('worked example', async () => {
    const r = await safeToSpend(ctx.uid, NOW);
    expect(r).toMatchObject({
      month: '2026-11',
      days_left: 11,
      expected_income: 100000,
      income_so_far: 100000,
      typical_income: 100000,
      spent_so_far: 6000,
      fixed_still_to_come: 30000,
      savings_target: 15000,
      yearly_setaside: 1000,
      emergency_topup: 0,
      safe_to_spend: 48000,
      per_day: 4363.64,
      has_fixed_categories: true,
    });
    expect(r.fixed_lines).toEqual([
      { category_id: rent.category_id.toString(), name: 'Rent', typical: 30000, spent: 0, remaining: 30000 },
    ]);
  });

  test('paying rent moves it from still-to-come to spent', async () => {
    await ctx.add({ type: E, amount: 31000, ym: NOV, day: 5, description: 'Paid to LANDLORD', categoryId: rent.category_id });
    const r = await safeToSpend(ctx.uid, NOW);
    expect(r.fixed_still_to_come).toBe(0);
    expect(r.spent_so_far).toBe(37000);
    expect(r.safe_to_spend).toBe(47000);
  });

  test('emergency top-up is capped by the percentage and reduced by transfers', async () => {
    const ef = await ctx.mkAcc('EF', true);
    const r = await safeToSpend(ctx.uid, NOW);
    expect(r.emergency_topup).toBe(10000);
    expect(r.safe_to_spend).toBe(38000);
    await ctx.add({ type: T, amount: 4000, ym: NOV, day: 6, description: 'To EF', to: ef.account_id });
    expect((await safeToSpend(ctx.uid, NOW)).emergency_topup).toBe(6000);
  });

  test('no savings account: the full target applies; negative safe-to-spend', async () => {
    await updateFinancialProfile(ctx.uid, { savings_target_account_id: null });
    expect((await safeToSpend(ctx.uid, NOW)).savings_target).toBe(20000);
    await ctx.add({ type: E, amount: 60000, ym: NOV, day: 7, description: 'Big', categoryId: groceries.category_id });
    const r = await safeToSpend(ctx.uid, NOW);
    expect(r.safe_to_spend).toBeLessThan(0);
    expect(r.per_day).toBeLessThan(0);
  });

  test('yearly-linked expenses are not spent_so_far; drill-down sum equals the figure', async () => {
    const big = await ctx.add({ type: E, amount: 2500, ym: NOV, day: 8, description: 'Premium', categoryId: groceries.category_id });
    const yc = (await prisma.yearly_costs.findFirst({ where: { users_user_id: ctx.uid } }))!;
    await prisma.transactions.update({ where: { transaction_id: big.transaction_id }, data: { yearly_cost_id: yc.yearly_cost_id } });
    const r = await safeToSpend(ctx.uid, NOW);
    expect(r.spent_so_far).toBe(6000);
    const sum = await drillSum(ctx.uid, {
      type: E,
      ...toTransactionFilter({ effective_month: '2026-11', type: E, yearly_cost: 'unlinked' }),
      salaryRule: await salaryRuleFor(ctx.uid),
    } as TransactionFilter);
    expect(sum).toBe(r.spent_so_far);
  });

  test('new user has null typical income, no NaN', async () => {
    const u = await UserService.createUser({ username: 'fresh', password: '123', email: 'f@x.com' });
    const r = await safeToSpend(u.user_id, NOW);
    expect(r.typical_income).toBeNull();
    expect(r.has_fixed_categories).toBe(false);
    expect(r.fixed_lines).toEqual([]);
    for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    expect(r.safe_to_spend).toBe(0);
  });
});
