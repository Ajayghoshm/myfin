import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService from '../../src/services/transactionService.js';
import { MYFIN } from '../../src/consts.js';

describe('Filtered transactions sorting and type filter', () => {
  let user: { user_id: bigint };
  let bank: { account_id: bigint };
  let wallet: { account_id: bigint };

  const createAccount = (name: string) =>
    AccountService.createAccount(
      {
        name,
        type: MYFIN.ACCOUNT_TYPES.CHECKING,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: user.user_id,
      },
      user.user_id
    );

  const addTrx = (description: string, amount: number, type: string, date: number) =>
    TransactionService.createTransaction(user.user_id, {
      account_from_id: type === MYFIN.TRX_TYPES.INCOME ? null : bank.account_id,
      account_to_id:
        type === MYFIN.TRX_TYPES.EXPENSE
          ? null
          : type === MYFIN.TRX_TYPES.TRANSFER
            ? wallet.account_id
            : bank.account_id,
      amount,
      category_id: null,
      date_timestamp: date,
      description,
      entity_id: null,
      is_essential: false,
      tags: [],
      type,
    });

  const descriptions = (result: { results: unknown }) =>
    (result.results as Array<{ description: string }>).map((t) => t.description);

  beforeEach(async () => {
    user = await UserService.createUser({ username: 'demo', password: '123', email: 'demo@afaneca.com' });
    bank = await createAccount('bank');
    wallet = await createAccount('wallet');
    // dates increase in creation order
    await addTrx('small expense', 10, MYFIN.TRX_TYPES.EXPENSE, 1_700_000_000);
    await addTrx('big income', 500, MYFIN.TRX_TYPES.INCOME, 1_700_100_000);
    await addTrx('big expense', 300, MYFIN.TRX_TYPES.EXPENSE, 1_700_200_000);
    await addTrx('transfer', 50, MYFIN.TRX_TYPES.TRANSFER, 1_700_300_000);
    await addTrx('same amount newer', 10, MYFIN.TRX_TYPES.EXPENSE, 1_700_400_000);
  });

  test('default order stays newest first', async () => {
    const result = await TransactionService.getFilteredTransactionsByForUser(user.user_id, 0, 50, '');
    expect(descriptions(result)).toEqual([
      'same amount newer',
      'transfer',
      'big expense',
      'big income',
      'small expense',
    ]);
  });

  test('sort by amount descending, ties newest first', async () => {
    const result = await TransactionService.getFilteredTransactionsByForUser(user.user_id, 0, 50, '', {
      sortBy: 'amount',
      sortDir: 'desc',
    });
    expect(descriptions(result)).toEqual([
      'big income',
      'big expense',
      'transfer',
      'same amount newer',
      'small expense',
    ]);
  });

  test('sort by amount ascending, ties newest first', async () => {
    const result = await TransactionService.getFilteredTransactionsByForUser(user.user_id, 0, 50, '', {
      sortBy: 'amount',
      sortDir: 'asc',
    });
    expect(descriptions(result)).toEqual([
      'same amount newer',
      'small expense',
      'transfer',
      'big expense',
      'big income',
    ]);
  });

  test('sort by type groups types, newest first within a group', async () => {
    const result = await TransactionService.getFilteredTransactionsByForUser(user.user_id, 0, 50, '', {
      sortBy: 'type',
      sortDir: 'asc',
    });
    expect(descriptions(result)).toEqual([
      'same amount newer',
      'big expense',
      'small expense',
      'big income',
      'transfer',
    ]);
  });

  test('type filter keeps only that type and counts only filtered rows', async () => {
    const result = await TransactionService.getFilteredTransactionsByForUser(user.user_id, 0, 50, '', {
      type: MYFIN.TRX_TYPES.EXPENSE,
      sortBy: 'amount',
      sortDir: 'desc',
    });
    expect(descriptions(result)).toEqual(['big expense', 'same amount newer', 'small expense']);
    expect(Number(result.filtered_count)).toBe(3);
    expect(Number(result.total_count)).toBe(5);
  });

  test('sort applies across pages', async () => {
    const page0 = await TransactionService.getFilteredTransactionsByForUser(user.user_id, 0, 2, '', {
      sortBy: 'amount',
      sortDir: 'desc',
    });
    const page1 = await TransactionService.getFilteredTransactionsByForUser(user.user_id, 1, 2, '', {
      sortBy: 'amount',
      sortDir: 'desc',
    });
    expect(descriptions(page0)).toEqual(['big income', 'big expense']);
    expect(descriptions(page1)).toEqual(['transfer', 'same amount newer']);
  });
});
