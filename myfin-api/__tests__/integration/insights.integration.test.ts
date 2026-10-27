import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService, {
  type TransactionFilter,
} from '../../src/services/transactionService.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import {
  getMonthInsights,
  setPayeeClassification,
} from '../../src/services/insights/insightsService.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import { effectiveMonthOf, salaryRuleFor } from '../../src/services/insights/analyticsRules.js';
import {
  monthInsightsSchema,
  payeeClassificationSchema,
} from '../../src/controllers/insightsController.js';

const DAY = 86_400;
const JUL: YearMonth = { year: 2026, month: 7 };
const AUG: YearMonth = { year: 2026, month: 8 };
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const NOV: YearMonth = { year: 2026, month: 11 };

type Ctx = {
  user: { user_id: bigint };
  bank: { account_id: bigint };
  upiLite: { account_id: bigint };
  food: { category_id: bigint };
  family: { category_id: bigint };
  salary: { category_id: bigint };
  insurance: { category_id: bigint };
  starHealthId: bigint;
};

const createAccount = (owner: { user_id: bigint }, name: string) =>
  AccountService.createAccount(
    {
      name,
      type: MYFIN.ACCOUNT_TYPES.CHECKING,
      description: '',
      status: MYFIN.ACCOUNT_STATUS.ACTIVE,
      exclude_from_budgets: false,
      current_balance: 0,
      users_user_id: owner.user_id,
    },
    owner.user_id
  );

const addTrx = async (
  userId: bigint,
  t: {
    type: string;
    from?: bigint | null;
    to?: bigint | null;
    amount: number;
    date: number;
    description: string;
    categoryId?: bigint | null;
  }
) => {
  await TransactionService.createTransaction(userId, {
    account_from_id: t.from ?? null,
    account_to_id: t.to ?? null,
    amount: t.amount,
    category_id: t.categoryId ?? null,
    date_timestamp: t.date,
    description: t.description,
    entity_id: null,
    is_essential: false,
    tags: [],
    type: t.type,
  });
  const last = await prisma.transactions.findFirst({ orderBy: { transaction_id: 'desc' } });
  return last!.transaction_id;
};

