import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { toTransactionFilter } from '../../src/controllers/transactionController.js';
import AccountService from '../../src/services/accountService.js';
import { addRepayment, createPeopleDebt } from '../../src/services/debts/debtService.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import { createLoan, matchInstallment } from '../../src/services/debts/loanService.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';
import { netWorthAt, netWorthChange } from '../../src/services/wealth/netWorthService.js';

const DAY = 86_400;
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
const T = MYFIN.TRX_TYPES.TRANSFER;
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const at = (ym: YearMonth, day: number) => monthRangeIST(ym).from + (day - 1) * DAY + 3600;
const NOW = at({ year: 2026, month: 11 }, 10);

async function account(uid: bigint, name: string, type: string) {
  return AccountService.createAccount(
    {
      name,
      type,
      description: '',
      status: MYFIN.ACCOUNT_STATUS.ACTIVE,
      exclude_from_budgets: false,
      current_balance: 0,
      users_user_id: uid,
    } as never,
    uid
  );
}

async function trx(
  uid: bigint,
  input: { type: string; amount: number; from?: bigint; to?: bigint; date: number; adjustment?: boolean; description?: string }
) {
  const created = await TransactionService.createTransaction(uid, {
    account_from_id: input.from,
    account_to_id: input.to,
    amount: input.amount,
    type: input.type,
    description: input.description ?? 'x',
    date_timestamp: input.date,
    is_essential: false,
    ...(input.adjustment ? { is_adjustment: true } : {}),
  } as never);
  return created.transaction_id as bigint;
}

async function snapshot(assetId: bigint, ym: YearMonth, valueCents: number, investedCents: number) {
  await prisma.invest_asset_evo_snapshot.create({
    data: {
      month: ym.month,
      year: ym.year,
      units: 1,
      invested_amount: investedCents,
      current_value: valueCents,
      invest_assets_asset_id: assetId,
      created_at: 1,
      updated_at: 1,
      withdrawn_amount: 0,
    },
  });
}

/** The October scenario of the brief (start 85,000 → end 1,16,200). */
async function scenario(username = 'nw') {
  const user = await UserService.createUser({ username, password: '123', email: `${username}@x.com` });
  const uid = user.user_id;
  const bank = await account(uid, 'Bank', MYFIN.ACCOUNT_TYPES.CHECKING);
  const card = await account(uid, 'Card', MYFIN.ACCOUNT_TYPES.CREDIT);
  const broker = await account(uid, 'Broker', MYFIN.ACCOUNT_TYPES.INVESTING);

  // Opening (September)
  await trx(uid, { type: I, amount: 100000, to: bank.account_id, date: at(SEP, 2) });
  await trx(uid, { type: E, amount: 10000, from: card.account_id, date: at(SEP, 3) });
  const loan = await createLoan(
    uid,
    { lender: 'HDFC', principal: 50000, rate: 12, tenure_months: 12, emi: 5000, emi_day: 5, account_id: bank.account_id, start_date: at(SEP, 20) },
    NOW
  );
  const asset = await prisma.invest_assets.create({
    data: { name: 'Index fund', type: 'Fixed Income', units: 1, created_at: 1, users_user_id: uid },
  });
  await snapshot(asset.asset_id, SEP, 4000000, 4000000);
  const lent = await createPeopleDebt(uid, { kind: 'lent', name: 'Ravi', amount: 5000, date: at(SEP, 10) } as never, NOW);

  // October
  await trx(uid, { type: I, amount: 50000, to: bank.account_id, date: at(OCT, 1), description: 'Salary' });
  await trx(uid, { type: E, amount: 20000, from: bank.account_id, date: at(OCT, 3), description: 'Spending' });
  const emi = await trx(uid, { type: E, amount: 5000, from: bank.account_id, date: at(OCT, 5), description: 'EMI' });
  await matchInstallment(uid, BigInt(loan.debt_id), 1, emi, NOW);
  await trx(uid, { type: T, amount: 10000, from: bank.account_id, to: card.account_id, date: at(OCT, 6) });
  await trx(uid, { type: T, amount: 10000, from: bank.account_id, to: broker.account_id, date: at(OCT, 8) });
  await prisma.invest_transactions.create({
    data: {
      date_timestamp: at(OCT, 8),
      type: 'B',
      total_price: 1000000,
      units: 1,
      invest_assets_asset_id: asset.asset_id,
      created_at: 1,
      updated_at: 1,
    },
  });
  await snapshot(asset.asset_id, OCT, 5200000, 5000000);
  await trx(uid, { type: E, amount: 300, from: bank.account_id, date: at(OCT, 20), adjustment: true });
  const repaid = await trx(uid, { type: I, amount: 2000, to: bank.account_id, date: at(OCT, 15), description: 'Ravi' });
  await addRepayment(uid, BigInt(lent.debt_id), { transaction_id: repaid });

  return { uid, bank, card, broker, loan, asset };
}

