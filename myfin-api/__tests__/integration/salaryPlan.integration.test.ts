import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import { confirmMatch, createPlanned, listPlanned, markDone, skip } from '../../src/services/planning/plannedTransactionService.js';
import { confirmSalaryPlan, currentSalaryPlan } from '../../src/services/planning/salaryPlanService.js';
import { createYearlyCost } from '../../src/services/planning/yearlyCostService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';
import BackupManager from '../../src/utils/backupManager.js';

const DAY = 86_400;
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
const at = (ym: YearMonth, day: number) => monthRangeIST(ym).from + (day - 1) * DAY + 3600;
const OCT: YearMonth = { year: 2026, month: 10 };
const NOV: YearMonth = { year: 2026, month: 11 };
const SALARY_DATE = at(OCT, 26);
const NOW = SALARY_DATE + DAY; // 2026-10-27

async function setup() {
  const user = await UserService.createUser({ username: 'sp', password: '123', email: 'sp@x.com' });
  const uid = user.user_id;
  const mk = (name: string, extra: object = {}) =>
    prisma.accounts.create({
      data: {
        name,
        type: MYFIN.ACCOUNT_TYPES.SAVINGS,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: uid,
        ...extra,
      },
    });
  const bank = await AccountService.createAccount(
    { name: 'Bank', type: MYFIN.ACCOUNT_TYPES.CHECKING, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: uid },
    uid
  );
  const sinking = await mk('Sinking');
  const emergency = await mk('Emergency', { is_emergency_fund: true });
  const savings = await mk('Savings');
  const salaryCat = await prisma.categories.create({ data: { name: 'Salary', type: I, users_user_id: uid } });
  const rent = await prisma.categories.create({ data: { name: 'Rent', type: E, users_user_id: uid, is_fixed: true } });
  await updateFinancialProfile(uid, {
    salary_category_id: salaryCat.category_id,
    salary_cutoff_day: 25,
    savings_target_mode: 'percent',
    savings_target_value: 20,
    savings_target_account_id: savings.account_id,
    sinking_fund_account_id: sinking.account_id,
    emergency_topup_percent: 10,
  });
  // Fixed rent of 30,000 in each of the 3 baseline months
  for (const ym of [{ year: 2026, month: 8 }, { year: 2026, month: 9 }, OCT])
    await TransactionService.createTransaction(uid, {
      account_from_id: bank.account_id,
      amount: 30000,
      type: E,
      category_id: rent.category_id,
      description: 'Paid to LANDLORD',
      date_timestamp: at(ym, 2),
      is_essential: false,
    } as never);
  await createYearlyCost(uid, { name: 'Insurance', amount: 12000, due_month: 3 });
  const income = (amount: number, ts: number) =>
    TransactionService.createTransaction(uid, {
      account_to_id: bank.account_id,
      amount,
      type: I,
      category_id: salaryCat.category_id,
      description: 'Salary',
      date_timestamp: ts,
      is_essential: false,
    } as never);
  return { uid, bank, sinking, emergency, savings, salaryCat, income };
}

type Ctx = Awaited<ReturnType<typeof setup>>;
const confirmDefault = async (ctx: Ctx, salaryTrxId: bigint, overrides: object[] = []) =>
  confirmSalaryPlan(ctx.uid, {
    month: '2026-11',
    salary_transaction_id: salaryTrxId,
    buckets: [
      { bucket: 'fixed', amount: 30000, account_to_id: null },
      { bucket: 'yearly', amount: 1000, account_to_id: ctx.sinking.account_id },
      { bucket: 'emergency', amount: 10000, account_to_id: ctx.emergency.account_id },
      { bucket: 'savings', amount: 20000, account_to_id: ctx.savings.account_id },
      { bucket: 'free', amount: 39000, account_to_id: null },
      ...overrides,
    ] as never,
  });

