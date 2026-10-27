import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import AccountService from '../../src/services/accountService.js';
import CategoryService from '../../src/services/categoryService.js';
import TransactionService, {
  type TransactionFilter,
} from '../../src/services/transactionService.js';
import BackupManager from '../../src/utils/backupManager.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import { getMonthInsights } from '../../src/services/insights/insightsService.js';
import { toTransactionFilter } from '../../src/controllers/transactionController.js';
import userBackupMock from './mock/user-backup.mock.json';

const DAY = 86_400;
const JUL: YearMonth = { year: 2026, month: 7 };
const AUG: YearMonth = { year: 2026, month: 8 };
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;

const addTrx = (
  userId: bigint,
  t: {
    type: string;
    from?: bigint;
    to?: bigint;
    amount: number;
    date: number;
    description: string;
    categoryId?: bigint | null;
  }
) =>
  TransactionService.createTransaction(userId, {
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

/** Same shape as the insights seed; Family and Insurance are fixed. */
async function seed() {
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
  const food = await mkCat('Food', E);
  const family = await mkCat('Family', E, true);
  const salary = await mkCat('Salary', I);
  const insurance = await mkCat('Insurance', E, true);
  const from = bank.account_id;

  const swiggy: Record<number, number> = { 7: 400, 8: 450, 9: 500 };
  for (const ym of [JUL, AUG, SEP, OCT]) {
    const r = monthRangeIST(ym);
    await addTrx(uid, { type: I, to: from, amount: 50000, date: r.from + DAY, description: 'Salary', categoryId: salary.category_id });
    await addTrx(uid, { type: E, from, amount: 10000, date: r.from + 2 * DAY, description: 'Paid to Achan', categoryId: family.category_id });
    if (ym.month !== 10) {
      await addTrx(uid, { type: E, from, amount: swiggy[ym.month], date: r.from + 5 * DAY, description: 'Paid to SWIGGY', categoryId: food.category_id });
    }
  }
  const oct = monthRangeIST(OCT);
  const aug = monthRangeIST(AUG);
  await addTrx(uid, { type: E, from, amount: 300, date: oct.from + 5 * DAY, description: 'Paid to SWIGGY', categoryId: food.category_id });
  await addTrx(uid, { type: E, from, amount: 250, date: oct.from + 9 * DAY, description: 'paid to  Swiggy ', categoryId: food.category_id });
  await addTrx(uid, { type: E, from, amount: 500, date: oct.from + 11 * DAY, description: 'Requested by Utthara M', categoryId: family.category_id });
  await addTrx(uid, { type: E, from, amount: 18555, date: aug.from + 14 * DAY, description: 'Paid to STARHEALTH', categoryId: insurance.category_id });
  await addTrx(uid, { type: E, from, amount: 150, date: oct.from + 12 * DAY, description: '' });
  await addTrx(uid, { type: E, from, amount: 80, date: oct.from + 30 * 60, description: 'Paid to VEG BASKET' });
  await addTrx(uid, { type: E, from, amount: 70, date: oct.from - 10 * 60, description: 'Paid to VEG BASKET' });
  return { user, uid, bank, food, family, salary, insurance };
}

const drillSum = async (userId: bigint, filter: TransactionFilter) => {
  const { query, ...options } = filter;
  const result = await TransactionService.getFilteredTransactionsByForUser(userId, 0, 1000, query ?? '', options);
  const rows = result.results as Array<{ amount: unknown }>;
  return Math.round(rows.reduce((s, r) => s + Number(r.amount) * 100, 0)) / 100;
};

describe('Fixed vs flexible costs', () => {
  let ctx: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => {
    ctx = await seed();
  });

  test('October cost_split', async () => {
    const r = await getMonthInsights(ctx.uid, OCT);
    expect(r.cost_split).toEqual({ fixed: 10500, flexible: 550, unsorted: 230 });
    const { fixed, flexible, unsorted } = r.cost_split;
    expect(fixed + flexible + unsorted).toBeCloseTo(r.summary.spending, 2);
  });

  test('typical_cost_split excludes the insurance one-off', async () => {
    const r = await getMonthInsights(ctx.uid, OCT);
    expect(r.typical_cost_split).not.toBeNull();
    expect(r.typical_cost_split!.fixed).toBeCloseTo(10000, 2);
    expect(r.typical_cost_split!.flexible).toBeCloseTo(450, 2);
    expect(r.typical_cost_split!.unsorted).toBeCloseTo(70 / 3, 2);
  });

  test('typical_cost_split is null without baseline data', async () => {
    const r = await getMonthInsights(ctx.uid, { year: 2025, month: 1 });
    expect(r.typical_cost_split).toBeNull();
    expect(r.cost_split).toEqual({ fixed: 0, flexible: 0, unsorted: 0 });
  });

  test('trend entries carry fixed / flexible / unsorted', async () => {
    const r = await getMonthInsights(ctx.uid, OCT);
    expect(r.trend[11]).toMatchObject({ fixed: 10500, flexible: 550, unsorted: 230 });
    expect(r.trend[9]).toMatchObject({ fixed: 10000 + 18555, flexible: 450, unsorted: 0 });
    expect(r.trend[0]).toMatchObject({ fixed: 0, flexible: 0, unsorted: 0 });
  });

  test('drill-down sums equal the cost_split figures', async () => {
    const r = await getMonthInsights(ctx.uid, OCT);
    for (const kind of ['fixed', 'flexible', 'unsorted'] as const) {
      const sum = await drillSum(
        ctx.uid,
        toTransactionFilter({ cost_kind: kind, effective_month: '2026-10', type: E })
      );
      expect(sum).toBe(r.cost_split[kind]);
    }
  });

  test('cost_kind filter works on the plain filter too', async () => {
    expect(await drillSum(ctx.uid, { costKind: 'fixed', effectiveMonth: OCT })).toBe(10500);
  });

  describe('categories', () => {
    test('create and update round-trip is_fixed; omitted leaves it unchanged', async () => {
      const created = await CategoryService.createCategory({
        name: 'Rent',
        color_gradient: 'x',
        status: MYFIN.CATEGORY_STATUS.ACTIVE,
        type: 'M',
        exclude_from_budgets: 0,
        is_fixed: true,
        users_user_id: ctx.uid,
      });
      expect((await prisma.categories.findUnique({ where: { category_id: created.category_id } }))!.is_fixed).toBe(true);
      await CategoryService.updateCategory(ctx.uid, created.category_id, { is_fixed: false });
      expect((await prisma.categories.findUnique({ where: { category_id: created.category_id } }))!.is_fixed).toBe(false);
      await CategoryService.updateCategory(ctx.uid, created.category_id, { name: 'Rent2' });
      expect((await prisma.categories.findUnique({ where: { category_id: created.category_id } }))!.is_fixed).toBe(false);
    });

    test('defaults to false', async () => {
      expect(ctx.food.category_id).toBeDefined();
      expect((await prisma.categories.findUnique({ where: { category_id: ctx.food.category_id } }))!.is_fixed).toBe(false);
    });
  });

  describe('backup', () => {
    test('restoring an old backup without is_fixed gives false', async () => {
      const fresh = await UserService.createUser({ username: 'fresh', password: '123', email: 'f@afaneca.com' });
      // @ts-ignore
      await BackupManager.restoreBackup(fresh.user_id, userBackupMock);
      const cats = await prisma.categories.findMany({ where: { users_user_id: fresh.user_id } });
      expect(cats.length).toBeGreaterThan(0);
      expect(cats.every((c) => c.is_fixed === false)).toBe(true);
    });

    test('is_fixed survives backup and restore', async () => {
      const backup = await BackupManager.createBackup(ctx.uid);
      expect(backup.categories!.find((c) => c.name === 'Family')!.is_fixed).toBe(true);
      const other = await UserService.createUser({ username: 'other', password: '123', email: 'o@afaneca.com' });
      await BackupManager.restoreBackup(other.user_id, JSON.parse(JSON.stringify(backup, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))));
      const family = await prisma.categories.findFirst({ where: { users_user_id: other.user_id, name: 'Family' } });
      expect(family!.is_fixed).toBe(true);
    });
  });
});
