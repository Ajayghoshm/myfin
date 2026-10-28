import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService from '../../src/services/transactionService.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import { getMonthInsights } from '../../src/services/insights/insightsService.js';
import { typicalMonth } from '../../src/services/insights/typicalMonth.js';

const DAY = 86_400;
const AUG: YearMonth = { year: 2026, month: 8 };
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const NOV: YearMonth = { year: 2026, month: 11 };
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;

async function setup() {
  const user = await UserService.createUser({
    username: 'demo',
    password: '123',
    email: 'demo@afaneca.com',
  });
  const uid = user.user_id;
  const bank = await AccountService.createAccount(
    {
      name: 'Bank',
      type: MYFIN.ACCOUNT_TYPES.CHECKING,
      description: '',
      status: MYFIN.ACCOUNT_STATUS.ACTIVE,
      exclude_from_budgets: false,
      current_balance: 0,
      users_user_id: uid,
    },
    uid
  );
  const mkCat = (name: string, type: string, is_fixed = false) =>
    prisma.categories.create({ data: { name, type, users_user_id: uid, is_fixed } });
  const add = (t: {
    type: string;
    amount: number;
    ym: YearMonth;
    day: number;
    description: string;
    categoryId?: bigint;
  }) =>
    TransactionService.createTransaction(uid, {
      account_from_id: t.type === E ? bank.account_id : null,
      account_to_id: t.type === I ? bank.account_id : null,
      amount: t.amount,
      category_id: t.categoryId ?? null,
      date_timestamp: monthRangeIST(t.ym).from + t.day * DAY,
      description: t.description,
      entity_id: null,
      is_essential: false,
      tags: [],
      type: t.type,
    });
  return { uid, add, mkCat };
}

