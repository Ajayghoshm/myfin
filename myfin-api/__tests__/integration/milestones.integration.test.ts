import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import { addRepayment, createPeopleDebt } from '../../src/services/debts/debtService.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import GoalService from '../../src/services/goalService.js';
import { type YearMonth, monthRangeIST } from '../../src/services/insights/insightsPrimitives.js';
import {
  dismissMilestone,
  evaluateMilestones,
  listMilestones,
} from '../../src/services/routines/milestoneService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';
import BackupManager from '../../src/utils/backupManager.js';
import { expectThrowErrorCode } from './utils/testUtils.js';

const DAY = 86_400;
const E = MYFIN.TRX_TYPES.EXPENSE;
const I = MYFIN.TRX_TYPES.INCOME;
const ym = (year: number, month: number): YearMonth => ({ year, month });
const at = (m: YearMonth, day: number) => monthRangeIST(m).from + (day - 1) * DAY + 3600;
const OCT = ym(2026, 10);
const SEP = ym(2026, 9);
const NOW = at(OCT, 28) + 9 * 3600; // 2026-10-28 10:00 IST

async function setup(username = 'ms') {
  const user = await UserService.createUser({ username, password: '123', email: `${username}@x.com` });
  const uid = user.user_id;
  const account = (name: string) =>
    AccountService.createAccount(
      {
        name,
        type: MYFIN.ACCOUNT_TYPES.CHECKING,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: uid,
      } as never,
      uid
    );
  const bank = await account('Bank');
  const trx = async (type: string, amount: number, date: number, accountId: bigint = bank.account_id) =>
    BigInt(
      (
        await TransactionService.createTransaction(uid, {
          account_from_id: type === E ? accountId : null,
          account_to_id: type === I ? accountId : null,
          amount,
          type,
          description: type === I ? 'Salary' : 'Spend',
          date_timestamp: date,
          is_essential: false,
        } as never)
      ).transaction_id
    );
  const login = await UserService.attemptLogin(username, '123', false);
  const headers = { authusername: username, sessionkey: login.sessionkey, 'content-type': 'application/json' };
  return { uid, bank, account, trx, headers };
}

const rows = async (uid: bigint, kind?: string) =>
  (
    await prisma.milestones.findMany({
      where: { users_user_id: uid, ...(kind ? { kind } : {}) },
      orderBy: { milestone_id: 'asc' },
    })
  ).map((r) => ({ kind: r.kind, key: r.key, dismissed: r.dismissed }));

const record = (uid: bigint, month: number, kind: 'health' | 'review', data: object, frozen = true) =>
  prisma.monthly_records.create({
    data: { users_user_id: uid, month, kind, data, frozen_at: frozen ? BigInt(NOW - 10 * DAY) : null },
  });

