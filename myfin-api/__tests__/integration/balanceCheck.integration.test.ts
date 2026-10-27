import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import TransactionService from '../../src/services/transactionService.js';
import AccountService from '../../src/services/accountService.js';
import BackupManager from '../../src/utils/backupManager.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { monthRangeIST } from '../../src/services/insights/insightsPrimitives.js';
import { getMonthInsights } from '../../src/services/insights/insightsService.js';
import BalanceCheckService from '../../src/services/balanceCheckService.js';
import DateTimeUtils from '../../src/utils/DateTimeUtils.js';

/** Creates the account at 0 and moves it to `balance` with a plain transaction, so snapshots stay consistent. */
const mkAccount = async (uid: bigint, name: string, type: string, balance: number) => {
  const account = await AccountService.createAccount(
    {
      name,
      type,
      description: '',
      status: MYFIN.ACCOUNT_STATUS.ACTIVE,
      exclude_from_budgets: false,
      current_balance: 0,
      users_user_id: uid,
    },
    uid
  );
  if (balance !== 0) {
    await TransactionService.createTransaction(uid, {
      amount: Math.abs(balance),
      type: balance > 0 ? 'I' : 'E',
      description: 'Opening',
      account_to_id: balance > 0 ? account.account_id : undefined,
      account_from_id: balance < 0 ? account.account_id : undefined,
      date_timestamp: DateTimeUtils.getCurrentUnixTimestamp() - 30 * 86400,
      is_essential: false,
    });
  }
  return account;
};

const balanceOf = async (accountId: bigint) =>
  Number((await prisma.accounts.findUniqueOrThrow({ where: { account_id: accountId } })).current_balance);

