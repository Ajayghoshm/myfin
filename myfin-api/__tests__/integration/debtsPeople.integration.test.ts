import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { toTransactionFilter } from '../../src/controllers/transactionController.js';
import AccountService from '../../src/services/accountService.js';
import {
  addRepayment,
  createPeopleDebt,
  deleteDebt,
  deleteRepayment,
  listDebts,
  peopleTotals,
  repaymentSuggestions,
} from '../../src/services/debts/debtService.js';
import { getMonthInsights } from '../../src/services/insights/insightsService.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import { currentSalaryPlan } from '../../src/services/planning/salaryPlanService.js';
import {
  createYearlyCost,
  linkTransaction as linkYearlyCost,
} from '../../src/services/planning/yearlyCostService.js';
import BackupManager from '../../src/utils/backupManager.js';
import { expectThrowErrorCode } from './utils/testUtils.js';

const DAY = 86_400;
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
const OCT: YearMonth = { year: 2026, month: 10 };
const at = (ym: YearMonth, day: number) => monthRangeIST(ym).from + (day - 1) * DAY + 3600;
const NOW = at({ year: 2026, month: 11 }, 20);

async function setup(username = 'dp') {
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
    await TransactionService.createTransaction(uid, {
      account_from_id: type === E ? bank.account_id : undefined,
      account_to_id: type === I ? bank.account_id : undefined,
      amount,
      type,
      description,
      date_timestamp: at(ym, day),
      is_essential: false,
    } as never);
    const last = await prisma.transactions.findFirstOrThrow({ orderBy: { transaction_id: 'desc' } });
    return last.transaction_id;
  };
  return { uid, bank, add };
}

const listIds = async (uid: bigint, input: { effective_month?: string; type?: string }) =>
  (
    (
      await TransactionService.getFilteredTransactionsByForUser(uid, 0, 1000, '', {
        type: input.type,
        ...toTransactionFilter(input),
      })
    ).results as Array<{ transaction_id: bigint }>
  ).map((r) => String(r.transaction_id));