describe('milestones', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(async () => {
    ctx = await setup();
  });

  test('first evaluation: ₹1L and ₹5L are inserted, only ₹5L undismissed', async () => {
    await ctx.trx(I, 600000, at(SEP, 5));
    const shown = await evaluateMilestones(ctx.uid, NOW);
    expect(shown.map((m) => [m.kind, m.key])).toEqual([['net_worth', '500000']]);
    expect(shown[0]).toMatchObject({ dismissed: false, data: { amount: 500000 } });
    expect(await rows(ctx.uid)).toEqual([
      { kind: 'net_worth', key: '100000', dismissed: true },
      { kind: 'net_worth', key: '500000', dismissed: false },
    ]);
  });

  test('a dip and recovery never re-fires; reaching ₹10L inserts ₹10L', async () => {
    await ctx.trx(I, 600000, at(SEP, 5));
    await evaluateMilestones(ctx.uid, NOW);
    await ctx.trx(E, 200000, at(OCT, 10));
    await evaluateMilestones(ctx.uid, NOW);
    await ctx.trx(I, 200000, at(OCT, 12));
    await evaluateMilestones(ctx.uid, NOW);
    expect(await prisma.milestones.count({ where: { users_user_id: ctx.uid } })).toBe(2);

    await ctx.trx(I, 400000, at(OCT, 14));
    const shown = await evaluateMilestones(ctx.uid, NOW);
    expect(shown.map((m) => m.key).sort()).toEqual(['1000000', '500000']);
    expect(await rows(ctx.uid, 'net_worth')).toEqual([
      { kind: 'net_worth', key: '100000', dismissed: true },
      { kind: 'net_worth', key: '500000', dismissed: false },
      { kind: 'net_worth', key: '1000000', dismissed: false },
    ]);
  });

  test('a goal reaching full funding inserts goal_funded; settling a lent entry inserts debt_cleared', async () => {
    const savings = await ctx.account('Savings');
    await ctx.trx(I, 50000, at(SEP, 2), savings.account_id);
    await GoalService.createGoal(
      {
        name: 'Laptop',
        priority: 1,
        amount: 100000,
        funding_accounts: [{ account_id: Number(savings.account_id), funding_type: 'relative', funding_amount: 100 }],
      },
      ctx.uid
    );
    const debt = await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', amount: 5000, date: at(SEP, 3) });
    await evaluateMilestones(ctx.uid, NOW);
    expect(await rows(ctx.uid, 'goal_funded')).toEqual([]);
    expect(await rows(ctx.uid, 'debt_cleared')).toEqual([]);

    await ctx.trx(I, 50000, at(OCT, 2), savings.account_id);
    await addRepayment(ctx.uid, BigInt(debt.debt_id), { amount: 5000, date: at(OCT, 20) });
    const shown = await evaluateMilestones(ctx.uid, NOW);
    const goal = await prisma.goals.findFirstOrThrow({ where: { users_user_id: ctx.uid } });
    expect(shown.find((m) => m.kind === 'goal_funded')).toMatchObject({
      key: goal.goal_id.toString(),
      dismissed: false,
      data: { goal_id: goal.goal_id.toString(), name: 'Laptop' },
    });
    expect(shown.find((m) => m.kind === 'debt_cleared')).toMatchObject({
      key: debt.debt_id,
      dismissed: false,
      achieved_at: at(OCT, 20),
      data: { debt_id: debt.debt_id, name: 'Rahul', kind: 'lent' },
    });
  });

  test('first evaluation: goals and payment-less debts go to the timeline; a debt paid 5 days ago gets a banner', async () => {
    const savings = await ctx.account('Savings');
    await ctx.trx(I, 30000, at(SEP, 2), savings.account_id);
    for (const name of ['A', 'B', 'C'])
      await GoalService.createGoal(
        {
          name,
          priority: 1,
          amount: 10000,
          funding_accounts: [{ account_id: Number(savings.account_id), funding_type: 'absolute', funding_amount: 10000 }],
        },
        ctx.uid
      );
    const noPayments = await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Old', amount: 1000, date: at(SEP, 1) });
    await prisma.debts.update({ where: { debt_id: BigInt(noPayments.debt_id) }, data: { status: 'settled' } });
    const recent = await createPeopleDebt(ctx.uid, { kind: 'borrowed', name: 'Amit', amount: 2000, date: at(SEP, 1) });
    await addRepayment(ctx.uid, BigInt(recent.debt_id), { amount: 2000, date: NOW - 5 * DAY });

    const shown = await evaluateMilestones(ctx.uid, NOW);
    expect(shown.map((m) => [m.kind, m.key])).toEqual([['debt_cleared', recent.debt_id]]);
    expect((await rows(ctx.uid, 'goal_funded')).map((r) => r.dismissed)).toEqual([true, true, true]);
    expect(await rows(ctx.uid, 'debt_cleared')).toEqual([
      { kind: 'debt_cleared', key: noPayments.debt_id, dismissed: true },
      { kind: 'debt_cleared', key: recent.debt_id, dismissed: false },
    ]);
  });

  test('a new user evaluated with nothing still gets the banner for a goal funded later', async () => {
    expect(await evaluateMilestones(ctx.uid, NOW)).toEqual([]);
    expect(await prisma.milestones.count({ where: { users_user_id: ctx.uid } })).toBe(0);
    const profile = await prisma.user_financial_profile.findUniqueOrThrow({ where: { users_user_id: ctx.uid } });
    expect(profile.milestones_evaluated_at).toBe(BigInt(NOW));

    const savings = await ctx.account('Savings');
    await ctx.trx(I, 20000, at(OCT, 2), savings.account_id);
    await GoalService.createGoal(
      {
        name: 'Phone',
        priority: 1,
        amount: 20000,
        funding_accounts: [{ account_id: Number(savings.account_id), funding_type: 'absolute', funding_amount: 20000 }],
      },
      ctx.uid
    );
    const shown = await evaluateMilestones(ctx.uid, NOW + DAY);
    expect(shown.map((m) => [m.kind, m.dismissed])).toEqual([['goal_funded', false]]);
    // The first evaluation's time is kept
    const after = await prisma.user_financial_profile.findUniqueOrThrow({ where: { users_user_id: ctx.uid } });
    expect(after.milestones_evaluated_at).toBe(BigInt(NOW));
  });

  test('concurrent first evaluations apply the first-ever rule once', async () => {
    await ctx.trx(I, 600000, at(SEP, 5));
    await Promise.all([evaluateMilestones(ctx.uid, NOW), evaluateMilestones(ctx.uid, NOW)]);
    expect(await rows(ctx.uid)).toEqual([
      { kind: 'net_worth', key: '100000', dismissed: true },
      { kind: 'net_worth', key: '500000', dismissed: false },
    ]);
  });

  test('a frozen health month with every check passing inserts health_all_pass', async () => {
    await record(ctx.uid, 202607, 'health', { passed: 0, total: 0 }); // nothing set up: no
    await record(ctx.uid, 202608, 'health', { passed: 4, total: 5 });
    await record(ctx.uid, 202609, 'health', { passed: 5, total: 5 });
    await record(ctx.uid, 202610, 'health', { passed: 5, total: 5 }, false); // not frozen: no
    await evaluateMilestones(ctx.uid, NOW);
    expect(await rows(ctx.uid, 'health_all_pass')).toEqual([
      { kind: 'health_all_pass', key: '2026-09', dismissed: false },
    ]);
  });

  test('three consecutive complete frozen reviews insert review_streak; a 4-month run gives one', async () => {
    await record(ctx.uid, 202605, 'review', { complete: true });
    await record(ctx.uid, 202606, 'review', { complete: true });
    await record(ctx.uid, 202607, 'review', { complete: false });
    for (const m of [202608, 202609, 202610]) await record(ctx.uid, m, 'review', { complete: true });
    await evaluateMilestones(ctx.uid, NOW);
    expect(await rows(ctx.uid, 'review_streak')).toEqual([]);

    await record(ctx.uid, 202611, 'review', { complete: true });
    await record(ctx.uid, 202612, 'review', { complete: true });
    await evaluateMilestones(ctx.uid, at(ym(2027, 1), 20));
    expect(await rows(ctx.uid, 'review_streak')).toEqual([
      { kind: 'review_streak', key: '2026-10', dismissed: false },
    ]);
  });

  test('savings: the best month and a 3-month streak on target use ended months only', async () => {
    await updateFinancialProfile(ctx.uid, { savings_target_mode: 'percent', savings_target_value: 20 });
    const months: [YearMonth, number][] = [
      [ym(2026, 6), 90000], // 10 %
      [ym(2026, 7), 70000], // 30 %
      [ym(2026, 8), 75000], // 25 %
      [ym(2026, 9), 60000], // 40 %
      [OCT, 10000], // 90 %, but the month hasn't ended
    ];
    for (const [m, spend] of months) {
      await ctx.trx(I, 100000, at(m, 1));
      await ctx.trx(E, spend, at(m, 3));
    }
    await evaluateMilestones(ctx.uid, NOW);
    expect(await rows(ctx.uid, 'best_savings_month')).toEqual([
      { kind: 'best_savings_month', key: '2026-09', dismissed: false },
    ]);
    expect(await rows(ctx.uid, 'savings_streak')).toEqual([
      { kind: 'savings_streak', key: '2026-09', dismissed: false },
    ]);
  });

  test('dismiss hides the banner, the timeline still lists it; another user gets 401', async () => {
    await ctx.trx(I, 150000, at(SEP, 5));
    const [m] = await evaluateMilestones(ctx.uid, NOW);
    expect(m).toMatchObject({ kind: 'net_worth', key: '100000' });

    const evalRes = await fetch(`${base}/milestones/evaluate`, { method: 'POST', headers: ctx.headers });
    expect(evalRes.status).toBe(200);
    expect((await evalRes.json()).map((x: { key: string }) => x.key)).toEqual(['100000']);

    const other = await setup('ms2');
    await expectThrowErrorCode(() => dismissMilestone(other.uid, BigInt(m.milestone_id)), 401);
    const forbidden = await fetch(`${base}/milestones/${m.milestone_id}/dismiss`, {
      method: 'POST',
      headers: other.headers,
    });
    expect(forbidden.status).toBe(401);

    const dismissed = await fetch(`${base}/milestones/${m.milestone_id}/dismiss`, {
      method: 'POST',
      headers: ctx.headers,
    });
    expect(dismissed.status).toBe(200);
    expect(await evaluateMilestones(ctx.uid, NOW)).toEqual([]);
    const timeline = await (await fetch(`${base}/milestones`, { headers: ctx.headers })).json();
    expect(timeline).toMatchObject([{ kind: 'net_worth', key: '100000', dismissed: true }]);
    expect(await listMilestones(ctx.uid)).toHaveLength(1);
    expect((await fetch(`${base}/milestones/abc/dismiss`, { method: 'POST', headers: ctx.headers })).status).toBe(400);
  });

  test('backup: a JSON round trip keeps the milestones, remapping goal and debt ids', async () => {
    const savings = await ctx.account('Savings');
    await ctx.trx(I, 600000, at(SEP, 2), savings.account_id);
    await GoalService.createGoal(
      {
        name: 'Laptop',
        priority: 1,
        amount: 100000,
        funding_accounts: [{ account_id: Number(savings.account_id), funding_type: 'absolute', funding_amount: 100000 }],
      },
      ctx.uid
    );
    const debt = await createPeopleDebt(ctx.uid, { kind: 'lent', name: 'Rahul', amount: 5000, date: at(SEP, 3) });
    await addRepayment(ctx.uid, BigInt(debt.debt_id), { amount: 5000, date: at(OCT, 20) });
    await evaluateMilestones(ctx.uid, NOW);
    const before = await listMilestones(ctx.uid);
    expect(before.map((m) => m.kind).sort()).toEqual(['debt_cleared', 'goal_funded', 'net_worth', 'net_worth']);

    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    await UserService.restoreUser(ctx.uid, backup);
    const goal = await prisma.goals.findFirstOrThrow({ where: { users_user_id: ctx.uid } });
    const newDebt = await prisma.debts.findFirstOrThrow({ where: { users_user_id: ctx.uid } });
    expect(newDebt.debt_id.toString()).not.toBe(debt.debt_id);
    const after = await listMilestones(ctx.uid);
    const strip = (list: typeof before) =>
      list.map(({ milestone_id: _id, key: _k, data: _d, ...rest }) => rest);
    expect(strip(after)).toEqual(strip(before));
    expect(after.find((m) => m.kind === 'goal_funded')).toMatchObject({
      key: goal.goal_id.toString(),
      data: { goal_id: goal.goal_id.toString() },
    });
    expect(after.find((m) => m.kind === 'debt_cleared')).toMatchObject({
      key: newDebt.debt_id.toString(),
      data: { debt_id: newDebt.debt_id.toString() },
    });
    const evaluatedAt = async () =>
      (await prisma.user_financial_profile.findUniqueOrThrow({ where: { users_user_id: ctx.uid } }))
        .milestones_evaluated_at;
    expect(await evaluatedAt()).toBe(BigInt(NOW));
    // Evaluating again after the restore re-fires nothing
    await evaluateMilestones(ctx.uid, NOW);
    expect(await listMilestones(ctx.uid)).toHaveLength(4);

    // A malformed milestone is rejected before the wipe
    const broken = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    broken.milestones[0].kind = 'bogus';
    await expectThrowErrorCode(() => UserService.restoreUser(ctx.uid, broken), 406);
    expect(await listMilestones(ctx.uid)).toHaveLength(4);
    // An older backup without the key restores with no milestones
    const old = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    delete old.milestones;
    delete old.financial_profile.milestones_evaluated_at;
    await UserService.restoreUser(ctx.uid, old);
    expect(await listMilestones(ctx.uid)).toHaveLength(0);
    expect(await evaluatedAt()).toBeNull();
  });
});