const listSum = async (uid: bigint, input: Record<string, unknown>) => {
  const rows = (
    await TransactionService.getFilteredTransactionsByForUser(uid, 0, 1000, '', {
      type: input.type as string | undefined,
      ...toTransactionFilter(input as never),
    })
  ).results as Array<{ amount: unknown; type: string }>;
  return Math.round(rows.reduce((s, r) => s + (r.type === E ? -1 : 1) * Number(r.amount), 0) * 100) / 100;
};

describe('#17 net worth change, explained', () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('October: parts sum exactly to the change; debt paid down is informational', async () => {
    const ctx = await scenario();
    const r = await netWorthChange(ctx.uid, OCT, NOW);
    expect(r.month).toBe('2026-10');
    expect(r.start).toBe(85000);
    expect(r.end).toBe(116200);
    expect(r.change).toBe(31200);
    expect(r.parts).toEqual({ saved: 29500, investment_growth: 2000, write_offs: -300, other: 0 });
    expect(r.debt_paid_down).toBe(14500);
    const p = r.parts;
    expect(Math.round((p.saved + p.investment_growth + p.write_offs + p.other) * 100)).toBe(Math.round(r.change * 100));

    const bank = r.accounts.find((a) => a.account_id === String(ctx.bank.account_id));
    const card = r.accounts.find((a) => a.account_id === String(ctx.card.account_id));
    expect(bank).toMatchObject({ start: 100000, end: 106700, change: 6700 });
    expect(card).toMatchObject({ start: -10000, end: 0, change: 10000 });
    expect(r.accounts.find((a) => a.account_id === String(ctx.broker.account_id))).toBeUndefined();
    expect(r.accounts.find((a) => a.account_id === 'investments')).toMatchObject({ start: 40000, end: 52000, change: 12000 });
    // The list reconciles to the change
    expect(Math.round(r.accounts.reduce((s, a) => s + a.change, 0) * 100)).toBe(3120000);

    expect(r.trend).toHaveLength(12);
    expect(r.trend[11]).toEqual({ year: 2026, month: 10, ...r.parts, change: 31200 });
    const sep = r.trend[10];
    expect(sep).toMatchObject({ year: 2026, month: 9, saved: 90000, investment_growth: 40000, write_offs: 0, change: 85000 });
    expect(sep.saved + sep.investment_growth + sep.write_offs + sep.other).toBe(sep.change);
    expect(r.trend[0]).toMatchObject({ year: 2025, month: 11, change: 0 });
  });

  test('the current month ends now, with the same result', async () => {
    const ctx = await scenario('nw2');
    const r = await netWorthChange(ctx.uid, OCT, at(OCT, 27));
    expect(r.change).toBe(31200);
    expect(r.parts).toEqual({ saved: 29500, investment_growth: 2000, write_offs: -300, other: 0 });
  });

  test('netWorthAt: balances, holdings and owed amounts at a time', async () => {
    const ctx = await scenario('nw3');
    const start = await netWorthAt(ctx.uid, monthRangeIST(OCT).from);
    expect(start.totalCents).toBe(8500000);
    expect(start.investCents).toBe(4000000);
    expect(start.owedToYouCents).toBe(500000);
    expect(start.youOweCents).toBe(0);
    expect(start.accounts.map((a) => a.type).sort()).toEqual(['CHEAC', 'CREAC', 'LOANAC']);
    const end = await netWorthAt(ctx.uid, monthRangeIST(OCT).to);
    expect(end.totalCents).toBe(11620000);
  });

  test('drill-downs equal the figures (calendar date range, adjustments list)', async () => {
    const ctx = await scenario('nw4');
    const { from, to } = monthRangeIST(OCT);
    const income = await listSum(ctx.uid, { date_from: from, date_to: to, type: I });
    const spending = await listSum(ctx.uid, { date_from: from, date_to: to, type: E });
    expect(income).toBe(50000); // lent repayment hidden
    expect(spending).toBe(-20500); // write-off adjustment hidden, EMI interest shown
    expect(income + spending).toBe(29500);
    expect(await listSum(ctx.uid, { date_from: from, date_to: to, adjustment: 'write_off' })).toBe(-300);
    // A plain date range without a type still lists everything
    // Transfers in the range: principal 4,500 + card 10,000 + broker 10,000
    expect(await listSum(ctx.uid, { date_from: from, date_to: to, type: T })).toBe(24500);
  });

  test('a late salary counts in the calendar month it landed', async () => {
    const ctx = await scenario('nw5');
    const salary = await prisma.categories.create({ data: { name: 'Salary', type: I, users_user_id: ctx.uid } });
    await updateFinancialProfile(ctx.uid, { salary_category_id: Number(salary.category_id), salary_cutoff_day: 25 });
    const late = await trx(ctx.uid, { type: I, amount: 1000, to: ctx.bank.account_id, date: at(OCT, 28), description: 'Late' });
    await prisma.transactions.update({ where: { transaction_id: late }, data: { categories_category_id: salary.category_id } });
    const r = await netWorthChange(ctx.uid, OCT, NOW);
    expect(r.parts.saved).toBe(30500);
    expect(r.change).toBe(32200);
    expect(r.parts.other).toBe(0);
    const { from, to } = monthRangeIST(OCT);
    expect(await listSum(ctx.uid, { date_from: from, date_to: to, type: I })).toBe(51000);
  });

  test('loan opening adjustments land in other, never write-offs', async () => {
    const user = await UserService.createUser({ username: 'nw6', password: '123', email: 'nw6@x.com' });
    const bank = await account(user.user_id, 'Bank', MYFIN.ACCOUNT_TYPES.CHECKING);
    await createLoan(
      user.user_id,
      { lender: 'SBI', principal: 30000, rate: 12, tenure_months: 12, emi_day: 25, account_id: bank.account_id, start_date: at(OCT, 2) },
      NOW
    );
    const r = await netWorthChange(user.user_id, OCT, NOW);
    expect(r.parts).toEqual({ saved: 0, investment_growth: 0, write_offs: 0, other: -30000 });
    expect(r.change).toBe(-30000);
    expect(r.debt_paid_down).toBe(-30000);
  });

  test('a new user gets zeros; HTTP route validates the month', async () => {
    const user = await UserService.createUser({ username: 'nw7', password: '123', email: 'nw7@x.com' });
    const r = await netWorthChange(user.user_id, OCT, NOW);
    expect(r.change).toBe(0);
    expect(r.start).toBe(0);
    expect(r.parts).toEqual({ saved: 0, investment_growth: 0, write_offs: 0, other: 0 });
    expect(r.debt_paid_down).toBe(0);
    expect(r.trend).toHaveLength(12);
    expect(r.trend.every((m) => m.change === 0)).toBe(true);

    const login = await UserService.attemptLogin('nw7', '123', false);
    const headers = { authusername: 'nw7', sessionkey: login.sessionkey };
    const ok = await fetch(`${baseUrl}/insights/net-worth?month=2026-10`, { headers });
    expect(ok.status).toBe(200);
    expect((await ok.json()).trend).toHaveLength(12);
    const bad = await fetch(`${baseUrl}/insights/net-worth?month=2026-13`, { headers });
    expect(bad.status).toBe(400);
  });
});