/** Jul–Oct 2026 for one user (amounts in rupees). */
async function seed(): Promise<Ctx> {
  const user = await UserService.createUser({
    username: 'demo',
    password: '123',
    email: 'demo@afaneca.com',
  });
  const bank = await createAccount(user, 'Bank');
  const upiLite = await createAccount(user, 'UPI Lite');
  const mkCat = (name: string, type: string) =>
    prisma.categories.create({ data: { name, type, users_user_id: user.user_id } });
  const food = await mkCat('Food', MYFIN.TRX_TYPES.EXPENSE);
  const family = await mkCat('Family', MYFIN.TRX_TYPES.EXPENSE);
  const salary = await mkCat('Salary', MYFIN.TRX_TYPES.INCOME);
  const insurance = await mkCat('Insurance', MYFIN.TRX_TYPES.EXPENSE);
  const E = MYFIN.TRX_TYPES.EXPENSE;
  const I = MYFIN.TRX_TYPES.INCOME;
  const uid = user.user_id;

  const swiggy: Record<number, number> = { 7: 400, 8: 450, 9: 500 };
  for (const ym of [JUL, AUG, SEP, OCT]) {
    const r = monthRangeIST(ym);
    await addTrx(uid, {
      type: I,
      to: bank.account_id,
      amount: 50000,
      date: r.from + DAY,
      description: 'Salary',
      categoryId: salary.category_id,
    });
    await addTrx(uid, {
      type: E,
      from: bank.account_id,
      amount: 10000,
      date: r.from + 2 * DAY,
      description: 'Paid to Achan',
      categoryId: family.category_id,
    });
    if (ym.month !== 10) {
      await addTrx(uid, {
        type: E,
        from: bank.account_id,
        amount: swiggy[ym.month],
        date: r.from + 5 * DAY,
        description: 'Paid to SWIGGY',
        categoryId: food.category_id,
      });
    }
  }
  const oct = monthRangeIST(OCT);
  const aug = monthRangeIST(AUG);
  // October Swiggy with a spelling variant
  await addTrx(uid, {
    type: E,
    from: bank.account_id,
    amount: 300,
    date: oct.from + 5 * DAY,
    description: 'Paid to SWIGGY',
    categoryId: food.category_id,
  });
  await addTrx(uid, {
    type: E,
    from: upiLite.account_id,
    amount: 250,
    date: oct.from + 9 * DAY,
    description: 'paid to  Swiggy ',
    categoryId: food.category_id,
  });
  await addTrx(uid, {
    type: E,
    from: bank.account_id,
    amount: 500,
    date: oct.from + 11 * DAY,
    description: 'Requested by Utthara M',
    categoryId: family.category_id,
  });
  const starHealthId = await addTrx(uid, {
    type: E,
    from: bank.account_id,
    amount: 18555,
    date: aug.from + 14 * DAY,
    description: 'Paid to STARHEALTH',
    categoryId: insurance.category_id,
  });
  // transfer bank → UPI Lite (never counted)
  await addTrx(uid, {
    type: MYFIN.TRX_TYPES.TRANSFER,
    from: bank.account_id,
    to: upiLite.account_id,
    amount: 2000,
    date: oct.from + 3 * DAY,
    description: 'Transfer to UPI Lite',
  });
  // empty description, uncategorised
  await addTrx(uid, {
    type: E,
    from: upiLite.account_id,
    amount: 150,
    date: oct.from + 12 * DAY,
    description: '',
  });
  // 2026-10-01 00:30 IST (October) and 2026-09-30 23:50 IST (September)
  await addTrx(uid, {
    type: E,
    from: upiLite.account_id,
    amount: 80,
    date: oct.from + 30 * 60,
    description: 'Paid to VEG BASKET',
  });
  await addTrx(uid, {
    type: E,
    from: upiLite.account_id,
    amount: 70,
    date: oct.from - 10 * 60,
    description: 'Paid to VEG BASKET',
  });

  return { user, bank, upiLite, food, family, salary, insurance, starHealthId };
}

const drillSum = async (userId: bigint, filter: TransactionFilter) => {
  const { query, ...options } = filter;
  const result = await TransactionService.getFilteredTransactionsByForUser(
    userId,
    0,
    1000,
    query ?? '',
    options
  );
  const rows = result.results as Array<{ amount: unknown }>;
  return Math.round(rows.reduce((s, r) => s + Number(r.amount) * 100, 0)) / 100;
};

