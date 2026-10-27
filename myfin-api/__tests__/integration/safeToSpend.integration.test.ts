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
import { listPlanned, markDone } from '../../src/services/planning/plannedTransactionService.js';
import { confirmSalaryPlan } from '../../src/services/planning/salaryPlanService.js';

const DAY = 86_400;
const AUG: YearMonth = { year: 2026, month: 8 };
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const NOV: YearMonth = { year: 2026, month: 11 };
const JUL: YearMonth = { year: 2026, month: 7 };
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
      savings_deducted: 20000,
      yearly_setaside: 1000,
      yearly_deducted: 1000,
      emergency_topup: 0,
      emergency_deducted: 0,
      safe_to_spend: 43000,
      per_day: 3909.09,
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
    expect(r.safe_to_spend).toBe(42000);
  });

  test('emergency top-up is capped by the percentage and reduced by transfers', async () => {
    const ef = await ctx.mkAcc('EF', true);
    const r = await safeToSpend(ctx.uid, NOW);
    expect(r.emergency_topup).toBe(10000);
    expect(r.safe_to_spend).toBe(33000);
    await ctx.add({ type: T, amount: 4000, ym: NOV, day: 6, description: 'To EF', to: ef.account_id });
    const after = await safeToSpend(ctx.uid, NOW);
    expect(after.emergency_topup).toBe(6000);
    // Money already moved counts as set aside: the deduction stays at the target
    expect(after.emergency_deducted).toBe(10000);
    expect(after.safe_to_spend).toBe(33000);
  });

  test('B6: over-saving beyond the target lowers safe-to-spend by the excess', async () => {
    const before = await safeToSpend(ctx.uid, NOW);
    // 5,000 already moved; 25,000 more makes 30,000 against a 20,000 target
    await ctx.add({ type: T, amount: 25000, ym: NOV, day: 6, description: 'To savings', to: savings.account_id });
    const r = await safeToSpend(ctx.uid, NOW);
    expect(r.savings_target).toBe(0);
    expect(r.savings_deducted).toBe(30000);
    expect(before.savings_deducted).toBe(20000);
    expect(r.safe_to_spend).toBe(before.safe_to_spend - 10000);
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

describe('safe to spend with a salary plan (late salary)', () => {
  // Salary lands on the 28th, after the 25th cut-off, so it pays for the next month.
  async function salarySetup() {
    const ctx = await setup();
    const salaryCat = await ctx.mkCat('Salary', I);
    const rent = await ctx.mkCat('Rent', E, true);
    for (const ym of [JUL, AUG, SEP, OCT]) {
      await ctx.add({ type: I, amount: 100000, ym, day: 28, description: 'Salary', categoryId: salaryCat.category_id });
      await ctx.add({ type: E, amount: 30000, ym, day: 2, description: 'Paid to LANDLORD', categoryId: rent.category_id });
    }
    const savingsAcc = await ctx.mkAcc('Savings');
    const sinkingAcc = await ctx.mkAcc('Sinking');
    const efAcc = await ctx.mkAcc('EF', true);
    await updateFinancialProfile(ctx.uid, {
      salary_category_id: salaryCat.category_id,
      salary_cutoff_day: 25,
      savings_target_mode: 'percent',
      savings_target_value: 20,
      savings_target_account_id: savingsAcc.account_id,
      sinking_fund_account_id: sinkingAcc.account_id,
      emergency_topup_percent: 10,
    });
    await createYearlyCost(ctx.uid, { name: 'Insurance', amount: 12000, due_month: 3 });
    const salary = (await prisma.transactions.findFirstOrThrow({
      where: { type: I, date_timestamp: at(OCT, 28), categories_category_id: salaryCat.category_id },
    }))!;
    const confirm = (yearly = 1000) =>
      confirmSalaryPlan(ctx.uid, {
        month: '2026-11',
        salary_transaction_id: salary.transaction_id,
        buckets: [
          { bucket: 'fixed', amount: 30000, account_to_id: null },
          { bucket: 'yearly', amount: yearly, account_to_id: sinkingAcc.account_id },
          { bucket: 'emergency', amount: 10000, account_to_id: efAcc.account_id },
          { bucket: 'savings', amount: 20000, account_to_id: savingsAcc.account_id },
          { bucket: 'free', amount: 0, account_to_id: null },
        ],
      });
    return { ...ctx, confirm };
  }
  const OCT_29 = at(OCT, 29) + 9 * 3600;

  test('B5: plan transfers dated in the previous month count for the plan month, not that month', async () => {
    const ctx = await salarySetup();
    const octBefore = await safeToSpend(ctx.uid, OCT_29);
    expect(octBefore).toMatchObject({ savings_target: 20000, yearly_setaside: 1000, emergency_topup: 10000 });
    await ctx.confirm();
    for (const p of await listPlanned(ctx.uid)) await markDone(ctx.uid, BigInt(p.planned_id), OCT_29);

    // October's set-asides are untouched by November's plan transfers (dated Oct 28)
    const oct = await safeToSpend(ctx.uid, OCT_29);
    expect(oct).toMatchObject({ savings_target: 20000, yearly_setaside: 1000, emergency_topup: 10000 });

    // November's lines drop: the transfers are already done
    const nov = await safeToSpend(ctx.uid, NOW);
    expect(nov).toMatchObject({
      savings_target: 0,
      yearly_setaside: 0,
      emergency_topup: 0,
      savings_deducted: 20000,
      yearly_deducted: 1000,
      emergency_deducted: 10000,
    });
  });

  test('B6: the confirmed plan bucket is the target; a yearly bucket of 0 removes the yearly deduction', async () => {
    const ctx = await salarySetup();
    const withoutPlan = await safeToSpend(ctx.uid, NOW);
    expect(withoutPlan.yearly_deducted).toBe(1000);
    await ctx.confirm(0);
    const r = await safeToSpend(ctx.uid, NOW);
    expect(r.yearly_setaside).toBe(0);
    expect(r.yearly_deducted).toBe(0);
    expect(r.safe_to_spend).toBe(withoutPlan.safe_to_spend + 1000);
  });
});
