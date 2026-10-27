import { beforeEach, describe, expect, test } from 'vitest';
import UserService from '../../src/services/userService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService from '../../src/services/transactionService.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import { emergencyFund, emergencyTopupGapCents } from '../../src/services/planning/emergencyFundService.js';

const DAY = 86_400;
const AUG: YearMonth = { year: 2026, month: 8 };
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const NOW = monthRangeIST({ year: 2026, month: 11 }).from + DAY;
const E = MYFIN.TRX_TYPES.EXPENSE;

async function setup() {
  const user = await UserService.createUser({ username: 'demo', password: '123', email: 'demo@afaneca.com' });
  const uid = user.user_id;
  const mkAcc = (name: string, balance: number, ef: boolean, status: string = MYFIN.ACCOUNT_STATUS.ACTIVE) =>
    prisma.accounts.create({
      data: {
        name,
        type: MYFIN.ACCOUNT_TYPES.CHECKING,
        description: '',
        status,
        exclude_from_budgets: false,
        current_balance: Math.round(balance * 100),
        users_user_id: uid,
        is_emergency_fund: ef,
      },
    });
  const bank = await AccountService.createAccount(
    { name: 'Bank', type: MYFIN.ACCOUNT_TYPES.CHECKING, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: uid },
    uid
  );
  const addRent = async () => {
    const rent = await prisma.categories.create({ data: { name: 'Rent', type: E, users_user_id: uid, is_fixed: true } });
    for (const ym of [AUG, SEP, OCT])
      await TransactionService.createTransaction(uid, {
        account_from_id: bank.account_id,
        account_to_id: null,
        amount: 10000,
        category_id: rent.category_id,
        date_timestamp: monthRangeIST(ym).from + 2 * DAY,
        description: 'Paid to LANDLORD',
        entity_id: null,
        is_essential: false,
        tags: [],
        type: E,
      });
  };
  return { uid, mkAcc, addRent };
}

describe('emergency fund meter', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  test('fund, months covered, amber, more needed', async () => {
    await ctx.addRent();
    await ctx.mkAcc('A', 30000, true);
    await ctx.mkAcc('B', 20000, true);
    await ctx.mkAcc('C', -5000, true);
    await ctx.mkAcc('Unticked', 99999, false);
    const r = await emergencyFund(ctx.uid, NOW);
    expect(r).toMatchObject({
      fund: 50000,
      monthly_fixed: 10000,
      months_covered: 5,
      target_months: 6,
      more_needed: 10000,
      status: 'amber',
    });
    expect(r.accounts.map((a) => [a.name, a.balance])).toEqual([['A', 30000], ['B', 20000], ['C', 0]]);
    expect(await emergencyTopupGapCents(ctx.uid, NOW)).toBe(1_000_000);
  });

  test('green at or above target, red below 3', async () => {
    await ctx.addRent();
    await ctx.mkAcc('A', 50000, true);
    await updateFinancialProfile(ctx.uid, { emergency_fund_target_months: 4 });
    const g = await emergencyFund(ctx.uid, NOW);
    expect(g.status).toBe('green');
    expect(g.more_needed).toBe(0);
    expect(await emergencyTopupGapCents(ctx.uid, NOW)).toBe(0);
    await prisma.accounts.updateMany({ where: { users_user_id: ctx.uid, name: 'A' }, data: { current_balance: 2_000_000 } });
    expect((await emergencyFund(ctx.uid, NOW)).status).toBe('red');
  });

  test('no ticked accounts, even with no fixed costs', async () => {
    const r = await emergencyFund(ctx.uid, NOW);
    expect(r).toMatchObject({ status: 'no_accounts', fund: 0, more_needed: 0, accounts: [] });
    await ctx.addRent();
    expect((await emergencyFund(ctx.uid, NOW)).status).toBe('no_accounts');
    expect(await emergencyTopupGapCents(ctx.uid, NOW)).toBe(0);
  });

  test('no fixed categories', async () => {
    await ctx.mkAcc('A', 30000, true);
    const r = await emergencyFund(ctx.uid, NOW);
    expect(r).toMatchObject({ status: 'no_fixed', months_covered: null, monthly_fixed: null, more_needed: 0, fund: 30000 });
    expect(await emergencyTopupGapCents(ctx.uid, NOW)).toBe(0);
  });

  test('inactive ticked account is not counted', async () => {
    await ctx.addRent();
    await ctx.mkAcc('A', 30000, true);
    await ctx.mkAcc('Old', 20000, true, MYFIN.ACCOUNT_STATUS.INACTIVE);
    const r = await emergencyFund(ctx.uid, NOW);
    expect(r.fund).toBe(30000);
    expect(r.accounts).toHaveLength(1);
  });
});
