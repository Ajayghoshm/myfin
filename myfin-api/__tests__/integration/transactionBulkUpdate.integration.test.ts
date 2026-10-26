import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService from '../../src/services/transactionService.js';
import EntityService from '../../src/services/entityService.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';

describe('Bulk update of transactions', () => {
  let user: { user_id: bigint };
  let otherUser: { user_id: bigint };
  let bank: { account_id: bigint };
  let food: { category_id: bigint };
  let otherUsersCategory: { category_id: bigint };
  let swiggy: { entity_id: bigint };
  let swiggy1: { transaction_id: bigint };
  let swiggy2: { transaction_id: bigint };
  let salary: { transaction_id: bigint };
  let otherUsersTrx: { transaction_id: bigint };

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

  const createCategory = (owner: { user_id: bigint }, name: string) =>
    prisma.categories.create({
      data: { name, type: MYFIN.TRX_TYPES.EXPENSE, users_user_id: owner.user_id },
    });

  const addTrx = (
    owner: { user_id: bigint },
    accountId: bigint,
    description: string,
    amount: number,
    type: string,
    date: number
  ) =>
    TransactionService.createTransaction(owner.user_id, {
      account_from_id: type === MYFIN.TRX_TYPES.INCOME ? null : accountId,
      account_to_id: type === MYFIN.TRX_TYPES.INCOME ? accountId : null,
      amount,
      category_id: null,
      date_timestamp: date,
      description,
      entity_id: null,
      is_essential: false,
      tags: [],
      type,
    });

  const load = (trx: { transaction_id: bigint }) =>
    prisma.transactions.findUniqueOrThrow({ where: { transaction_id: trx.transaction_id } });

  beforeEach(async () => {
    user = await UserService.createUser({ username: 'demo', password: '123', email: 'demo@afaneca.com' });
    otherUser = await UserService.createUser({ username: 'other', password: '123', email: 'other@afaneca.com' });
    bank = await createAccount(user, 'bank');
    const otherBank = await createAccount(otherUser, 'other bank');
    food = await createCategory(user, 'Food');
    otherUsersCategory = await createCategory(otherUser, 'Other food');
    swiggy = await EntityService.createEntity({ name: 'Swiggy', users_user_id: user.user_id });
    swiggy1 = await addTrx(user, bank.account_id, 'Paid to SWIGGY', 121, MYFIN.TRX_TYPES.EXPENSE, 1_700_000_000);
    swiggy2 = await addTrx(user, bank.account_id, 'Paid to Swiggy Ltd', 218, MYFIN.TRX_TYPES.EXPENSE, 1_700_100_000);
    salary = await addTrx(user, bank.account_id, 'Salary from SWIGGY', 5000, MYFIN.TRX_TYPES.INCOME, 1_700_200_000);
    otherUsersTrx = await addTrx(otherUser, otherBank.account_id, 'Paid to SWIGGY', 50, MYFIN.TRX_TYPES.EXPENSE, 1_700_000_000);
  });

  test('updates category, entity and essential for the selected ids only', async () => {
    const before = await load(swiggy1);
    const balanceBefore = (await prisma.accounts.findUniqueOrThrow({ where: { account_id: bank.account_id } }))
      .current_balance;

    const updated = await TransactionService.bulkUpdateTransactions(
      user.user_id,
      { transaction_ids: [swiggy1.transaction_id, swiggy2.transaction_id] },
      { category_id: food.category_id, entity_id: swiggy.entity_id, is_essential: true }
    );

    expect(updated).toBe(2);
    for (const trx of [swiggy1, swiggy2]) {
      const after = await load(trx);
      expect(after.categories_category_id).toBe(food.category_id);
      expect(after.entities_entity_id).toBe(swiggy.entity_id);
      expect(after.is_essential).toBe(true);
    }
    const after1 = await load(swiggy1);
    expect(after1.amount).toBe(before.amount);
    expect(after1.date_timestamp).toBe(before.date_timestamp);
    expect(after1.description).toBe(before.description);
    expect(after1.accounts_account_from_id).toBe(before.accounts_account_from_id);
    expect((await load(salary)).categories_category_id).toBeNull();
    const balanceAfter = (await prisma.accounts.findUniqueOrThrow({ where: { account_id: bank.account_id } }))
      .current_balance;
    expect(balanceAfter).toBe(balanceBefore);
  });

  test('fields that are not given stay unchanged, and null clears a field', async () => {
    await TransactionService.bulkUpdateTransactions(
      user.user_id,
      { transaction_ids: [swiggy1.transaction_id] },
      { category_id: food.category_id, entity_id: swiggy.entity_id }
    );

    await TransactionService.bulkUpdateTransactions(
      user.user_id,
      { transaction_ids: [swiggy1.transaction_id] },
      { category_id: null }
    );

    const after = await load(swiggy1);
    expect(after.categories_category_id).toBeNull();
    expect(after.entities_entity_id).toBe(swiggy.entity_id);
    expect(after.is_essential).toBe(false);
  });

  test('a filter selection updates every matching transaction of the user, across pages', async () => {
    const updated = await TransactionService.bulkUpdateTransactions(
      user.user_id,
      { filter: { query: 'swiggy', type: MYFIN.TRX_TYPES.EXPENSE } },
      { category_id: food.category_id }
    );

    expect(updated).toBe(2);
    expect((await load(swiggy1)).categories_category_id).toBe(food.category_id);
    expect((await load(swiggy2)).categories_category_id).toBe(food.category_id);
    expect((await load(salary)).categories_category_id).toBeNull();
    expect((await load(otherUsersTrx)).categories_category_id).toBeNull();
  });

  test("another user's transaction id is rejected and nothing is updated", async () => {
    await expect(
      TransactionService.bulkUpdateTransactions(
        user.user_id,
        { transaction_ids: [swiggy1.transaction_id, otherUsersTrx.transaction_id] },
        { category_id: food.category_id }
      )
    ).rejects.toMatchObject({ code: 401 });

    expect((await load(swiggy1)).categories_category_id).toBeNull();
    expect((await load(otherUsersTrx)).categories_category_id).toBeNull();
  });

  test("another user's category is rejected and nothing is updated", async () => {
    await expect(
      TransactionService.bulkUpdateTransactions(
        user.user_id,
        { transaction_ids: [swiggy1.transaction_id] },
        { category_id: otherUsersCategory.category_id }
      )
    ).rejects.toMatchObject({ code: 401 });

    expect((await load(swiggy1)).categories_category_id).toBeNull();
  });

  test('a request with no changes is rejected', async () => {
    await expect(
      TransactionService.bulkUpdateTransactions(user.user_id, { transaction_ids: [swiggy1.transaction_id] }, {})
    ).rejects.toMatchObject({ code: 400 });
  });

  test('an empty selection is rejected', async () => {
    await expect(
      TransactionService.bulkUpdateTransactions(user.user_id, { transaction_ids: [] }, { is_essential: true })
    ).rejects.toMatchObject({ code: 400 });
  });
});
