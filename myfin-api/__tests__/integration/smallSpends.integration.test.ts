import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService from '../../src/services/transactionService.js';
import BackupManager from '../../src/utils/backupManager.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import { salaryRuleFor } from '../../src/services/insights/analyticsRules.js';
import { smallSpends } from '../../src/services/insights/smallSpendService.js';
import {
  getFinancialProfile,
  updateFinancialProfile,
} from '../../src/services/financialProfileService.js';
import { toTransactionFilter } from '../../src/controllers/transactionController.js';
import { financialProfileSchema } from '../../src/controllers/financialProfileController.js';
import userBackupMock from './mock/user-backup.mock.json';

const DAY = 86_400;
const JUL: YearMonth = { year: 2026, month: 7 };
const AUG: YearMonth = { year: 2026, month: 8 };
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const E = MYFIN.TRX_TYPES.EXPENSE;
const T = MYFIN.TRX_TYPES.TRANSFER;

async function seed() {
  const user = await UserService.createUser({ username: 'demo', password: '123', email: 'demo@afaneca.com' });
  const uid = user.user_id;
  const mk = (name: string) =>
    AccountService.createAccount(
      {
        name,
        type: MYFIN.ACCOUNT_TYPES.CHECKING,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: uid,
      },
      uid
    );
  const bank = await mk('Bank');
  const other = await mk('Other');
  const from = bank.account_id;
  const add = (t: { type?: string; amount: number; date: number; description: string; to?: bigint }) =>
    TransactionService.createTransaction(uid, {
      account_from_id: from,
      account_to_id: t.to ?? null,
      amount: t.amount,
      category_id: null,
      date_timestamp: t.date,
      description: t.description,
      entity_id: null,
      is_essential: false,
      tags: [],
      type: t.type ?? E,
    });
  for (const ym of [JUL, AUG, SEP]) {
    const r = monthRangeIST(ym);
    await add({ amount: 100, date: r.from + DAY, description: 'Paid to TEA STALL' });
    await add({ amount: 100, date: r.from + 2 * DAY, description: 'Paid to AUTO' });
  }
  const oct = monthRangeIST(OCT);
  for (let i = 0; i < 5; i++) await add({ amount: 20, date: oct.from + (i + 1) * DAY, description: 'Paid to TEA STALL' });
  for (let i = 0; i < 3; i++) await add({ amount: 150, date: oct.from + (i + 8) * DAY, description: 'Paid to AUTO' });
  await add({ amount: 199.99, date: oct.from + 12 * DAY, description: 'SNACKS' });
  await add({ amount: 200, date: oct.from + 13 * DAY, description: 'Paid to EXACT' });
  await add({ amount: 5000, date: oct.from + 14 * DAY, description: 'Paid to BIG' });
  await add({ type: T, to: other.account_id, amount: 50, date: oct.from + 15 * DAY, description: 'Move' });
  await prisma.transactions.create({
    data: {
      type: E,
      amount: 3000n,
      date_timestamp: oct.from + 16 * DAY,
      description: 'Adjust',
      is_adjustment: true,
      accounts_account_from_id: from,
      is_essential: false,
    },
  });
  return { uid };
}

const drill = async (uid: bigint, filter: ReturnType<typeof toTransactionFilter>) => {
  const { query: _q, ...options } = filter as never;
  const result = await TransactionService.getFilteredTransactionsByForUser(uid, 0, 1000, '', {
    ...(options as object),
    type: E,
    salaryRule: await salaryRuleFor(uid),
  });
  const rows = result.results as Array<{ amount: unknown }>;
  return { n: rows.length, sum: Math.round(rows.reduce((s, r) => s + Number(r.amount) * 100, 0)) / 100 };
};