describe('typicalMonth helper', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  test('income one-off (bonus) is excluded from typical income', async () => {
    const salary = await ctx.mkCat('Salary', I);
    for (const ym of [AUG, SEP, OCT])
      await ctx.add({ type: I, amount: 100000, ym, day: 1, description: 'Salary', categoryId: salary.category_id });
    const bonus = await ctx.add({ type: I, amount: 200000, ym: SEP, day: 10, description: 'Bonus', categoryId: salary.category_id });
    const t = await typicalMonth(ctx.uid, NOV);
    expect(t.baselineMonths).toBe(3);
    expect(t.incomeCents).toBe(10_000_000);
    expect(t.oneOffIds.has(bonus.transaction_id.toString())).toBe(true);
    expect(t.byCategory.get(salary.category_id.toString())).toMatchObject({
      kind: 'income',
      avgCents: 10_000_000,
      monthly: [10_000_000, 10_000_000, 10_000_000],
    });
    const ins = await getMonthInsights(ctx.uid, NOV);
    expect(ins.typical!.income).toBe(100000);
    expect(ins.one_offs.map((o) => o.transaction_id)).not.toContain(bonus.transaction_id.toString());
    expect(ins.one_offs).toEqual([]);
  });

  test('fixed / flexible split and per-category monthly arrays', async () => {
    const rent = await ctx.mkCat('Rent', E, true);
    const groc = await ctx.mkCat('Groceries', E);
    const g = [9000, 10000, 11000];
    for (const [i, ym] of [AUG, SEP, OCT].entries()) {
      await ctx.add({ type: E, amount: 30000, ym, day: 2, description: 'Paid to LANDLORD', categoryId: rent.category_id });
      await ctx.add({ type: E, amount: g[i], ym, day: 5, description: 'Paid to BIGBASKET', categoryId: groc.category_id });
    }
    await ctx.add({ type: E, amount: 50, ym: OCT, day: 6, description: 'Paid to KIOSK' });
    const t = await typicalMonth(ctx.uid, NOV);
    expect(t.fixedCents).toBe(3_000_000);
    expect(t.flexibleCents).toBe(1_000_000);
    expect(t.unsortedCents).toBe(Math.round(5000 / 3));
    expect(t.byCategory.get(groc.category_id.toString())).toEqual({
      kind: 'flexible',
      avgCents: 1_000_000,
      monthly: [900000, 1000000, 1100000],
    });
    expect(t.byCategory.get(rent.category_id.toString())!.kind).toBe('fixed');
    expect(t.byCategory.size).toBe(2);
  });

  test('a month holding only yearly-cost rows still counts as a month with data', async () => {
    const groc = await ctx.mkCat('Groceries', E);
    await ctx.add({ type: E, amount: 3000, ym: SEP, day: 5, description: 'Paid to BIGBASKET', categoryId: groc.category_id });
    const big = await ctx.add({ type: E, amount: 12000, ym: OCT, day: 5, description: 'Paid to INSURER', categoryId: groc.category_id });
    const cost = await prisma.yearly_costs.create({
      data: { users_user_id: ctx.uid, name: 'Insurance', amount: 1_200_000, due_month: 10, created_at: 0 },
    });
    await prisma.transactions.update({
      where: { transaction_id: BigInt((big as { transaction_id: bigint }).transaction_id) },
      data: { yearly_cost_id: cost.yearly_cost_id },
    });
    const t = await typicalMonth(ctx.uid, NOV);
    expect(t.baselineMonths).toBe(2);
    expect(t.spendingCents).toBe(150_000); // 3000 over the two months with data
  });

  test('a single baseline month averages over one month', async () => {
    const groc = await ctx.mkCat('Groceries', E);
    await ctx.add({ type: E, amount: 4000, ym: OCT, day: 5, description: 'Paid to BIGBASKET', categoryId: groc.category_id });
    const t = await typicalMonth(ctx.uid, NOV);
    expect(t.baselineMonths).toBe(1);
    expect(t.spendingCents).toBe(400_000);
    expect(t.byCategory.get(groc.category_id.toString())!.monthly).toEqual([400_000]);
  });

  test('salary on/after the cut-off lands in the next month bucket', async () => {
    const salary = await ctx.mkCat('Salary', I);
    await updateFinancialProfile(ctx.uid, {
      salary_category_id: Number(salary.category_id),
      salary_cutoff_day: 25,
    });
    const JUL: YearMonth = { year: 2026, month: 7 };
    // Credited on the 26th of Jul/Aug/Sep -> effective Aug/Sep/Oct. Oct 26 -> Nov (outside baseline).
    for (const ym of [JUL, AUG, SEP, OCT])
      await ctx.add({ type: I, amount: 100000, ym, day: 25, description: 'Salary', categoryId: salary.category_id });
    const t = await typicalMonth(ctx.uid, NOV);
    expect(t.baselineMonths).toBe(3);
    expect(t.incomeCents).toBe(10_000_000);
    expect(t.byCategory.get(salary.category_id.toString())!.monthly).toEqual([10_000_000, 10_000_000, 10_000_000]);
  });

  test('new user: zero baseline months, null figures', async () => {
    const t = await typicalMonth(ctx.uid, NOV);
    expect(t).toMatchObject({
      baselineMonths: 0,
      incomeCents: null,
      spendingCents: null,
      fixedCents: null,
      flexibleCents: null,
      unsortedCents: null,
    });
    expect(t.byCategory.size).toBe(0);
    expect(t.oneOffIds.size).toBe(0);
  });

  test('blank-description expense one-offs: big and unmatched is a one-off, a repeating same-category amount is not', async () => {
    const rent = await ctx.mkCat('Rent', E, true);
    for (const [i, ym] of [AUG, SEP, OCT].entries())
      await ctx.add({ type: E, amount: 15000 + i * 500, ym, day: 2, description: '', categoryId: rent.category_id });
    const house = await ctx.add({ type: E, amount: 300000, ym: AUG, day: 5, description: '' });
    const t = await typicalMonth(ctx.uid, NOV);
    expect([...t.oneOffIds]).toEqual([house.transaction_id.toString()]);
    expect(t.spendingCents).toBe(1_550_000);
    expect(t.unsortedCents).toBe(0);
  });
});