describe('salary-day plan', () => {
  let ctx: Ctx;
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

  test('none without a salary; proposal for the next month after a late salary', async () => {
    expect((await currentSalaryPlan(ctx.uid, NOW)).state).toBe('none');
    const salary = await ctx.income(100000, SALARY_DATE);
    const r = await currentSalaryPlan(ctx.uid, NOW);
    expect(r.state).toBe('proposal');
    expect(r.month).toBe('2026-11');
    expect(r.salary).toEqual({ transaction_id: salary.transaction_id.toString(), amount: 100000, date: SALARY_DATE });
    expect(r.buckets.map((b) => [b.bucket, b.amount, b.state])).toEqual([
      ['fixed', 30000, 'none'],
      ['yearly', 1000, 'none'],
      ['emergency', 10000, 'none'],
      ['savings', 20000, 'none'],
      ['free', 39000, 'none'],
    ]);
    expect(r.buckets[1].account_to_id).toBe(ctx.sinking.account_id.toString());
    expect(r.buckets[2].account_to_id).toBe(ctx.emergency.account_id.toString());
    expect(r.buckets[3].account_to_id).toBe(ctx.savings.account_id.toString());
  });

  test('B7: enabling the salary category late proposes the current effective month, not a stale one', async () => {
    const SEP: YearMonth = { year: 2026, month: 9 };
    await ctx.income(100000, at(SEP, 28));
    const oct = await ctx.income(100000, at(OCT, 28));
    const r = await currentSalaryPlan(ctx.uid, at(OCT, 29));
    expect(r.state).toBe('proposal');
    expect(r.month).toBe('2026-11');
    expect(r.salary?.transaction_id).toBe(oct.transaction_id.toString());
  });

  test('B7: before this month\'s salary lands, an unplanned older month is not proposed', async () => {
    const SEP: YearMonth = { year: 2026, month: 9 };
    // Sep 28 pays for October; on Oct 20 the current effective month is October, so it is proposed
    await ctx.income(100000, at(SEP, 28));
    expect((await currentSalaryPlan(ctx.uid, at(OCT, 20))).month).toBe('2026-10');
    // On Nov 3 the current effective month is November: October's plan is stale
    expect((await currentSalaryPlan(ctx.uid, at(NOV, 3))).state).toBe('none');
  });

  test('a salary older than 40 days gives no proposal', async () => {
    await ctx.income(100000, SALARY_DATE);
    expect((await currentSalaryPlan(ctx.uid, SALARY_DATE + 41 * DAY)).state).toBe('none');
  });

  test('confirm creates three planned rows; a second salary in the month offers no new plan', async () => {
    const salary = await ctx.income(100000, SALARY_DATE);
    await confirmDefault(ctx, salary.transaction_id);
    const planned = await listPlanned(ctx.uid);
    expect(planned).toHaveLength(3);
    expect(planned.every((p) => p.type === 'T' && p.account_from_id === ctx.bank.account_id.toString())).toBe(true);
    expect(planned.every((p) => p.date_timestamp === SALARY_DATE && p.salary_plan_id != null)).toBe(true);
    expect(planned.map((p) => p.bucket).sort()).toEqual(['emergency', 'savings', 'yearly']);

    const r = await currentSalaryPlan(ctx.uid, NOW);
    expect(r.state).toBe('confirmed');
    expect(r.buckets.filter((b) => b.state === 'planned')).toHaveLength(3);

    await ctx.income(5000, at(NOV, 5));
    const later = await currentSalaryPlan(ctx.uid, at(NOV, 6));
    expect(later.state).toBe('confirmed');
    expect(later.month).toBe('2026-11');
  });

  test('bucket without an account has state none and no planned row; free may be negative', async () => {
    const salary = await ctx.income(100000, SALARY_DATE);
    await confirmSalaryPlan(ctx.uid, {
      month: '2026-11',
      salary_transaction_id: salary.transaction_id,
      buckets: [
        { bucket: 'fixed', amount: 90000, account_to_id: null },
        { bucket: 'yearly', amount: 1000, account_to_id: null },
        { bucket: 'emergency', amount: 10000, account_to_id: ctx.emergency.account_id },
        { bucket: 'savings', amount: 0, account_to_id: ctx.savings.account_id },
        { bucket: 'free', amount: 0, account_to_id: null },
      ],
    });
    expect(await listPlanned(ctx.uid)).toHaveLength(1);
    const r = await currentSalaryPlan(ctx.uid, NOW);
    const by = Object.fromEntries(r.buckets.map((b) => [b.bucket, b]));
    expect(by.yearly.state).toBe('none');
    expect(by.savings.state).toBe('none');
    expect(by.emergency.state).toBe('planned');
    expect(by.free.amount).toBe(-1000);
  });

  test('done and skipped update the bucket states', async () => {
    const salary = await ctx.income(100000, SALARY_DATE);
    await confirmDefault(ctx, salary.transaction_id);
    const planned = await listPlanned(ctx.uid);
    const byBucket = (b: string) => planned.find((p) => p.bucket === b)!;
    const trxId = await markDone(ctx.uid, BigInt(byBucket('yearly').planned_id), NOW);
    await skip(ctx.uid, BigInt(byBucket('savings').planned_id));
    const r = await currentSalaryPlan(ctx.uid, NOW);
    const by = Object.fromEntries(r.buckets.map((b) => [b.bucket, b]));
    expect(by.yearly).toMatchObject({ state: 'done', transaction_id: trxId.toString() });
    expect(by.savings).toMatchObject({ state: 'skipped', transaction_id: null });
    expect(by.emergency.state).toBe('planned');
    expect(r.buckets.filter((b) => b.state === 'done').length).toBe(1);

    const res = await fetchJson('/salary-plan/2026-11');
    expect(res.status).toBe(200);
    expect(res.body.buckets.filter((b: { state: string }) => b.state === 'done')).toHaveLength(1);
  });

  test('a transaction already recorded for a plan bucket cannot match another planned row', async () => {
    const salary = await ctx.income(100000, SALARY_DATE);
    await confirmDefault(ctx, salary.transaction_id);
    const yearly = (await listPlanned(ctx.uid)).find((p) => p.bucket === 'yearly')!;
    const trxId = await markDone(ctx.uid, BigInt(yearly.planned_id), NOW);
    const [again] = await prisma.$transaction((tx) =>
      createPlanned(
        ctx.uid,
        [
          {
            date_timestamp: SALARY_DATE,
            amount: 1000_00,
            type: 'T',
            account_from_id: ctx.bank.account_id,
            account_to_id: ctx.sinking.account_id,
            description: 'Duplicate',
          },
        ],
        tx as never
      )
    );
    await expect(confirmMatch(ctx.uid, again, trxId)).rejects.toMatchObject({ code: 400 });
    expect((await listPlanned(ctx.uid)).some((p) => p.planned_id === again.toString())).toBe(true);
  });

  test('confirm rejects inactive accounts, the salary account and earmark-conflicting targets', async () => {
    const salary = await ctx.income(100000, SALARY_DATE);
    const inactive = await prisma.accounts.create({
      data: {
        name: 'Old',
        type: MYFIN.ACCOUNT_TYPES.SAVINGS,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.INACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: ctx.uid,
      },
    });
    for (const override of [
      { bucket: 'savings', amount: 20000, account_to_id: inactive.account_id },
      { bucket: 'savings', amount: 20000, account_to_id: ctx.bank.account_id },
      { bucket: 'savings', amount: 20000, account_to_id: ctx.emergency.account_id },
      { bucket: 'emergency', amount: 10000, account_to_id: ctx.sinking.account_id },
    ]) {
      await expect(
        confirmSalaryPlan(ctx.uid, {
          month: '2026-11',
          salary_transaction_id: salary.transaction_id,
          buckets: [
            { bucket: 'fixed', amount: 30000, account_to_id: null },
            { bucket: 'yearly', amount: 1000, account_to_id: ctx.sinking.account_id },
            { bucket: 'emergency', amount: 10000, account_to_id: ctx.emergency.account_id },
            { bucket: 'savings', amount: 20000, account_to_id: ctx.savings.account_id },
            override,
          ].filter((b, i, all) => all.findLastIndex((x) => x.bucket === b.bucket) === i) as never,
        })
      ).rejects.toMatchObject({ code: 400 });
    }
    expect(await prisma.salary_plans.count({ where: { users_user_id: ctx.uid } })).toBe(0);
  });

  test('deleting an account marks the buckets of its cascade-deleted planned rows as skipped', async () => {
    const salary = await ctx.income(100000, SALARY_DATE);
    await confirmDefault(ctx, salary.transaction_id);
    await AccountService.deleteAccount(ctx.savings.account_id);
    expect((await listPlanned(ctx.uid)).map((p) => p.bucket).sort()).toEqual(['emergency', 'yearly']);
    const r = await currentSalaryPlan(ctx.uid, NOW);
    const by = Object.fromEntries(r.buckets.map((b) => [b.bucket, b]));
    expect(by.savings.state).toBe('skipped');
    expect(by.yearly.state).toBe('planned');
  });

  test('overdue is a planned row more than 15 days past its date', async () => {
    const salary = await ctx.income(100000, SALARY_DATE);
    await confirmDefault(ctx, salary.transaction_id);
    const soon = await currentSalaryPlan(ctx.uid, SALARY_DATE + 15 * DAY);
    expect(soon.buckets.some((b) => b.overdue)).toBe(false);
    const late = await currentSalaryPlan(ctx.uid, SALARY_DATE + 16 * DAY);
    expect(late.buckets.filter((b) => b.overdue)).toHaveLength(3);
    expect(late.buckets.find((b) => b.bucket === 'free')!.overdue).toBe(false);
  });

  test('confirming twice for one month gives 409; wrong month or wrong transaction gives 400', async () => {
    const salary = await ctx.income(100000, SALARY_DATE);
    await confirmDefault(ctx, salary.transaction_id);
    await expect(confirmDefault(ctx, salary.transaction_id)).rejects.toMatchObject({ code: 409 });
    expect(await listPlanned(ctx.uid)).toHaveLength(3);
    await expect(
      confirmSalaryPlan(ctx.uid, { month: '2026-10', salary_transaction_id: salary.transaction_id, buckets: [] })
    ).rejects.toMatchObject({ code: 400 });
    const other = await TransactionService.createTransaction(ctx.uid, {
      account_from_id: ctx.bank.account_id,
      amount: 5,
      type: E,
      description: 'x',
      date_timestamp: SALARY_DATE,
      is_essential: false,
    } as never);
    await expect(
      confirmSalaryPlan(ctx.uid, { month: '2026-11', salary_transaction_id: other.transaction_id, buckets: [] })
    ).rejects.toMatchObject({ code: 400 });
  });

  test('a brand-new user gets state none, not an error', async () => {
    const u = await UserService.createUser({ username: 'fresh', password: '123', email: 'f@x.com' });
    expect(await currentSalaryPlan(u.user_id, NOW)).toEqual({ state: 'none', month: null, salary: null, buckets: [] });
  });

  test('a JSON round-tripped backup restores plans with remapped planned and transaction ids', async () => {
    const salary = await ctx.income(100000, SALARY_DATE);
    await confirmDefault(ctx, salary.transaction_id);
    const planned = await listPlanned(ctx.uid);
    const done = planned.find((p) => p.bucket === 'yearly')!;
    await markDone(ctx.uid, BigInt(done.planned_id), NOW);
    await skip(ctx.uid, BigInt(planned.find((p) => p.bucket === 'savings')!.planned_id));

    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    expect(backup.salary_plans).toHaveLength(1);
    await UserService.restoreUser(ctx.uid, backup);

    const restoredPlanned = await listPlanned(ctx.uid);
    expect(restoredPlanned).toHaveLength(1);
    const plan = await prisma.salary_plans.findFirstOrThrow({ where: { users_user_id: ctx.uid } });
    expect(plan.month).toBe(202611);
    expect(restoredPlanned[0].salary_plan_id).toBe(plan.salary_plan_id.toString());
    const newSalary = await prisma.transactions.findFirstOrThrow({
      where: { type: I, accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: ctx.uid } },
    });
    expect(plan.salary_transaction_id).toBe(newSalary.transaction_id);

    const r = await currentSalaryPlan(ctx.uid, NOW);
    expect(r.state).toBe('confirmed');
    const by = Object.fromEntries(r.buckets.map((b) => [b.bucket, b]));
    expect(by.emergency).toMatchObject({ state: 'planned', planned_id: restoredPlanned[0].planned_id });
    expect(by.yearly.state).toBe('done');
    const yearlyTrx = await prisma.transactions.findFirstOrThrow({
      where: { type: 'T', accounts_transactions_accounts_account_to_idToaccounts: { users_user_id: ctx.uid } },
    });
    expect(by.yearly.transaction_id).toBe(yearlyTrx.transaction_id.toString());
    expect(by.savings.state).toBe('skipped');
  });

  async function fetchJson(path: string, init?: RequestInit) {
    const login = await UserService.attemptLogin('sp', '123', false);
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { authusername: 'sp', sessionkey: login.sessionkey, 'content-type': 'application/json' },
    });
    return { status: res.status, body: await res.json() };
  }

  test('HTTP: current, confirm, duplicate 409, and view', async () => {
    const salary = await ctx.income(100000, Math.floor(Date.now() / 1000) - DAY);
    const cur = await fetchJson('/salary-plan/current');
    expect(cur.status).toBe(200);
    // Only a proposal when the recent salary maps to a month; either way the shape is valid
    expect(['proposal', 'confirmed', 'none']).toContain(cur.body.state);
    const month = cur.body.month as string;
    expect(month).toMatch(/^\d{4}-\d{2}$/);
    const payload = {
      month,
      salary_transaction_id: Number(salary.transaction_id),
      buckets: cur.body.buckets.map((b: { bucket: string; amount: number; account_to_id: string | null }) => ({
        bucket: b.bucket,
        amount: b.amount,
        account_to_id: b.account_to_id == null ? null : Number(b.account_to_id),
      })),
    };
    const first = await fetchJson('/salary-plan', { method: 'POST', body: JSON.stringify(payload) });
    expect(first.status).toBe(200);
    const second = await fetchJson('/salary-plan', { method: 'POST', body: JSON.stringify(payload) });
    expect(second.status).toBe(409);
    const view = await fetchJson(`/salary-plan/${month}`);
    expect(view.status).toBe(200);
    expect(view.body.month).toBe(month);
    expect((await fetchJson('/salary-plan/2020-01')).status).toBe(404);
  });
});