describe('Balance check', () => {
  let uid: bigint;
  beforeEach(async () => {
    const user = await UserService.createUser({ username: 'demo', password: '123', email: 'demo@afaneca.com' });
    uid = user.user_id;
  });

  test('bank account matching the real balance is matched', async () => {
    const bank = await mkAccount(uid, 'Bank', MYFIN.ACCOUNT_TYPES.CHECKING, 1000);
    const res = await BalanceCheckService.recordCheck(uid, bank.account_id, 1000);
    expect(res).toEqual({ gap: 0, result: 'matched' });
    const list = await BalanceCheckService.listForBalanceCheck(uid);
    expect(list[0]).toMatchObject({ name: 'Bank', myfin_balance: 1000 });
    expect(list[0].last_check).toMatchObject({ result: 'matched', gap: 0 });
  });

  test('bank mismatch: open, then write-off creates an expense adjustment', async () => {
    const bank = await mkAccount(uid, 'Bank', MYFIN.ACCOUNT_TYPES.CHECKING, 1000);
    const res = await BalanceCheckService.recordCheck(uid, bank.account_id, 900);
    expect(res).toEqual({ gap: -100, result: 'open' });

    const trxId = await BalanceCheckService.writeOff(uid, bank.account_id, 900);
    expect(await balanceOf(bank.account_id)).toBe(90000);
    const trx = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: trxId } });
    expect(trx).toMatchObject({
      type: 'E',
      amount: 10000n,
      is_adjustment: true,
      description: 'Reconciliation write-off',
      accounts_account_from_id: bank.account_id,
    });
    const cat = await prisma.categories.findFirst({ where: { users_user_id: uid, name: 'Balance adjustment' } });
    expect(cat).toMatchObject({ type: 'M' });
    expect(trx.categories_category_id).toBe(cat?.category_id);
    const check = await prisma.balance_checks.findFirstOrThrow({ where: { accounts_account_id: bank.account_id }, orderBy: { check_id: 'desc' } });
    expect(check).toMatchObject({ result: 'adjusted', adjustment_transaction_id: trxId });

    // A second write-off reuses the category, and zero gap is rejected
    await expect(BalanceCheckService.writeOff(uid, bank.account_id, 900)).rejects.toMatchObject({ code: 400 });
    expect(await prisma.categories.count({ where: { users_user_id: uid, name: 'Balance adjustment' } })).toBe(1);
  });

  test('real balance above MyFin creates an income adjustment', async () => {
    const bank = await mkAccount(uid, 'Bank', MYFIN.ACCOUNT_TYPES.CHECKING, 1000);
    await BalanceCheckService.writeOff(uid, bank.account_id, 1050);
    expect(await balanceOf(bank.account_id)).toBe(105000);
    const trx = await prisma.transactions.findFirstOrThrow({ where: { is_adjustment: true } });
    expect(trx).toMatchObject({ type: 'I', amount: 5000n, accounts_account_to_id: bank.account_id });
  });

  test('credit card: owed 13,231 vs real 13,000 writes off with an income of 231', async () => {
    const card = await mkAccount(uid, 'Card', MYFIN.ACCOUNT_TYPES.CREDIT, -13231);
    const res = await BalanceCheckService.recordCheck(uid, card.account_id, 13000);
    expect(res.result).toBe('open');
    expect(res.gap).toBe(-231);
    await BalanceCheckService.writeOff(uid, card.account_id, 13000);
    expect(-(await balanceOf(card.account_id))).toBe(1300000);
    const trx = await prisma.transactions.findFirstOrThrow({ where: { is_adjustment: true } });
    expect(trx).toMatchObject({ type: 'I', amount: 23100n, accounts_account_to_id: card.account_id });
  });

  test('adjustments are excluded from insights spending and income', async () => {
    const bank = await mkAccount(uid, 'Bank', MYFIN.ACCOUNT_TYPES.CHECKING, 1000);
    await BalanceCheckService.writeOff(uid, bank.account_id, 900);
    await BalanceCheckService.writeOff(uid, bank.account_id, 1200);
    const now = new Date(DateTimeUtils.getCurrentUnixTimestamp() * 1000 + 5.5 * 3600_000);
    const ym = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
    expect(monthRangeIST(ym).from).toBeLessThanOrEqual(DateTimeUtils.getCurrentUnixTimestamp());
    const insights = await getMonthInsights(uid, ym);
    expect(JSON.stringify(insights)).not.toContain('Reconciliation');
    expect(insights.summary.spending).toBe(0);
    expect(insights.summary.income).toBe(0);
  });

  test("another user's account gives 401 on every call", async () => {
    const other = await UserService.createUser({ username: 'other', password: '123', email: 'o@afaneca.com' });
    const theirs = await mkAccount(other.user_id, 'Theirs', MYFIN.ACCOUNT_TYPES.CHECKING, 100);
    await expect(BalanceCheckService.recordCheck(uid, theirs.account_id, 100)).rejects.toMatchObject({ code: 401 });
    await expect(BalanceCheckService.writeOff(uid, theirs.account_id, 50)).rejects.toMatchObject({ code: 401 });
    expect((await BalanceCheckService.listForBalanceCheck(uid)).length).toBe(0);
  });

  test('balance_checks survive backup and restore with remapped account ids', async () => {
    const bank = await mkAccount(uid, 'Bank', MYFIN.ACCOUNT_TYPES.CHECKING, 1000);
    await BalanceCheckService.recordCheck(uid, bank.account_id, 900);
    await BalanceCheckService.writeOff(uid, bank.account_id, 900);
    const backup = await BackupManager.createBackup(uid);
    expect(backup.balance_checks?.length).toBe(2);

    const other = await UserService.createUser({ username: 'other', password: '123', email: 'o@afaneca.com' });
    await BackupManager.restoreBackup(
      other.user_id,
      JSON.parse(JSON.stringify(backup, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)))
    );
    const newBank = await prisma.accounts.findFirstOrThrow({ where: { users_user_id: other.user_id, name: 'Bank' } });
    const checks = await prisma.balance_checks.findMany({ where: { accounts_account_id: newBank.account_id } });
    expect(checks.length).toBe(2);
    expect(checks.every((c) => c.adjustment_transaction_id === null)).toBe(true);
    expect(checks.map((c) => c.result).sort()).toEqual(['adjusted', 'open']);
    // restored adjustment keeps its flag
    expect(await prisma.transactions.count({ where: { accounts_account_from_id: newBank.account_id, is_adjustment: true } })).toBe(1);
  });
});