describe('Monthly insights', () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  const octSpending = 300 + 250 + 10000 + 500 + 150 + 80;

  test('summary: income, spending without transfers, savings rate', async () => {
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.month).toEqual(OCT);
    expect(r.range).toEqual(monthRangeIST(OCT));
    expect(r.summary.income).toBe(50000);
    expect(r.summary.spending).toBe(octSpending);
    expect(r.summary.savings).toBe(50000 - octSpending);
    expect(r.summary.savings_rate).toBeCloseTo((50000 - octSpending) / 50000, 4);
  });

  test('typical month excludes the one-off and one_offs lists it', async () => {
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    const jul = 10000 + 400;
    const aug = 10000 + 450; // 18,555 one-off excluded
    const sep = 10000 + 500 + 70;
    expect(r.typical).not.toBeNull();
    expect(r.typical!.income).toBe(50000);
    expect(r.typical!.spending).toBeCloseTo((jul + aug + sep) / 3, 2);
    expect(r.typical!.savings_rate).toBeCloseTo((50000 - (jul + aug + sep) / 3) / 50000, 4);
    expect(r.one_offs).toHaveLength(1);
    expect(r.one_offs[0]).toMatchObject({
      transaction_id: ctx.starHealthId.toString(),
      payee_key: 'STARHEALTH',
      amount: 18555,
    });
  });

  test('merchants group spelling variants; people are separated', async () => {
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    const swiggy = r.merchants.top.filter((m) => m.payee_key === 'SWIGGY');
    expect(swiggy).toHaveLength(1);
    expect(swiggy[0]).toMatchObject({ amount: 550, count: 2, average: 275 });
    const people = r.people.map((p) => p.payee_key);
    expect(people).toContain('ACHAN');
    expect(people).toContain('UTTHARA M');
    expect(people).not.toContain('SWIGGY');
    expect(r.people.find((p) => p.payee_key === 'ACHAN')).toMatchObject({
      sent: 10000,
      received: 0,
      net: -10000,
      source: 'guess',
    });
    expect(r.merchants.top.map((m) => m.payee_key)).not.toContain('ACHAN');
  });

  test('empty payee key is never listed but is counted in totals and categories', async () => {
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.merchants.top.some((m) => m.payee_key === '')).toBe(false);
    expect(r.people.some((p) => p.payee_key === '')).toBe(false);
    expect(r.one_offs.some((o) => o.payee_key === '')).toBe(false);
    const uncategorised = r.by_category.find((c) => c.category_id === null);
    expect(uncategorised?.amount).toBe(150 + 80);
    const catTotal = r.by_category.reduce((s, c) => s + c.amount, 0);
    expect(catTotal).toBeCloseTo(r.summary.spending, 2);
    // desc by amount
    const amounts = r.by_category.map((c) => c.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });

  test('payment mix counts expenses by source account and skips transfers', async () => {
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    const bank = r.payment_mix.find((p) => p.account_id === ctx.bank.account_id.toString());
    const lite = r.payment_mix.find((p) => p.account_id === ctx.upiLite.account_id.toString());
    expect(bank).toMatchObject({ name: 'Bank', amount: 300 + 10000 + 500 });
    expect(lite).toMatchObject({ name: 'UPI Lite', amount: 250 + 150 + 80 });
  });

  test('trend has 12 months ending at the selected month', async () => {
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.trend).toHaveLength(12);
    expect(r.trend[11]).toMatchObject({
      year: 2026,
      month: 10,
      income: 50000,
      spending: octSpending,
    });
    expect(r.trend[0]).toMatchObject({
      year: 2025,
      month: 11,
      income: 0,
      spending: 0,
      savings_rate: null,
    });
    expect(r.trend[9]).toMatchObject({ year: 2026, month: 8, spending: 10000 + 450 + 18555 });
  });

  test('biggest changes compare with the baseline average', async () => {
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.biggest_changes.length).toBeLessThanOrEqual(5);
    const abs = r.biggest_changes.map((c) => Math.abs(c.amount - c.typical));
    expect(abs).toEqual([...abs].sort((a, b) => b - a));
    // Family: 10,500 now vs 10,000 typical
    const family = r.biggest_changes.find(
      (c) => c.kind === 'category' && c.key === ctx.family.category_id.toString()
    );
    expect(family).toMatchObject({ label: 'Family', amount: 10500, typical: 10000 });
    expect(family!.change_pct).toBeCloseTo(0.05, 4);
    // STARHEALTH one-off is excluded from the baseline, so Insurance does not appear as a drop
    expect(r.biggest_changes.some((c) => c.key === ctx.insurance.category_id.toString())).toBe(
      false
    );
    expect(r.biggest_changes.some((c) => c.key === 'STARHEALTH')).toBe(false);
  });

  test('a month with no data returns zeros, null typical and empty arrays', async () => {
    const r = await getMonthInsights(ctx.user.user_id, { year: 2025, month: 1 });
    expect(r.summary).toEqual({ income: 0, spending: 0, savings: 0, savings_rate: null });
    expect(r.typical).toBeNull();
    expect(r.by_category).toEqual([]);
    expect(r.merchants).toEqual({ top: [], other_amount: 0 });
    expect(r.people).toEqual([]);
    expect(r.biggest_changes).toEqual([]);
    expect(r.payment_mix).toEqual([]);
    expect(r.one_offs).toEqual([]);
    expect(r.trend).toHaveLength(12);
    expect(
      r.trend.every((t) => t.income === 0 && t.spending === 0 && t.savings_rate === null)
    ).toBe(true);
  });

  test('drill-down equality: SWIGGY and the uncategorised bar', async () => {
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    const { from, to } = monthRangeIST(OCT);
    const base = { type: MYFIN.TRX_TYPES.EXPENSE, dateFrom: from, dateTo: to };
    const swiggy = r.merchants.top.find((m) => m.payee_key === 'SWIGGY')!;
    expect(await drillSum(ctx.user.user_id, { ...base, payeeKey: 'SWIGGY' })).toBe(swiggy.amount);
    const none = r.by_category.find((c) => c.category_id === null)!;
    expect(await drillSum(ctx.user.user_id, { ...base, categoryId: 'none' })).toBe(none.amount);
    const food = r.by_category.find((c) => c.category_id === ctx.food.category_id.toString())!;
    expect(await drillSum(ctx.user.user_id, { ...base, categoryId: ctx.food.category_id })).toBe(
      food.amount
    );
    expect(await drillSum(ctx.user.user_id, base)).toBe(r.summary.spending);
    for (const p of r.payment_mix) {
      expect(await drillSum(ctx.user.user_id, { ...base, accountId: BigInt(p.account_id) })).toBe(
        p.amount
      );
    }
  });

  test('a correction moves a payee between people and merchants; null reverts to the guess', async () => {
    await setPayeeClassification(ctx.user.user_id, 'ACHAN', 'merchant');
    let r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.people.map((p) => p.payee_key)).not.toContain('ACHAN');
    expect(r.merchants.top.find((m) => m.payee_key === 'ACHAN')).toMatchObject({
      amount: 10000,
      count: 1,
    });

    await setPayeeClassification(ctx.user.user_id, 'SWIGGY', 'person');
    r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.people.find((p) => p.payee_key === 'SWIGGY')).toMatchObject({
      source: 'user',
      sent: 550,
    });

    await setPayeeClassification(ctx.user.user_id, 'ACHAN', null);
    r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.people.find((p) => p.payee_key === 'ACHAN')).toMatchObject({ source: 'guess' });
    expect(r.merchants.top.map((m) => m.payee_key)).not.toContain('ACHAN');
    expect(await prisma.payee_classifications.count()).toBe(1);
  });

  test('classifications are per user and removed by the user-data wipe', async () => {
    const other = await UserService.createUser({
      username: 'other',
      password: '123',
      email: 'o@afaneca.com',
    });
    await setPayeeClassification(other.user_id, 'ACHAN', 'merchant');
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.people.map((p) => p.payee_key)).toContain('ACHAN');
    await setPayeeClassification(ctx.user.user_id, 'ACHAN', 'merchant');
    await UserService.deleteAllUserData(ctx.user.user_id);
    expect(
      await prisma.payee_classifications.count({ where: { users_user_id: ctx.user.user_id } })
    ).toBe(0);
    expect(
      await prisma.payee_classifications.count({ where: { users_user_id: other.user_id } })
    ).toBe(1);
  });

  test('classifications survive backup and restore; old backups without them still restore', async () => {
    await setPayeeClassification(ctx.user.user_id, 'ACHAN', 'merchant');
    const backup = JSON.parse(JSON.stringify(await UserService.backupUser(ctx.user.user_id)));
    expect(backup.payee_classifications).toEqual([{ payee_key: 'ACHAN', kind: 'merchant' }]);

    await UserService.restoreUser(ctx.user.user_id, backup);
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.people.map((p) => p.payee_key)).not.toContain('ACHAN');
    expect(r.merchants.top.find((m) => m.payee_key === 'ACHAN')).toMatchObject({ amount: 10000 });

    const malformed = { ...backup, payee_classifications: [{ payee_key: 'ACHAN', kind: 'robot' }] };
    await expect(UserService.restoreUser(ctx.user.user_id, malformed)).rejects.toBeDefined();
    expect(
      await prisma.payee_classifications.count({ where: { users_user_id: ctx.user.user_id } })
    ).toBe(1);

    const older = { ...backup, payee_classifications: undefined };
    await UserService.restoreUser(ctx.user.user_id, older);
    expect(
      await prisma.payee_classifications.count({ where: { users_user_id: ctx.user.user_id } })
    ).toBe(0);
  });

  test('JSON has no bigint values', async () => {
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(() => JSON.stringify(r)).not.toThrow();
  });

  test('HTTP: month=13 is 400; valid requests return insights and save corrections', async () => {
    const app = (await import('../../src/app.js')).default;
    const server = app.listen(0);
    try {
      const session = await UserService.attemptLogin('demo', '123', false);
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server port');
      const base = `http://localhost:${address.port}/insights`;
      const headers = {
        authusername: session.username,
        sessionkey: session.sessionkey,
        'Content-Type': 'application/json',
      };
      expect((await fetch(`${base}/month?year=2026&month=13`, { headers })).status).toBe(400);
      const ok = await fetch(`${base}/month?year=2026&month=10`, { headers });
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body.summary.income).toBe(50000);
      expect(typeof body.payment_mix[0].account_id).toBe('string');
      const put = await fetch(`${base}/payee-classification`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ payee_key: 'ACHAN', kind: 'merchant' }),
      });
      expect(put.status).toBe(200);
      expect(await put.json()).toEqual({ ok: true });
      const bad = await fetch(`${base}/payee-classification`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ payee_key: 'ACHAN', kind: 'shop' }),
      });
      expect(bad.status).toBe(400);
      expect(await prisma.payee_classifications.count()).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  test('request validation', async () => {
    await expect(
      monthInsightsSchema.validateAsync({ year: '2026', month: '13' })
    ).rejects.toMatchObject({ isJoi: true });
    await expect(
      monthInsightsSchema.validateAsync({ year: '1999', month: '1' })
    ).rejects.toMatchObject({ isJoi: true });
    await expect(
      monthInsightsSchema.validateAsync({ year: '2026', month: '10' })
    ).resolves.toMatchObject({ year: 2026, month: 10 });
    await expect(
      payeeClassificationSchema.validateAsync({ payee_key: 'ACHAN', kind: null })
    ).resolves.toBeTruthy();
    await expect(
      payeeClassificationSchema.validateAsync({ payee_key: '', kind: 'person' })
    ).rejects.toMatchObject({ isJoi: true });
    await expect(
      payeeClassificationSchema.validateAsync({ payee_key: 'X', kind: 'shop' })
    ).rejects.toMatchObject({ isJoi: true });
  });
});

