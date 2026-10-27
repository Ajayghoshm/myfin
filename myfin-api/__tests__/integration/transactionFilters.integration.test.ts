import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService from '../../src/services/transactionService.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { monthRangeIST } from '../../src/services/insights/insightsPrimitives.js';

describe('Structured transaction filters', () => {
  let user: { user_id: bigint };
  let bank: { account_id: bigint };
  let card: { account_id: bigint };
  let otherBank: { account_id: bigint };
  let food: { category_id: bigint };

  const oct = monthRangeIST({ year: 2026, month: 10 });
  const nov = monthRangeIST({ year: 2026, month: 11 });

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

  const addExpense = (
    owner: { user_id: bigint },
    accountId: bigint,
    description: string,
    amount: number,
    date: number,
    categoryId: bigint | null = null
  ) =>
    TransactionService.createTransaction(owner.user_id, {
      account_from_id: accountId,
      account_to_id: null,
      amount,
      category_id: categoryId,
      date_timestamp: date,
      description,
      entity_id: null,
      is_essential: false,
      tags: [],
      type: MYFIN.TRX_TYPES.EXPENSE,
    });

  const list = (options: Parameters<typeof TransactionService.getFilteredTransactionsByForUser>[4]) =>
    TransactionService.getFilteredTransactionsByForUser(user.user_id, 0, 50, '', options);

  const amounts = (result: { results: unknown }) =>
    (result.results as Array<{ amount: unknown }>).map((t) => Number(t.amount)).sort((a, b) => a - b);

  beforeEach(async () => {
    user = await UserService.createUser({ username: 'demo', password: '123', email: 'demo@afaneca.com' });
    const otherUser = await UserService.createUser({
      username: 'other',
      password: '123',
      email: 'other@afaneca.com',
    });
    bank = await createAccount(user, 'bank');
    card = await createAccount(user, 'card');
    otherBank = await createAccount(otherUser, 'other bank');
    food = await prisma.categories.create({
      data: { name: 'Food', type: MYFIN.TRX_TYPES.EXPENSE, users_user_id: user.user_id },
    });

    const day = 86_400;
    await addExpense(user, bank.account_id, 'Paid to SWIGGY', 121, oct.from + 4 * day, food.category_id);
    await addExpense(user, bank.account_id, 'Paid to Swiggy  ', 200, oct.from + 19 * day);
    // 2026-09-30 23:50 IST and 2026-11-01 00:30 IST
    await addExpense(user, bank.account_id, 'Paid to VEG BASKET', 28, oct.from - 10 * 60);
    await addExpense(user, card.account_id, 'Paid to VEG BASKET', 30, nov.from + 30 * 60);
    await addExpense(otherUser, otherBank.account_id, 'Paid to SWIGGY', 99, oct.from + day);
  });

  test('payee key matches normalised descriptions', async () => {
    const result = await list({ payeeKey: 'SWIGGY' });
    expect(amounts(result)).toEqual([121, 200]);
    expect(Number(result.filtered_count)).toBe(2);
  });

  test("category 'none' within a month returns only uncategorised rows", async () => {
    const result = await list({ categoryId: 'none', dateFrom: oct.from, dateTo: oct.to });
    expect(amounts(result)).toEqual([200]);
  });

  test('category id filters to that category', async () => {
    const result = await list({ categoryId: food.category_id });
    expect(amounts(result)).toEqual([121]);
  });

  test('IST month range excludes rows just outside it', async () => {
    const result = await list({ dateFrom: oct.from, dateTo: oct.to });
    expect(amounts(result)).toEqual([121, 200]);
    expect(Number(result.filtered_count)).toBe(2);
    expect(Number(result.total_count)).toBe(4);
  });

  test('November range includes the 00:30 IST row', async () => {
    const result = await list({ dateFrom: nov.from, dateTo: nov.to });
    expect(amounts(result)).toEqual([30]);
  });

  test('account filter returns only that account', async () => {
    const result = await list({ accountId: card.account_id });
    expect(amounts(result)).toEqual([30]);
  });

  test("another user's account yields nothing", async () => {
    const result = await list({ accountId: otherBank.account_id });
    expect(amounts(result)).toEqual([]);
    expect(Number(result.filtered_count)).toBe(0);
  });

  test('filters AND-combine with search and type', async () => {
    const result = await TransactionService.getFilteredTransactionsByForUser(user.user_id, 0, 50, 'veg', {
      type: MYFIN.TRX_TYPES.EXPENSE,
      accountId: bank.account_id,
    });
    expect(amounts(result)).toEqual([28]);
    const income = await list({ type: MYFIN.TRX_TYPES.INCOME, payeeKey: 'SWIGGY' });
    expect(amounts(income)).toEqual([]);
  });

  test('bulk update by payee key filter updates exactly the matching rows', async () => {
    const updated = await TransactionService.bulkUpdateTransactions(
      user.user_id,
      { filter: { payeeKey: 'SWIGGY' } },
      { is_essential: true }
    );
    expect(updated).toBe(2);
    const essentials = await prisma.transactions.count({ where: { is_essential: true } });
    expect(essentials).toBe(2);
  });

  test('effective month without a salary rule equals the plain IST range', async () => {
    const rule = { salaryCategoryId: null, cutoffDay: 25 };
    const result = await list({ effectiveMonth: { year: 2026, month: 11 }, salaryRule: rule });
    expect(amounts(result)).toEqual([30]);
    expect(amounts(await list({ effectiveMonth: { year: 2026, month: 10 }, salaryRule: rule }))).toEqual([
      121, 200,
    ]);
  });

  test('bulk update by effective month matches the list', async () => {
    const rule = { salaryCategoryId: null, cutoffDay: 25 };
    const updated = await TransactionService.bulkUpdateTransactions(
      user.user_id,
      { filter: { effectiveMonth: { year: 2026, month: 10 }, salaryRule: rule } },
      { is_essential: true }
    );
    expect(updated).toBe(2);
  });
});
