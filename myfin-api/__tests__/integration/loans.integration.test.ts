import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { toTransactionFilter } from '../../src/controllers/transactionController.js';
import AccountService from '../../src/services/accountService.js';
import { deleteDebt } from '../../src/services/debts/debtService.js';
import {
  createLoan,
  disbursementCandidates,
  getLoan,
  installmentCandidates,
  interestCategory,
  linkDisbursement,
  unlinkDisbursement,
  listLoans,
  markInstallmentPaid,
  markPastInstallmentsPaid,
  matchInstallment,
  matchSuggestions,
  prepayment,
  unpayInstallment,
} from '../../src/services/debts/loanService.js';
import { getMonthInsights } from '../../src/services/insights/insightsService.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';
import { expectThrowErrorCode } from './utils/testUtils.js';

const DAY = 86_400;
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
const OCT: YearMonth = { year: 2026, month: 10 };
const at = (ym: YearMonth, day: number) => monthRangeIST(ym).from + (day - 1) * DAY + 3600;
const NOW = at({ year: 2026, month: 10 }, 27);

async function setup(username = 'ln') {
  const user = await UserService.createUser({ username, password: '123', email: `${username}@x.com` });
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
    } as never,
    uid
  );
  const add = async (type: string, description: string, amount: number, day: number, ym = OCT) => {
    const created = await TransactionService.createTransaction(uid, {
      account_from_id: type === E ? bank.account_id : undefined,
      account_to_id: type === I ? bank.account_id : undefined,
      amount,
      type,
      description,
      date_timestamp: at(ym, day),
      is_essential: false,
    } as never);
    return created.transaction_id as bigint;
  };
  const balance = async (accountId: bigint) =>
    Number((await prisma.accounts.findUniqueOrThrow({ where: { account_id: accountId } })).current_balance) / 100;
  return { uid, bank, add, balance };
}

/** The ₹1,20,000 / 12 % / 12-month loan, first EMI on 5 October 2026. */
const newLoan = (uid: bigint, accountId: bigint, extra: Record<string, unknown> = {}) =>
  createLoan(
    uid,
    {
      lender: 'HDFC Bank',
      principal: 120000,
      rate: 12,
      tenure_months: 12,
      emi_day: 5,
      account_id: accountId,
      start_date: at(OCT, 1),
      ...extra,
    },
    NOW
  );

/** Insights spending and the E drill-down (list with the month filter) for October. */
async function octoberSpending(uid: bigint) {
  const insights = (await getMonthInsights(uid, OCT)).summary.spending;
  const rows = (
    await TransactionService.getFilteredTransactionsByForUser(uid, 0, 1000, '', {
      type: E,
      ...toTransactionFilter({ effective_month: '2026-10', type: E }),
    })
  ).results as Array<{ amount: unknown }>;
  const drill = Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
  return { insights, drill };
}

