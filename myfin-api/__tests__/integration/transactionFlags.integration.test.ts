import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import { createEvent } from '../../src/services/routines/eventService.js';
import { applyFlags } from '../../src/services/transactionFlagService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';

const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
// 2026-06-10 12:00 IST
const JUNE_10 = Date.UTC(2026, 5, 10, 6, 30) / 1000;

describe('transaction flags', () => {
  let userId: bigint;
  let bankId: bigint;

  const makeUser = async (username: string) => {
    const user = await UserService.createUser({ username, password: '123', email: `${username}@myfin.test` });
    const bank = await AccountService.createAccount(
      {
        name: 'Bank',
        type: MYFIN.ACCOUNT_TYPES.CHECKING,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: user.user_id,
      } as never,
      user.user_id
    );
    return { userId: user.user_id, bankId: bank.account_id };
  };
  const add = async (owner: bigint, bank: bigint, type: string, description: string, amount = 50, date = JUNE_10) => {
    await TransactionService.createTransaction(owner, {
      account_from_id: type === E ? bank : undefined,
      account_to_id: type === I ? bank : undefined,
      amount,
      type,
      description,
      date_timestamp: date,
      is_essential: false,
    } as never);
    return (await prisma.transactions.findFirstOrThrow({ orderBy: { transaction_id: 'desc' } })).transaction_id;
  };

  beforeEach(async () => {
    ({ userId, bankId } = await makeUser('flags'));
  });

  test('loan on an expense creates a lent debt linked to the transaction', async () => {
    const id = await add(userId, bankId, E, 'Cash to Ravi');
    const res = await applyFlags(userId, [{ transaction_id: String(id), flags: { loan: { name: 'Ravi' } } }]);
    expect(res).toEqual({ applied: 1, failed: [] });
    const trx = await prisma.transactions.findFirstOrThrow({ where: { transaction_id: id } });
    expect(trx.debt_id).not.toBeNull();
    expect(trx.debt_role).toBe('lend');
    const debt = await prisma.debts.findFirstOrThrow({ where: { debt_id: trx.debt_id! } });
    expect(debt.kind).toBe('lent');
    expect(debt.counterparty_name).toBe('Ravi');
    expect(Number(debt.principal)).toBe(Number(trx.amount));
  });

  test('loan name defaults to the description when none given', async () => {
    const id = await add(userId, bankId, E, '  Cash to Ravi ');
    await applyFlags(userId, [{ transaction_id: String(id), flags: { loan: {} } }]);
    const trx = await prisma.transactions.findFirstOrThrow({ where: { transaction_id: id } });
    const debt = await prisma.debts.findFirstOrThrow({ where: { debt_id: trx.debt_id! } });
    expect(debt.counterparty_name).toBe('Cash to Ravi');
  });

  test('loan on an income creates a borrowed debt', async () => {
    const id = await add(userId, bankId, I, 'From Sita');
    const res = await applyFlags(userId, [{ transaction_id: String(id), flags: { loan: { name: 'Sita' } } }]);
    expect(res.applied).toBe(1);
    const trx = await prisma.transactions.findFirstOrThrow({ where: { transaction_id: id } });
    expect(trx.debt_role).toBe('borrow');
    const debt = await prisma.debts.findFirstOrThrow({ where: { debt_id: trx.debt_id! } });
    expect(debt.kind).toBe('borrowed');
  });

  test('event with event_id links the transaction to the occurrence nearest its date', async () => {
    const id = await add(userId, bankId, E, 'Gift');
    const event = await createEvent(userId, { name: 'Anniversary', kind: 'anniversary', date: '2020-06-01', repeat: 'yearly' });
    const res = await applyFlags(userId, [{ transaction_id: String(id), flags: { event: { event_id: event.event_id } } }]);
    expect(res).toEqual({ applied: 1, failed: [] });
    const link = await prisma.event_occurrence_transactions.findFirstOrThrow({
      where: { transaction_id: id },
      include: { occurrence: true },
    });
    expect(link.occurrence.events_event_id).toBe(BigInt(event.event_id));
    expect(link.occurrence.date).toBe('2026-06-01');
  });

  test('new_event creates an event dated on the transaction day and links it', async () => {
    const id = await add(userId, bankId, E, 'Dinner');
    const res = await applyFlags(userId, [
      { transaction_id: String(id), flags: { event: { new_event: { name: 'Team dinner' } } } },
    ]);
    expect(res.applied).toBe(1);
    const event = await prisma.events.findFirstOrThrow({ where: { users_user_id: userId, name: 'Team dinner' } });
    expect(event.date).toBe('2026-06-10');
    expect(event.repeat).toBe('once');
    expect(event.kind).toBe('other');
    const link = await prisma.event_occurrence_transactions.findFirstOrThrow({
      where: { transaction_id: id },
      include: { occurrence: true },
    });
    expect(link.occurrence.events_event_id).toBe(event.event_id);
  });

  test('a failing item is reported and the others still apply', async () => {
    const first = await add(userId, bankId, E, 'One');
    const second = await add(userId, bankId, E, 'Two');
    const event = await createEvent(userId, { name: 'Trip', kind: 'other', date: '2026-06-10', repeat: 'once' });
    const flags = { event: { event_id: event.event_id } };
    await applyFlags(userId, [{ transaction_id: String(first), flags }]);
    const res = await applyFlags(userId, [
      { transaction_id: String(first), flags },
      { transaction_id: String(second), flags },
    ]);
    expect(res.applied).toBe(1);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]).toMatchObject({ transaction_id: String(first), flag: 'event' });
    expect(await prisma.event_occurrence_transactions.count({ where: { transaction_id: second } })).toBe(1);
  });

  test('a transaction of another user is reported as failed, not changed', async () => {
    const other = await makeUser('flags2');
    const foreign = await add(other.userId, other.bankId, E, 'Theirs');
    const res = await applyFlags(userId, [{ transaction_id: String(foreign), flags: { loan: { name: 'X' } } }]);
    expect(res.applied).toBe(0);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]).toMatchObject({ transaction_id: String(foreign), flag: 'loan' });
    const trx = await prisma.transactions.findFirstOrThrow({ where: { transaction_id: foreign } });
    expect(trx.debt_id).toBeNull();
  });

  test('bulk import returns created_by_index and omits duplicates', async () => {
    const row = (external_id: string, description: string) => ({
      account_from_id: bankId,
      amount: 10,
      type: E,
      description,
      date_timestamp: JUNE_10,
      is_essential: false,
      external_id,
    });
    await TransactionService.createTransactionsInBulk(userId, [row('dup', 'old')] as never);
    const res = await TransactionService.createTransactionsInBulk(userId, [row('dup', 'again'), row('new', 'fresh')] as never);
    expect(res.imported).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.created_by_index).toEqual([{ index: 1, transaction_id: res.created_ids[0] }]);
  });
});