describe('Small spends', () => {
  let uid: bigint;
  beforeEach(async () => {
    ({ uid } = await seed());
  });

  test('headline, places and typical at the default cut-off', async () => {
    const r = await smallSpends(uid, OCT);
    expect(r.month).toBe('2026-10');
    expect(r.cutoff).toBe(200);
    expect(r.count).toBe(9);
    expect(r.total).toBeCloseTo(749.99, 2);
    expect(r.places[0]).toMatchObject({ payee_key: 'AUTO', name: 'AUTO', total: 450, count: 3, average: 150 });
    // Places rank by total: SNACKS (199.99) outranks TEA STALL (100, x5).
    expect(r.places[1]).toMatchObject({ payee_key: 'SNACKS', total: 199.99, count: 1 });
    expect(r.places[2]).toMatchObject({ payee_key: 'TEA STALL', total: 100, count: 5, average: 20 });
    expect(r.typical_total).toBe(200);
    expect(r.typical_count).toBe(2);
  });

  test('trend has 12 entries and October equals the headline', async () => {
    const r = await smallSpends(uid, OCT);
    expect(r.trend).toHaveLength(12);
    expect(r.trend[11]).toMatchObject({ year: 2026, month: 10, count: 9 });
    expect(r.trend[11].total).toBeCloseTo(r.total, 2);
    expect(r.trend[0]).toMatchObject({ count: 0, total: 0 });
  });

  test('drill-down matches the headline, a place, and the bulk filter', async () => {
    const f = toTransactionFilter({ effective_month: '2026-10', type: E, amount_lt: 20000 });
    expect(await drill(uid, f)).toEqual({ n: 9, sum: 749.99 });
    const p = toTransactionFilter({ effective_month: '2026-10', type: E, amount_lt: 20000, payee_key: 'AUTO' });
    expect(await drill(uid, p)).toEqual({ n: 3, sum: 450 });
    const ids = await prisma.transactions.count({ where: { description: 'SNACKS' } });
    expect(ids).toBe(1);
    const changed = await TransactionService.bulkUpdateTransactions(uid, { filter: { type: E, ...f } as never }, { is_essential: true });
    expect(changed).toBe(9);
  });

  test('changing the cut-off changes the figures', async () => {
    await updateFinancialProfile(uid, { small_spend_cutoff: 100 });
    const r = await smallSpends(uid, OCT);
    expect(r.cutoff).toBe(100);
    expect(r.count).toBe(5);
    expect(r.total).toBe(100);
  });

  test('profile validates the cut-off', async () => {
    expect((await getFinancialProfile(uid)).small_spend_cutoff).toBe(200);
    await expect(updateFinancialProfile(uid, { small_spend_cutoff: 0 })).rejects.toThrow();
    await expect(updateFinancialProfile(uid, { small_spend_cutoff: 100001 })).rejects.toThrow();
    await expect(updateFinancialProfile(uid, { small_spend_cutoff: 0.004 })).rejects.toThrow();
    expect(financialProfileSchema.validate({ small_spend_cutoff: 0.004 }).error).toBeTruthy();
    expect(financialProfileSchema.validate({ small_spend_cutoff: 0.01 }).error).toBeUndefined();
    await updateFinancialProfile(uid, { small_spend_cutoff: 100000 });
    expect((await getFinancialProfile(uid)).small_spend_cutoff).toBe(100000);
  });

  test('new user gets zeros', async () => {
    const u = await UserService.createUser({ username: 'new', password: '123', email: 'n@afaneca.com' });
    const r = await smallSpends(u.user_id, OCT);
    expect(r).toMatchObject({ count: 0, total: 0, places: [], typical_total: null, typical_count: null });
    expect(r.trend).toHaveLength(12);
  });

  test('empty description groups under (no description)', async () => {
    const bank = await prisma.accounts.findFirstOrThrow({ where: { users_user_id: uid, name: 'Bank' } });
    await TransactionService.createTransaction(uid, {
      account_from_id: bank.account_id, account_to_id: null, amount: 10, category_id: null,
      date_timestamp: monthRangeIST(OCT).from + 20 * DAY, description: '', entity_id: null,
      is_essential: false, tags: [], type: E,
    });
    const r = await smallSpends(uid, OCT);
    expect(r.count).toBe(10);
    expect(r.places.find((p) => p.payee_key === '')).toMatchObject({ name: '(no description)', count: 1, total: 10 });
  });

  test('backup round trip keeps the cut-off; old backups give 200', async () => {
    await updateFinancialProfile(uid, { small_spend_cutoff: 350 });
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(uid), (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
    expect(backup.financial_profile.small_spend_cutoff).toBe(35000);
    const other = await UserService.createUser({ username: 'o', password: '123', email: 'o@afaneca.com' });
    await UserService.restoreUser(other.user_id, backup);
    expect((await getFinancialProfile(other.user_id)).small_spend_cutoff).toBe(350);

    delete backup.financial_profile.small_spend_cutoff;
    const old = await UserService.createUser({ username: 'old', password: '123', email: 'old@afaneca.com' });
    await UserService.restoreUser(old.user_id, backup);
    expect((await getFinancialProfile(old.user_id)).small_spend_cutoff).toBe(200);
    void userBackupMock;
  });
});