describe('debts: formal loans and EMIs', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let baseUrl: string;
  let server: Server;
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(async () => {
    ctx = await setup();
  });

  test('creating a loan opens a LOANAC at −principal without touching spending', async () => {
    await ctx.add(E, 'Groceries', 1000, 3);
    const before = await octoberSpending(ctx.uid);
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    expect(loan).toMatchObject({
      kind: 'loan',
      lender: 'HDFC Bank',
      principal: 120000,
      emi: 10661.85,
      outstanding_principal: 120000,
      interest_paid: 0,
      emis_left: 12,
      end_date: '2027-09-05',
    });
    expect(loan.schedule[0]).toMatchObject({ n: 1, date: '2026-10-05', interest: 1200, principal: 9461.85 });
    const acc = await prisma.accounts.findUniqueOrThrow({ where: { account_id: BigInt(loan.loan_account_id!) } });
    expect(acc).toMatchObject({ type: 'LOANAC', name: 'HDFC Bank' });
    expect(await ctx.balance(acc.account_id)).toBe(-120000);
    const opening = await prisma.transactions.findFirstOrThrow({
      where: { accounts_account_from_id: acc.account_id },
    });
    expect(opening).toMatchObject({ is_adjustment: true, type: E, debt_role: 'principal' });
    expect(String(opening.debt_id)).toBe(loan.debt_id);
    expect(await octoberSpending(ctx.uid)).toEqual(before);
    expect(before).toEqual({ insights: 1000, drill: 1000 });
  });

  test('a disbursement income is marked and stops counting as income', async () => {
    const credit = await ctx.add(I, 'LOAN DISBURSAL HDFC', 120000, 1);
    expect((await getMonthInsights(ctx.uid, OCT)).summary.income).toBe(120000);
    await newLoan(ctx.uid, ctx.bank.account_id, { disbursement_transaction_id: Number(credit) });
    const row = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: credit } });
    expect(row.debt_role).toBe('disbursement');
    expect((await getMonthInsights(ctx.uid, OCT)).summary.income).toBe(0);
  });

  test('matching an EMI debit splits it into interest spending and a principal transfer', async () => {
    await ctx.add(E, 'Groceries', 1000, 3);
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const debit = await ctx.add(E, 'NACH HDFC EMI', 10661.85, 5);
    expect(await octoberSpending(ctx.uid)).toEqual({ insights: 11661.85, drill: 11661.85 });
    const bankBefore = await ctx.balance(ctx.bank.account_id);

    const sugg = await matchSuggestions(ctx.uid, BigInt(loan.debt_id), NOW);
    expect(sugg).toEqual([expect.objectContaining({ n: 1, transaction_id: String(debit), amount: 10661.85 })]);

    const after = await matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(debit), NOW);
    expect(after.schedule[0]).toMatchObject({ status: 'paid', paid_via: 'matched', transaction_id: String(debit) });
    expect(after).toMatchObject({ outstanding_principal: 110538.15, interest_paid: 1200, emis_left: 11 });

    expect(await ctx.balance(ctx.bank.account_id)).toBe(bankBefore);
    expect(await ctx.balance(BigInt(loan.loan_account_id!))).toBe(-110538.15);

    // Spending: the 10,661.85 debit is replaced by its 1,200 interest; drill-down agrees
    expect(await octoberSpending(ctx.uid)).toEqual({ insights: 2200, drill: 2200 });

    const interestRow = await prisma.transactions.findUniqueOrThrow({
      where: { transaction_id: debit },
      include: { categories: true },
    });
    expect(interestRow).toMatchObject({ amount: 120000n, debt_role: 'interest', description: 'NACH HDFC EMI' });
    expect(interestRow.categories).toMatchObject({ name: 'Loan interest', type: E });
    const principalRow = await prisma.transactions.findFirstOrThrow({
      where: { debt_role: 'principal', type: MYFIN.TRX_TYPES.TRANSFER },
    });
    expect(principalRow).toMatchObject({
      amount: 946185n,
      date_timestamp: interestRow.date_timestamp,
      description: 'Loan principal — HDFC Bank #1',
      accounts_account_from_id: ctx.bank.account_id,
      accounts_account_to_id: BigInt(loan.loan_account_id!),
    });

    // Not twice, not an out-of-range amount
    await expectThrowErrorCode(() => matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(debit), NOW), 400);
    const tooBig = await ctx.add(E, 'NACH HDFC EMI', 10663, 5, { year: 2026, month: 11 });
    await expectThrowErrorCode(() => matchInstallment(ctx.uid, BigInt(loan.debt_id), 2, Number(tooBig), NOW), 400);
  });

  test('marking past EMIs paid manually leaves the bank alone and follows the schedule', async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id, { start_date: at({ year: 2026, month: 6 }, 1) });
    const bankBefore = await ctx.balance(ctx.bank.account_id);
    await markInstallmentPaid(ctx.uid, BigInt(loan.debt_id), 2, {}, NOW);
    const after = await markInstallmentPaid(ctx.uid, BigInt(loan.debt_id), 3, {}, NOW);
    // Installment 1 is still unpaid, so outstanding is principal minus rows 2 and 3
    expect(after.outstanding_principal).toBeCloseTo(
      120000 - after.schedule[1].principal - after.schedule[2].principal,
      2
    );
    await markInstallmentPaid(ctx.uid, BigInt(loan.debt_id), 1, {}, NOW);
    const full = await getLoan(ctx.uid, BigInt(loan.debt_id), NOW);
    expect(full.outstanding_principal).toBe(full.schedule[2].balance);
    expect(full.schedule[1]).toMatchObject({ status: 'paid', paid_via: 'manual' });
    expect(full.interest_paid).toBeCloseTo(
      full.schedule[0].interest + full.schedule[1].interest + full.schedule[2].interest,
      2
    );
    expect(await ctx.balance(ctx.bank.account_id)).toBe(bankBefore);
    expect(await ctx.balance(BigInt(loan.loan_account_id!))).toBe(-full.schedule[2].balance);
    const adjustments = await prisma.transactions.findMany({
      where: { debt_id: BigInt(loan.debt_id), type: I },
    });
    expect(adjustments).toHaveLength(3);
    expect(adjustments.every((a) => a.is_adjustment && a.debt_role === 'principal')).toBe(true);
    expect((await getMonthInsights(ctx.uid, { year: 2026, month: 8 })).summary).toMatchObject({
      income: 0,
      spending: 0,
    });

    // "Mark all past EMIs paid": June..October are past on 27 October (installments 4 and 5)
    const all = await markPastInstallmentsPaid(ctx.uid, BigInt(loan.debt_id), NOW);
    expect(all.schedule.filter((r) => r.status === 'paid').map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
    expect(all.outstanding_principal).toBe(all.schedule[4].balance);
  });

  test('unpay reverses a match and a manual payment', async () => {
    await ctx.add(E, 'Groceries', 1000, 3);
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const debit = await ctx.add(E, 'NACH HDFC EMI', 10661.85, 5);
    const original = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: debit } });
    await matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(debit), NOW);
    await markInstallmentPaid(ctx.uid, BigInt(loan.debt_id), 2, { date: at(OCT, 20) }, NOW);

    let back = await unpayInstallment(ctx.uid, BigInt(loan.debt_id), 1, NOW);
    const restored = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: debit } });
    expect(restored).toMatchObject({
      amount: 1066185n,
      categories_category_id: original.categories_category_id,
      debt_id: null,
      debt_role: null,
    });
    expect(await prisma.transactions.count({ where: { type: MYFIN.TRX_TYPES.TRANSFER } })).toBe(0);
    // Unpaid again, and 22 days past its date on 27 October
    expect(back.schedule[0]).toMatchObject({ status: 'missed', paid_via: null });
    expect(await octoberSpending(ctx.uid)).toEqual({ insights: 11661.85, drill: 11661.85 });

    back = await unpayInstallment(ctx.uid, BigInt(loan.debt_id), 2, NOW);
    expect(back.outstanding_principal).toBe(120000);
    expect(await ctx.balance(BigInt(loan.loan_account_id!))).toBe(-120000);
    expect(await prisma.transactions.count({ where: { debt_id: BigInt(loan.debt_id) } })).toBe(1);
    await expectThrowErrorCode(() => unpayInstallment(ctx.uid, BigInt(loan.debt_id), 2, NOW), 400);
  });

  test('an installment 10 days overdue is missed; one 3 days late is still due', async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id, { start_date: at({ year: 2026, month: 9 }, 1) });
    const view = await getLoan(ctx.uid, BigInt(loan.debt_id), at({ year: 2026, month: 9 }, 15));
    expect(view.schedule[0].status).toBe('missed');
    expect(view.schedule[1].status).toBe('due');
    expect(view.missed_count).toBe(1);
    const early = await getLoan(ctx.uid, BigInt(loan.debt_id), at({ year: 2026, month: 9 }, 8));
    expect(early.schedule[0].status).toBe('due');
  });

  test('editing or deleting the rows of a matched EMI', async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const debit = await ctx.add(E, 'NACH HDFC EMI', 10661.85, 5);
    await matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(debit), NOW);
    const edit = (amount: number, description: string) =>
      TransactionService.updateTransaction(ctx.uid, {
        new_amount: amount,
        new_account_from_id: ctx.bank.account_id,
        new_account_to_id: null,
        new_entity_id: null,
        new_category_id: null,
        new_type: E,
        new_description: description,
        new_date_timestamp: at(OCT, 5),
        new_is_essential: false,
        tags: [],
        is_split: false,
        split_tags: null,
        transaction_id: debit,
      } as never);
    // Amount edits are refused; a description edit is fine
    await expectThrowErrorCode(() => edit(1300, 'NACH HDFC EMI'), 400);
    await edit(1200, 'EMI October');
    expect((await getLoan(ctx.uid, BigInt(loan.debt_id), NOW)).interest_paid).toBe(1200);

    // Deleting the principal transfer unpays the installment and restores the debit
    const principalRow = await prisma.transactions.findFirstOrThrow({ where: { type: MYFIN.TRX_TYPES.TRANSFER } });
    await TransactionService.deleteTransaction(ctx.uid, Number(principalRow.transaction_id));
    const restored = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: debit } });
    expect(restored).toMatchObject({ amount: 1066185n, debt_id: null, debt_role: null });
    expect((await getLoan(ctx.uid, BigInt(loan.debt_id), NOW)).schedule[0].status).toBe('missed');
    expect(await ctx.balance(ctx.bank.account_id)).toBe(-10661.85);
    expect(await ctx.balance(BigInt(loan.loan_account_id!))).toBe(-120000);

    // Deleting the interest row of a matched EMI removes its principal transfer too
    await matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(debit), NOW);
    await TransactionService.deleteTransaction(ctx.uid, Number(debit));
    expect(await prisma.transactions.count({ where: { type: MYFIN.TRX_TYPES.TRANSFER } })).toBe(0);
    expect(await ctx.balance(ctx.bank.account_id)).toBe(0);
    expect(await ctx.balance(BigInt(loan.loan_account_id!))).toBe(-120000);
    expect((await getLoan(ctx.uid, BigInt(loan.debt_id), NOW)).emis_left).toBe(12);
  });

  test('deleting a loan undoes everything it created (ruling D3)', async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const debit = await ctx.add(E, 'NACH HDFC EMI', 10661.85, 5);
    await matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(debit), NOW);
    await markInstallmentPaid(ctx.uid, BigInt(loan.debt_id), 2, { date: at(OCT, 20) }, NOW);
    // The loan account belongs to the loan
    await expectThrowErrorCode(() => AccountService.deleteAccount(BigInt(loan.loan_account_id!)), 400);

    await deleteDebt(ctx.uid, BigInt(loan.debt_id));
    expect(await prisma.debts.count()).toBe(0);
    expect(await prisma.accounts.count({ where: { account_id: BigInt(loan.loan_account_id!) } })).toBe(0);
    expect(await prisma.transactions.findMany({ select: { transaction_id: true } })).toEqual([
      { transaction_id: debit },
    ]);
    const restored = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: debit } });
    expect(restored).toMatchObject({ amount: 1066185n, debt_id: null, debt_role: null });
    expect(await ctx.balance(ctx.bank.account_id)).toBe(-10661.85);
  });

  test("deleting a loan also deletes its loan account's legacy entry", async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const loanAccountId = BigInt(loan.loan_account_id!);
    await prisma.legacy_entries.create({
      data: { users_user_id: ctx.uid, kind: 'account', account_id: loanAccountId, data: { nominee: 'A' }, created_at: 1n, updated_at: 1n },
    });
    await prisma.legacy_entries.create({
      data: { users_user_id: ctx.uid, kind: 'instruction', data: { text: 'keep me' }, created_at: 1n, updated_at: 1n },
    });
    await deleteDebt(ctx.uid, BigInt(loan.debt_id));
    expect(await prisma.legacy_entries.findMany({ where: { users_user_id: ctx.uid }, select: { kind: true } })).toEqual([
      { kind: 'instruction' },
    ]);
  });

  test('a debit more than 45 days from the installment date cannot be matched', async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const far = await ctx.add(E, 'NACH HDFC EMI', 10661.85, 25, { year: 2026, month: 11 }); // 51 days after 5 Oct
    await expectThrowErrorCode(() => matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(far), NOW), 400);
    const near = await ctx.add(E, 'NACH HDFC EMI', 10661.85, 15, { year: 2026, month: 11 }); // 41 days
    expect((await matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(near), NOW)).schedule[0].status).toBe('paid');
  });

  test("a salary plan's salary transaction cannot be a loan disbursement", async () => {
    const salary = await ctx.add(I, 'SALARY ACME', 120000, 1);
    await prisma.salary_plans.create({
      data: { users_user_id: ctx.uid, month: 202610, salary_transaction_id: salary, salary_amount: 12000000n, buckets: [], created_at: 1n },
    });
    await expectThrowErrorCode(() => newLoan(ctx.uid, ctx.bank.account_id, { disbursement_transaction_id: Number(salary) }), 400);
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    await expectThrowErrorCode(() => linkDisbursement(ctx.uid, BigInt(loan.debt_id), Number(salary), NOW), 400);
  });

  test('concurrent first uses of the Loan interest category create it once and all succeed', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => interestCategory(ctx.uid)));
    expect(new Set(ids.map(String)).size).toBe(1);
    expect(await prisma.categories.count({ where: { users_user_id: ctx.uid, name: 'Loan interest' } })).toBe(1);
  });

  test('a lender name at the 255-character limit still gets account names that fit', async () => {
    const lender = 'L'.repeat(255);
    const first = await newLoan(ctx.uid, ctx.bank.account_id, { lender });
    const second = await newLoan(ctx.uid, ctx.bank.account_id, { lender });
    const names = await prisma.accounts.findMany({
      where: { account_id: { in: [BigInt(first.loan_account_id!), BigInt(second.loan_account_id!)] } },
      select: { name: true },
    });
    expect(names.map((n) => n.name.length).every((l) => l <= 255)).toBe(true);
    expect(new Set(names.map((n) => n.name)).size).toBe(2);
  });

  test('prepayment what-if', async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const r = await prepayment(ctx.uid, BigInt(loan.debt_id), 20000, 3);
    expect(r.months_saved).toBeGreaterThanOrEqual(1);
    expect(r.interest_saved).toBeGreaterThan(0);
    expect(r.new_end_date < loan.end_date).toBe(true);
  });

  test("another user's loan or transaction is 401", async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const other = await setup('ln2');
    await expectThrowErrorCode(() => getLoan(other.uid, BigInt(loan.debt_id), NOW), 401);
    await expectThrowErrorCode(() => markInstallmentPaid(other.uid, BigInt(loan.debt_id), 1, {}, NOW), 401);
    await expectThrowErrorCode(() => deleteDebt(other.uid, BigInt(loan.debt_id)), 401);
    const theirs = await other.add(E, 'NACH HDFC EMI', 10661.85, 5);
    await expectThrowErrorCode(() => matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(theirs), NOW), 401);
    await expectThrowErrorCode(() => newLoan(other.uid, ctx.bank.account_id), 401);
    expect(await listLoans(other.uid, NOW)).toEqual([]);
  });

  test('HTTP routes: create, view, match, prepayment', async () => {
    const login = await UserService.attemptLogin('ln', '123', false);
    const headers = { authusername: 'ln', sessionkey: login.sessionkey, 'content-type': 'application/json' };
    const created = await fetch(`${baseUrl}/debts/loans`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        lender: 'HDFC Bank',
        principal: 120000,
        rate: 12,
        tenure_months: 12,
        emi_day: 5,
        account_id: Number(ctx.bank.account_id),
        start_date: at(OCT, 1),
      }),
    });
    expect(created.status).toBe(200);
    const loan = await created.json();
    const debit = await ctx.add(E, 'NACH HDFC EMI', 10661.85, 5);
    const matched = await fetch(`${baseUrl}/debts/loans/${loan.debt_id}/installments/1/match`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ transaction_id: Number(debit) }),
    });
    expect(matched.status).toBe(200);
    expect((await matched.json()).outstanding_principal).toBe(110538.15);
    const view = await fetch(`${baseUrl}/debts/loans/${loan.debt_id}`, { headers });
    expect((await view.json()).schedule).toHaveLength(12);
    const list = await fetch(`${baseUrl}/debts/loans`, { headers });
    expect(await list.json()).toHaveLength(1);
    const what = await fetch(`${baseUrl}/debts/loans/${loan.debt_id}/prepayment?amount=20000&after_installment=3`, {
      headers,
    });
    expect(what.status).toBe(200);
    expect((await what.json()).months_saved).toBeGreaterThanOrEqual(1);
    const unpaid = await fetch(`${baseUrl}/debts/loans/${loan.debt_id}/installments/1/unpay`, {
      method: 'POST',
      headers,
    });
    expect(unpaid.status).toBe(200);
  });

  test('backup JSON round trip keeps the loan, payments, roles and loan account', async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const debit = await ctx.add(E, 'NACH HDFC EMI', 10661.85, 5);
    await matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(debit), NOW);
    await markInstallmentPaid(ctx.uid, BigInt(loan.debt_id), 2, { date: at(OCT, 20) }, NOW);
    const before = await getLoan(ctx.uid, BigInt(loan.debt_id), NOW);

    const login = await UserService.attemptLogin('ln', '123', false);
    const headers = { authusername: 'ln', sessionkey: login.sessionkey, 'content-type': 'application/json' };
    const backup = await (await fetch(`${baseUrl}/user/backup`, { headers })).json();
    const restoredRes = await fetch(`${baseUrl}/user/restore`, { method: 'PUT', headers, body: JSON.stringify(backup) });
    expect(restoredRes.status).toBe(200);

    const [after] = await listLoans(ctx.uid, NOW);
    const strip = (l: typeof before) => ({
      ...l,
      debt_id: undefined,
      account_id: undefined,
      loan_account_id: undefined,
      schedule: l.schedule.map((r) => ({ ...r, payment_id: undefined, transaction_id: undefined })),
    });
    expect(strip(after)).toEqual(strip(before));
    const acc = await prisma.accounts.findUniqueOrThrow({ where: { account_id: BigInt(after.loan_account_id!) } });
    expect(acc.type).toBe('LOANAC');
    expect(await ctx.balance(acc.account_id)).toBe(-before.outstanding_principal);
    const roles = await prisma.transactions.findMany({
      where: { debt_id: BigInt(after.debt_id) },
      select: { debt_role: true },
      orderBy: { transaction_id: 'asc' },
    });
    expect(roles.map((r) => r.debt_role).sort()).toEqual(['interest', 'principal', 'principal', 'principal']);
    // Unpay after a restore still restores the original debit (original amount survives)
    await unpayInstallment(ctx.uid, BigInt(after.debt_id), 1, NOW);
    const debitRow = await prisma.transactions.findFirstOrThrow({ where: { description: 'NACH HDFC EMI' } });
    expect(debitRow.amount).toBe(1066185n);
  });

  const accountOf = async (type: string, name: string) =>
    AccountService.createAccount(
      {
        name,
        type,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: ctx.uid,
      } as never,
      ctx.uid
    );
  const expenseFrom = async (accountId: bigint, amount: number, day: number) =>
    (
      await TransactionService.createTransaction(ctx.uid, {
        account_from_id: accountId,
        amount,
        type: E,
        description: 'NACH HDFC EMI',
        date_timestamp: at(OCT, day),
        is_essential: false,
      } as never)
    ).transaction_id as bigint;

  test('disbursement can be linked later and unlinked; candidates are nearby incomes', async () => {
    const credit = await ctx.add(I, 'LOAN DISBURSAL HDFC', 120000, 2);
    await ctx.add(I, 'Salary', 50000, 28, { year: 2026, month: 12 });
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    expect(loan.disbursement).toBeNull();
    const cands = await disbursementCandidates(ctx.uid, at(OCT, 1));
    expect(cands.map((c) => c.transaction_id)).toEqual([String(credit)]);

    const linked = await linkDisbursement(ctx.uid, BigInt(loan.debt_id), Number(credit), NOW);
    expect(linked.disbursement).toMatchObject({ transaction_id: String(credit), amount: 120000 });
    expect((await getMonthInsights(ctx.uid, OCT)).summary.income).toBe(0);
    expect(await disbursementCandidates(ctx.uid, at(OCT, 1))).toEqual([]);

    // Through HTTP: unlink, then link again
    const login = await UserService.attemptLogin('ln', '123', false);
    const headers = { authusername: 'ln', sessionkey: login.sessionkey, 'content-type': 'application/json' };
    const del = await fetch(`${baseUrl}/debts/loans/${loan.debt_id}/disbursement`, { method: 'DELETE', headers });
    expect(del.status).toBe(200);
    expect((await del.json()).disbursement).toBeNull();
    expect((await getMonthInsights(ctx.uid, OCT)).summary.income).toBe(120000);
    const httpCands = await fetch(`${baseUrl}/debts/loans/disbursement-candidates?date=${at(OCT, 1)}`, { headers });
    expect((await httpCands.json()).map((c: { transaction_id: string }) => c.transaction_id)).toEqual([
      String(credit),
    ]);
    const relink = await fetch(`${baseUrl}/debts/loans/${loan.debt_id}/disbursement`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ transaction_id: Number(credit) }),
    });
    expect(relink.status).toBe(200);
    expect((await getMonthInsights(ctx.uid, OCT)).summary.income).toBe(0);

    // Unlink again so the row counts; another user can't link it
    await unlinkDisbursement(ctx.uid, BigInt(loan.debt_id), NOW);
    const other = await setup('ln2');
    await expectThrowErrorCode(() => linkDisbursement(other.uid, BigInt(loan.debt_id), Number(credit), NOW), 401);
  });

  test('installment candidates come from any bank or card account within ±₹1 and 45 days', async () => {
    const card = await accountOf(MYFIN.ACCOUNT_TYPES.CREDIT, 'Card');
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const fromCard = await expenseFrom(card.account_id, 10661.5, 30); // 25 days late, other account
    await expenseFrom(card.account_id, 10700, 6); // amount out of range
    const cands = await installmentCandidates(ctx.uid, BigInt(loan.debt_id), 1);
    expect(cands.map((c) => c.transaction_id)).toEqual([String(fromCard)]);
    // Not offered by the automatic suggestions (other account), but it can be matched
    expect(await matchSuggestions(ctx.uid, BigInt(loan.debt_id), NOW)).toEqual([]);
    const cardBefore = await ctx.balance(card.account_id);
    const matched = await matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(fromCard), NOW);
    expect(matched.schedule[0].status).toBe('paid');
    expect(await ctx.balance(card.account_id)).toBe(cardBefore);

    const login = await UserService.attemptLogin('ln', '123', false);
    const headers = { authusername: 'ln', sessionkey: login.sessionkey };
    const res = await fetch(`${baseUrl}/debts/loans/${loan.debt_id}/installments/2/candidates`, { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test('a debit from a loan or investment account cannot be an EMI', async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id);
    const invest = await accountOf(MYFIN.ACCOUNT_TYPES.INVESTING, 'Broker');
    const fromInvest = await expenseFrom(invest.account_id, 10661.85, 5);
    const fromLoan = await expenseFrom(BigInt(loan.loan_account_id!), 10661.85, 5);
    await expectThrowErrorCode(() => matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(fromInvest), NOW), 400);
    await expectThrowErrorCode(() => matchInstallment(ctx.uid, BigInt(loan.debt_id), 1, Number(fromLoan), NOW), 400);
    expect(await installmentCandidates(ctx.uid, BigInt(loan.debt_id), 1)).toEqual([]);
  });

  test('a paid-off loan with a residual of up to ₹1 is settled', async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id, { principal: 300, rate: 0, tenure_months: 3 });
    expect(loan.emi).toBe(100);
    await markInstallmentPaid(ctx.uid, BigInt(loan.debt_id), 1, {}, NOW);
    await markInstallmentPaid(ctx.uid, BigInt(loan.debt_id), 2, {}, NOW);
    const debit = await ctx.add(E, 'NACH HDFC EMI', 99.5, 25);
    const last = await matchInstallment(ctx.uid, BigInt(loan.debt_id), 3, Number(debit), NOW);
    expect(last).toMatchObject({ outstanding_principal: 0.5, status: 'settled', emis_left: 0 });
    // Unpaying re-opens it
    const back = await unpayInstallment(ctx.uid, BigInt(loan.debt_id), 3, NOW);
    expect(back).toMatchObject({ status: 'open', emis_left: 1 });
  });

  test("the opening balance can't be deleted on its own; a clashing lender name gets a free account name", async () => {
    const loan = await newLoan(ctx.uid, ctx.bank.account_id, { lender: 'Bank' });
    const acc = await prisma.accounts.findUniqueOrThrow({ where: { account_id: BigInt(loan.loan_account_id!) } });
    expect(acc.name).toBe('Bank loan');
    const opening = await prisma.transactions.findFirstOrThrow({ where: { description: 'Loan opening balance' } });
    await expectThrowErrorCode(() => TransactionService.deleteTransaction(ctx.uid, Number(opening.transaction_id)), 400);
    expect(await ctx.balance(acc.account_id)).toBe(-120000);
    // A manual principal adjustment can still be deleted: it unpays its installment
    await markInstallmentPaid(ctx.uid, BigInt(loan.debt_id), 1, { date: at(OCT, 6) }, NOW);
    const manual = await prisma.transactions.findFirstOrThrow({
      where: { debt_id: BigInt(loan.debt_id), type: I },
    });
    await TransactionService.deleteTransaction(ctx.uid, Number(manual.transaction_id));
    expect((await getLoan(ctx.uid, BigInt(loan.debt_id), NOW)).emis_left).toBe(12);
    expect(await ctx.balance(acc.account_id)).toBe(-120000);
  });
});