describe('Shared analytics rules', () => {
  let ctx: Ctx;
  const oct = monthRangeIST(OCT);
  const nov = monthRangeIST(NOV);
  const E = MYFIN.TRX_TYPES.EXPENSE;
  const I = MYFIN.TRX_TYPES.INCOME;

  beforeEach(async () => {
    ctx = await seed();
  });

  const addSalary = (date: number, amount: number) =>
    addTrx(ctx.user.user_id, {
      type: I,
      to: ctx.bank.account_id,
      amount,
      date,
      description: 'Salary',
      categoryId: ctx.salary.category_id,
    });

  const drill = async (ym: YearMonth, type: string) => {
    const rule = await salaryRuleFor(ctx.user.user_id);
    return drillSum(ctx.user.user_id, {
      type,
      effectiveMonth: ym,
      salaryRule: rule,
      excludeAdjustments: true,
    });
  };

  test('salary rule defaults to no category and day 25', async () => {
    expect(await salaryRuleFor(ctx.user.user_id)).toEqual({
      salaryCategoryId: null,
      cutoffDay: 25,
    });
  });

  test('salary at or after the cut-off counts in the next month', async () => {
    await updateFinancialProfile(ctx.user.user_id, {
      salary_category_id: Number(ctx.salary.category_id),
      salary_cutoff_day: 25,
    });
    await addSalary(oct.from + 24 * DAY - 60, 3000); // 2026-10-24 23:59 IST
    await addSalary(oct.from + 24 * DAY, 7000); // 2026-10-25 00:00 IST

    const octR = await getMonthInsights(ctx.user.user_id, OCT);
    const novR = await getMonthInsights(ctx.user.user_id, NOV);
    expect(octR.effective_month).toBe('2026-10');
    expect(octR.range).toEqual(oct);
    expect(octR.summary.income).toBe(53000);
    expect(novR.summary.income).toBe(7000);
    expect(novR.range).toEqual(nov);
    expect(octR.trend).toHaveLength(12);
    expect(novR.trend).toHaveLength(12);
    expect(novR.trend[11].income).toBe(7000);
    expect(octR.trend[11].income).toBe(53000);

    // drill-downs equal the figures
    expect(await drill(OCT, I)).toBe(53000);
    expect(await drill(NOV, I)).toBe(7000);
    expect(await drill(OCT, E)).toBe(octR.summary.spending);
  });

  test('a late salary from the previous month lands in the selected month', async () => {
    await updateFinancialProfile(ctx.user.user_id, {
      salary_category_id: Number(ctx.salary.category_id),
    });
    const sep = monthRangeIST(SEP);
    await addSalary(sep.from + 25 * DAY, 9000); // 2026-09-26 IST, late
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.summary.income).toBe(59000);
    expect(await drill(OCT, I)).toBe(59000);
    const sepR = await getMonthInsights(ctx.user.user_id, SEP);
    expect(sepR.summary.income).toBe(50000);
  });

  test('no salary category means nothing shifts', async () => {
    await addSalary(oct.from + 26 * DAY, 7000);
    const octR = await getMonthInsights(ctx.user.user_id, OCT);
    const novR = await getMonthInsights(ctx.user.user_id, NOV);
    expect(octR.summary.income).toBe(57000);
    expect(novR.summary.income).toBe(0);
    expect(await drill(OCT, I)).toBe(57000);
    expect(await drill(NOV, I)).toBe(0);
  });

  test('effectiveMonthOf tolerates a salary category that matches nothing', () => {
    const rule = { salaryCategoryId: 999_999n, cutoffDay: 25 };
    const row = { type: I, categoryId: ctx.salary.category_id.toString(), date: oct.from + 26 * DAY };
    expect(effectiveMonthOf(row, rule)).toEqual(OCT);
    expect(effectiveMonthOf({ ...row, categoryId: '999999' }, rule)).toEqual(NOV);
    expect(effectiveMonthOf({ ...row, type: E, categoryId: '999999' }, rule)).toEqual(OCT);
  });

  test('adjustments never count in insights but are still listed', async () => {
    await prisma.transactions.create({
      data: {
        type: E,
        amount: 99900,
        date_timestamp: oct.from + 6 * DAY,
        description: 'Reconciliation write-off',
        accounts_account_from_id: ctx.bank.account_id,
        is_adjustment: true,
      },
    });
    const r = await getMonthInsights(ctx.user.user_id, OCT);
    expect(r.summary.spending).toBe(10000 + 300 + 250 + 500 + 150 + 80);
    expect(await drill(OCT, E)).toBe(r.summary.spending);
    const listed = await TransactionService.getFilteredTransactionsByForUser(
      ctx.user.user_id, 0, 1000, 'write-off', {}
    );
    expect((listed.results as unknown[]).length).toBe(1);
    const excluded = await TransactionService.getFilteredTransactionsByForUser(
      ctx.user.user_id, 0, 1000, 'write-off', { excludeAdjustments: true }
    );
    expect((excluded.results as unknown[]).length).toBe(0);
  });

  test('list rows carry effective_month', async () => {
    await updateFinancialProfile(ctx.user.user_id, {
      salary_category_id: Number(ctx.salary.category_id),
    });
    await addSalary(oct.from + 24 * DAY, 7000);
    const rule = await salaryRuleFor(ctx.user.user_id);
    const res = await TransactionService.getFilteredTransactionsByForUser(
      ctx.user.user_id, 0, 1000, '', { effectiveMonth: NOV, salaryRule: rule }
    );
    const rows = res.results as Array<{ effective_month: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].effective_month).toBe('2026-11');
  });
});