describe('debts: people (lent / borrowed)', () => {
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

  test('marking a payment as lent removes it from spending and from the E drill-down', async () => {
    const paid = await ctx.add(E, 'PAID TO RAHUL', 5000, 5);
    await ctx.add(E, 'PAID TO GROCER', 1200, 6);
    expect((await getMonthInsights(ctx.uid, OCT)).summary.spending).toBe(6200);

    const debt = await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(paid) });
    expect(debt).toMatchObject({ kind: 'lent', principal: 5000, outstanding: 5000, counterparty_key: 'RAHUL' });
    expect((await getMonthInsights(ctx.uid, OCT)).summary.spending).toBe(1200);

    const row = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: paid } });
    expect(row.debt_role).toBe('lend');
    expect(String(row.debt_id)).toBe(debt.debt_id);

    expect(await listIds(ctx.uid, { effective_month: '2026-10', type: E })).not.toContain(String(paid));
    expect(await listIds(ctx.uid, { effective_month: '2026-10' })).toContain(String(paid));
  });

  test('repayment is suggested, confirmed (not income), then a manual cash repayment settles it', async () => {
    const paid = await ctx.add(E, 'PAID TO RAHUL', 5000, 5);
    await ctx.add(I, 'Salary', 50000, 1);
    const debt = await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(paid) });
    const back = await ctx.add(I, 'RECEIVED FROM RAHUL', 2000, 15);
    await ctx.add(I, 'RECEIVED FROM SOMEONE', 700, 16);

    const sugg = await repaymentSuggestions(ctx.uid, BigInt(debt.debt_id));
    expect(sugg.map((s) => s.transaction_id)).toEqual([String(back)]);
    expect(sugg[0].amount).toBe(2000);

    expect((await getMonthInsights(ctx.uid, OCT)).summary.income).toBe(52700);
    const afterLink = await addRepayment(ctx.uid, BigInt(debt.debt_id), { transaction_id: Number(back) });
    expect(afterLink).toMatchObject({ outstanding: 3000, status: 'open' });
    expect((await getMonthInsights(ctx.uid, OCT)).summary.income).toBe(50700);
    expect(await listIds(ctx.uid, { effective_month: '2026-10', type: I })).not.toContain(String(back));
    expect(await repaymentSuggestions(ctx.uid, BigInt(debt.debt_id))).toEqual([]);

    // Already linked: 400
    await expectThrowErrorCode(
      () => addRepayment(ctx.uid, BigInt(debt.debt_id), { transaction_id: Number(back) }),
      400
    );
    // Wrong type (an expense for a lent entry): 400
    const other = await ctx.add(E, 'PAID TO RAHUL', 100, 20);
    await expectThrowErrorCode(
      () => addRepayment(ctx.uid, BigInt(debt.debt_id), { transaction_id: Number(other) }),
      400
    );

    const settled = await addRepayment(ctx.uid, BigInt(debt.debt_id), { amount: 3000, date: at(OCT, 25) });
    expect(settled).toMatchObject({ outstanding: 0, status: 'settled', display_status: 'settled' });
    expect(settled.payments.map((p) => [p.amount, p.manual])).toEqual([
      [2000, false],
      [3000, true],
    ]);

    // Undoing the linked repayment re-opens it and restores the income row
    const linked = settled.payments.find((p) => !p.manual)!;
    const reopened = await deleteRepayment(ctx.uid, BigInt(debt.debt_id), BigInt(linked.payment_id));
    expect(reopened).toMatchObject({ outstanding: 2000, status: 'open' });
    const row = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: back } });
    expect([row.debt_id, row.debt_role]).toEqual([null, null]);
  });

  test('a borrowed entry by hand gives you_owe; totals as of a time', async () => {
    await createPeopleDebt(ctx.uid, { kind: 'borrowed', name: '  amit   kumar ', amount: 10000, date: at(OCT, 3) });
    const { debts, totals } = await listDebts(ctx.uid, NOW);
    expect(totals).toEqual({ owed_to_you: 0, you_owe: 10000 });
    expect(debts[0]).toMatchObject({ kind: 'borrowed', counterparty_key: 'AMIT KUMAR', outstanding: 10000 });
    expect(await peopleTotals(ctx.uid, NOW)).toEqual({ owedToYouCents: 0, youOweCents: 1_000_000 });
    expect(await peopleTotals(ctx.uid, at(OCT, 2))).toEqual({ owedToYouCents: 0, youOweCents: 0 });
  });

  test('a past due date makes an unsettled entry overdue', async () => {
    await createPeopleDebt(ctx.uid, {
      kind: 'lent',
      name: 'Rahul',
      amount: 1000,
      date: at(OCT, 1),
      due_date: at(OCT, 10),
    });
    const { debts } = await listDebts(ctx.uid, NOW);
    expect(debts[0]).toMatchObject({ overdue: true, display_status: 'overdue', status: 'open' });
    const { debts: before } = await listDebts(ctx.uid, at(OCT, 5));
    expect(before[0]).toMatchObject({ overdue: false, display_status: 'outstanding' });
  });

  test('deleting the entry restores the transaction to counting', async () => {
    const paid = await ctx.add(E, 'PAID TO RAHUL', 5000, 5);
    const debt = await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(paid) });
    expect((await getMonthInsights(ctx.uid, OCT)).summary.spending).toBe(0);
    await deleteDebt(ctx.uid, BigInt(debt.debt_id));
    expect((await getMonthInsights(ctx.uid, OCT)).summary.spending).toBe(5000);
    const row = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: paid } });
    expect([row.debt_id, row.debt_role]).toEqual([null, null]);
  });

  test('a lent entry needs an expense, a borrowed one an income; one debt per transaction', async () => {
    const inc = await ctx.add(I, 'RECEIVED FROM RAHUL', 500, 5);
    const exp = await ctx.add(E, 'PAID TO RAHUL', 500, 6);
    await expectThrowErrorCode(
      () => createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(inc) }),
      400
    );
    await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(exp) });
    await expectThrowErrorCode(
      () => createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(exp) }),
      400
    );
  });

  test('deleting a linked repayment transaction removes the repayment', async () => {
    const debt = await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', amount: 5000, date: at(OCT, 1) });
    const back = await ctx.add(I, 'RECEIVED FROM RAHUL', 5000, 15);
    expect(await addRepayment(ctx.uid, BigInt(debt.debt_id), { transaction_id: Number(back) })).toMatchObject({ status: 'settled' });
    await TransactionService.deleteTransaction(ctx.uid, Number(back));
    const { debts } = await listDebts(ctx.uid, NOW);
    expect(debts[0]).toMatchObject({ outstanding: 5000, status: 'open', payments: [] });
  });

  test('HTTP: routes work for the owner; another user gets 401 on debt and transaction', async () => {
    const paid = await ctx.add(E, 'PAID TO RAHUL', 5000, 5);
    const login = await UserService.attemptLogin('dp', '123', false);
    const headers = { authusername: 'dp', sessionkey: login.sessionkey, 'content-type': 'application/json' };
    const created = await fetch(`${baseUrl}/debts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind: 'lent', name: 'Rahul', transaction_id: Number(paid), due_date: at(OCT, 30), note: 'trip' }),
    });
    expect(created.status).toBe(200);
    const debt = await created.json();
    const list = await (await fetch(`${baseUrl}/debts`, { headers })).json();
    expect(list.totals).toEqual({ owed_to_you: 5000, you_owe: 0 });
    const put = await fetch(`${baseUrl}/debts/${debt.debt_id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Rahul S', due_date: null, note: null }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ counterparty_name: 'Rahul S', due_date: null, principal: 5000 });
    const manual = await fetch(`${baseUrl}/debts/${debt.debt_id}/repayments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 1000, date: at(OCT, 20) }),
    });
    expect((await manual.json()).outstanding).toBe(4000);
    expect((await fetch(`${baseUrl}/debts/${debt.debt_id}/repayment-suggestions`, { headers })).status).toBe(200);
    const bad = await fetch(`${baseUrl}/debts`, { method: 'POST', headers, body: JSON.stringify({ kind: 'loan', name: 'x', amount: 1, date: 1 }) });
    expect(bad.status).toBe(400);

    await UserService.createUser({ username: 'other', password: '123', email: 'o@x.com' });
    const oLogin = await UserService.attemptLogin('other', '123', false);
    const oHeaders = { authusername: 'other', sessionkey: oLogin.sessionkey, 'content-type': 'application/json' };
    expect((await fetch(`${baseUrl}/debts/${debt.debt_id}`, { method: 'DELETE', headers: oHeaders })).status).toBe(401);
    expect(
      (await fetch(`${baseUrl}/debts/${debt.debt_id}/repayments`, { method: 'POST', headers: oHeaders, body: JSON.stringify({ amount: 1, date: 1 }) })).status
    ).toBe(401);
    expect((await fetch(`${baseUrl}/debts/${debt.debt_id}/repayment-suggestions`, { headers: oHeaders })).status).toBe(401);
    const steal = await fetch(`${baseUrl}/debts`, {
      method: 'POST',
      headers: oHeaders,
      body: JSON.stringify({ kind: 'lent', name: 'Rahul', transaction_id: Number(paid) }),
    });
    expect(steal.status).toBe(401);
    expect((await (await fetch(`${baseUrl}/debts`, { headers: oHeaders })).json()).debts).toEqual([]);
  });

  test('LOANAC exists and cannot be earmarked as an emergency fund', async () => {
    expect(MYFIN.ACCOUNT_TYPES.LOAN).toBe('LOANAC');
    const mk = (name: string, type: string, extra = {}) =>
      AccountService.createAccount(
        {
          name,
          type,
          description: '',
          status: MYFIN.ACCOUNT_STATUS.ACTIVE,
          exclude_from_budgets: false,
          current_balance: 0,
          users_user_id: ctx.uid,
          ...extra,
        } as never,
        ctx.uid
      );
    await expectThrowErrorCode(() => mk('Car loan', MYFIN.ACCOUNT_TYPES.LOAN, { is_emergency_fund: true }), 400);
    const loan = await mk('Home loan', MYFIN.ACCOUNT_TYPES.LOAN);
    await expectThrowErrorCode(
      () =>
        AccountService.updateAccount(
          {
            account_id: loan.account_id,
            new_name: 'Home loan',
            new_type: MYFIN.ACCOUNT_TYPES.LOAN,
            new_description: '',
            new_status: MYFIN.ACCOUNT_STATUS.ACTIVE,
            exclude_from_budgets: false,
            new_is_emergency_fund: true,
          } as never,
          ctx.uid
        ),
      400
    );
  });

  test('backup JSON round trip keeps entries, payments and transaction links', async () => {
    const paid = await ctx.add(E, 'PAID TO RAHUL', 5000, 5);
    const debt = await createPeopleDebt(ctx.uid, {
      kind: 'lent',
      name: 'Rahul',
      transaction_id: Number(paid),
      due_date: at(OCT, 30),
      note: 'trip',
    });
    const back = await ctx.add(I, 'RECEIVED FROM RAHUL', 2000, 15);
    await addRepayment(ctx.uid, BigInt(debt.debt_id), { transaction_id: Number(back) });
    await addRepayment(ctx.uid, BigInt(debt.debt_id), { amount: 500, date: at(OCT, 20) });
    await createPeopleDebt(ctx.uid, { kind: 'borrowed', name: 'Amit', amount: 10000, date: at(OCT, 3) });

    // Through HTTP, so the strict restore schema sees the new keys
    const login = await UserService.attemptLogin('dp', '123', false);
    const headers = { authusername: 'dp', sessionkey: login.sessionkey, 'content-type': 'application/json' };
    const backupRes = await fetch(`${baseUrl}/user/backup`, { headers });
    expect(backupRes.status).toBe(200);
    const backup = await backupRes.json();
    expect(backup.debts).toHaveLength(2);
    expect(backup.debt_payments).toHaveLength(2);
    const restored = await fetch(`${baseUrl}/user/restore`, { method: 'PUT', headers, body: JSON.stringify(backup) });
    expect(restored.status).toBe(200);

    const { debts, totals } = await listDebts(ctx.uid, NOW);
    expect(totals).toEqual({ owed_to_you: 2500, you_owe: 10000 });
    const lent = debts.find((d) => d.kind === 'lent')!;
    expect(lent).toMatchObject({ counterparty_name: 'Rahul', note: 'trip', due_date: at(OCT, 30), principal: 5000 });
    expect(lent.payments.map((p) => [p.amount, p.manual])).toEqual([
      [2000, false],
      [500, true],
    ]);
    const lendRow = await prisma.transactions.findFirstOrThrow({ where: { debt_role: 'lend' } });
    expect(String(lendRow.debt_id)).toBe(lent.debt_id);
    expect(lendRow.description).toBe('PAID TO RAHUL');
    const repRow = await prisma.transactions.findFirstOrThrow({ where: { debt_role: 'repayment' } });
    expect(String(repRow.debt_id)).toBe(lent.debt_id);
    expect(lent.payments[0].transaction_id).toBe(String(repRow.transaction_id));
    expect((await getMonthInsights(ctx.uid, OCT)).summary).toMatchObject({ spending: 0, income: 0 });
  });

  const edit = (id: bigint, type: string, amount: number, date: number, description: string) =>
    TransactionService.updateTransaction(ctx.uid, {
      new_amount: amount,
      new_account_from_id: type === E ? ctx.bank.account_id : null,
      new_account_to_id: type === I ? ctx.bank.account_id : null,
      new_entity_id: null,
      new_category_id: null,
      new_type: type,
      new_description: description,
      new_date_timestamp: date,
      new_is_essential: false,
      tags: [],
      is_split: false,
      split_tags: null,
      transaction_id: id,
    } as never);

  test('editing linked transactions updates the debt (ruling D2)', async () => {
    const paid = await ctx.add(E, 'PAID TO RAHUL', 5000, 5);
    const debt = await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(paid) });
    const back = await ctx.add(I, 'RECEIVED FROM RAHUL', 2000, 15);
    await addRepayment(ctx.uid, BigInt(debt.debt_id), { transaction_id: Number(back) });

    // Repayment edited up to the full amount: settles
    await edit(back, I, 5000, at(OCT, 16), 'RECEIVED FROM RAHUL');
    let d = (await listDebts(ctx.uid, NOW)).debts[0];
    expect(d).toMatchObject({ outstanding: 0, status: 'settled' });
    expect(d.payments[0]).toMatchObject({ amount: 5000, principal_part: 5000, date: at(OCT, 16) });

    // Origin edited up: principal and start follow, entry re-opens
    await edit(paid, E, 6000, at(OCT, 4), 'PAID TO RAHUL');
    d = (await listDebts(ctx.uid, NOW)).debts[0];
    expect(d).toMatchObject({ principal: 6000, start_date: at(OCT, 4), outstanding: 1000, status: 'open' });
  });

  test('changing the type of a debt-linked transaction gives 400 (ruling D4)', async () => {
    const paid = await ctx.add(E, 'PAID TO RAHUL', 5000, 5);
    await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(paid) });
    await expectThrowErrorCode(() => edit(paid, I, 5000, at(OCT, 5), 'PAID TO RAHUL'), 400);
    const row = await prisma.transactions.findUniqueOrThrow({ where: { transaction_id: paid } });
    expect(row.type).toBe(E);
  });

  test('hand-made names drop UPI prefixes from the key', async () => {
    const debt = await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Paid  to   Rahul', amount: 100, date: at(OCT, 1) });
    expect(debt.counterparty_key).toBe('RAHUL');
  });

  test('a repayment dated before the entry started gives 400', async () => {
    const debt = await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', amount: 1000, date: at(OCT, 10) });
    await expectThrowErrorCode(
      () => addRepayment(ctx.uid, BigInt(debt.debt_id), { amount: 100, date: at(OCT, 5) }),
      400
    );
    const early = await ctx.add(I, 'RECEIVED FROM RAHUL', 100, 5);
    await expectThrowErrorCode(
      () => addRepayment(ctx.uid, BigInt(debt.debt_id), { transaction_id: Number(early) }),
      400
    );
  });

  test('a row is never both a yearly cost and a debt', async () => {
    const cost = await createYearlyCost(ctx.uid, { name: 'Insurance', amount: 5000, due_month: 10 });
    const yearlyRow = await ctx.add(E, 'PAID TO RAHUL', 5000, 5);
    await linkYearlyCost(ctx.uid, yearlyRow, BigInt(cost.yearly_cost_id));
    await expectThrowErrorCode(
      () => createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(yearlyRow) }),
      400
    );
    const lentRow = await ctx.add(E, 'PAID TO RAHUL', 3000, 6);
    await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(lentRow) });
    await expectThrowErrorCode(() => linkYearlyCost(ctx.uid, lentRow, BigInt(cost.yearly_cost_id)), 400);

    const borrowed = await createPeopleDebt(ctx.uid, { kind: 'borrowed', name: 'Amit', amount: 1000, date: at(OCT, 1) });
    const cost2 = await createYearlyCost(ctx.uid, { name: 'Club', amount: 1000, due_month: 10 });
    const paidAmit = await ctx.add(E, 'PAID TO AMIT', 1000, 7);
    await linkYearlyCost(ctx.uid, paidAmit, BigInt(cost2.yearly_cost_id));
    await expectThrowErrorCode(
      () => addRepayment(ctx.uid, BigInt(borrowed.debt_id), { transaction_id: Number(paidAmit) }),
      400
    );
  });

  test('salary plan ignores a salary-category income that is money borrowed', async () => {
    const salaryCat = await prisma.categories.create({ data: { name: 'Salary', type: I, users_user_id: ctx.uid } });
    await updateFinancialProfile(ctx.uid, { salary_category_id: Number(salaryCat.category_id) });
    await TransactionService.createTransaction(ctx.uid, {
      account_to_id: ctx.bank.account_id,
      amount: 40000,
      type: I,
      description: 'RECEIVED FROM AMIT',
      date_timestamp: at({ year: 2026, month: 11 }, 3),
      is_essential: false,
      category_id: salaryCat.category_id,
    } as never);
    const row = await prisma.transactions.findFirstOrThrow({ orderBy: { transaction_id: 'desc' } });
    expect((await currentSalaryPlan(ctx.uid, NOW)).state).not.toBe('none');
    await createPeopleDebt(ctx.uid, { kind: 'borrowed', name: 'Amit', transaction_id: Number(row.transaction_id) });
    expect((await currentSalaryPlan(ctx.uid, NOW)).state).toBe('none');
  });

  test('restore refuses an unknown debt_role with 406', async () => {
    const paid = await ctx.add(E, 'PAID TO RAHUL', 5000, 5);
    await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', transaction_id: Number(paid) });
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    backup.transactions[0].debt_role = 'gift';
    await expectThrowErrorCode(() => UserService.restoreUser(ctx.uid, backup), 406);
    // Nothing was wiped
    expect(await prisma.debts.count({ where: { users_user_id: ctx.uid } })).toBe(1);
  });
});
