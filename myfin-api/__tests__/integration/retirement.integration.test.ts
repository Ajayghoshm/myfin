import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import { monthRangeIST, type YearMonth } from '../../src/services/insights/insightsPrimitives.js';
import { getFinancialProfile, updateFinancialProfile } from '../../src/services/financialProfileService.js';
import AccountService from '../../src/services/accountService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';
import { getRetirement, saveWhatIf } from '../../src/services/wealth/retirementService.js';
import BackupManager from '../../src/utils/backupManager.js';
import { expectThrowErrorCode } from './utils/testUtils.js';

const DAY = 86_400;
const AUG: YearMonth = { year: 2026, month: 8 };
const SEP: YearMonth = { year: 2026, month: 9 };
const OCT: YearMonth = { year: 2026, month: 10 };
const NOW = monthRangeIST({ year: 2026, month: 11 }).from + DAY;
const E = MYFIN.TRX_TYPES.EXPENSE;

async function setup() {
  const user = await UserService.createUser({ username: 'ret', password: '123', email: 'ret@x.com' });
  const uid = user.user_id;
  const mkAcc = (name: string, balance: number, type: string = MYFIN.ACCOUNT_TYPES.CHECKING, extra = {}) =>
    prisma.accounts.create({
      data: {
        name,
        type,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: Math.round(balance * 100),
        users_user_id: uid,
        ...extra,
      },
    });
  const bank = await mkAcc('Bank', 0);
  const addSpending = async () => {
    const rent = await prisma.categories.create({ data: { name: 'Rent', type: E, users_user_id: uid, is_fixed: true } });
    const food = await prisma.categories.create({ data: { name: 'Food', type: E, users_user_id: uid, is_fixed: false } });
    for (const ym of [AUG, SEP, OCT])
      for (const [cat, amount, who] of [[rent, 10000, 'LANDLORD'], [food, 5000, 'SHOP']] as const)
        await TransactionService.createTransaction(uid, {
          account_from_id: bank.account_id,
          account_to_id: null,
          amount,
          category_id: cat.category_id,
          date_timestamp: monthRangeIST(ym).from + 2 * DAY,
          description: `Paid to ${who}`,
          entity_id: null,
          is_essential: false,
          tags: [],
          type: E,
        });
  };
  const asset = async (name: string, valueCents: number) => {
    const a = await prisma.invest_assets.create({
      data: { name, type: Object.values(MYFIN.INVEST.ASSET_TYPE)[0], units: 1, created_at: 1, users_user_id: uid },
    });
    await prisma.invest_asset_evo_snapshot.create({
      data: {
        month: 10,
        year: 2026,
        units: 1,
        invested_amount: valueCents,
        current_value: valueCents,
        invest_assets_asset_id: a.asset_id,
        created_at: 1,
        updated_at: 1,
        withdrawn_amount: 0,
      },
    });
    return a;
  };
  /** An income (positive) or expense (negative) on `account`, dated `date`. */
  const move = (account: { account_id: bigint }, amount: number, date: number) =>
    TransactionService.createTransaction(uid, {
      account_from_id: amount < 0 ? account.account_id : null,
      account_to_id: amount < 0 ? null : account.account_id,
      amount: Math.abs(amount),
      date_timestamp: date,
      description: 'Move',
      entity_id: null,
      is_essential: false,
      tags: [],
      type: amount < 0 ? E : MYFIN.TRX_TYPES.INCOME,
    } as never);
  return { uid, mkAcc, addSpending, asset, move };
}

describe('retirement calculator', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  test('no date of birth, no history: figures are null and the reasons listed', async () => {
    const r = await getRetirement(ctx.uid, { now: NOW });
    expect(r.missing).toEqual(expect.arrayContaining(['date_of_birth', 'spending_history']));
    expect(r.corpus_needed).toBeNull();
    expect(r.on_track_age).toBeNull();
    expect(r.extra_monthly_needed).toBeNull();
    expect(r.projection).toEqual([]);
  });

  test('full figures with a date of birth and history', async () => {
    await ctx.addSpending();
    await updateFinancialProfile(ctx.uid, { date_of_birth: '1996-06-15', savings_target_value: 10000 });
    const r = await getRetirement(ctx.uid, { now: NOW });
    expect(r.missing).toEqual([]);
    expect(r.inputs).toMatchObject({ age: 30, retirement_age: 60, annual_spending_today: 180000, monthly_investment: 10000 });
    expect(Math.round(r.corpus_needed?.today ?? 0)).toBe(Math.round(180000 / 0.035));
    expect(r.projection[0].age).toBe(30);
    expect(r.projection[r.projection.length - 1].age).toBe(90);
    expect(r.extra_monthly_needed).toBeGreaterThanOrEqual(0);
    await updateFinancialProfile(ctx.uid, { retirement_spending_basis: 'fixed' });
    expect((await getRetirement(ctx.uid, { now: NOW })).inputs?.annual_spending_today).toBe(120000);
  });

  test('swr of 0 is rejected; bad dates and ages are rejected', async () => {
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { swr_pct: 0 }), 400);
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { date_of_birth: '2030-01-01' }), 400);
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { date_of_birth: '1996-02-31' }), 400);
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { retirement_age: 81 }), 400);
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { inflation_pct: 25 }), 400);
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { date_of_birth: '1966-01-01' }), 400); // age 60 = retirement age 60
    await updateFinancialProfile(ctx.uid, { date_of_birth: '1966-01-01', retirement_age: 70 });
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { retirement_age: 50 }), 400);
  });

  test('what-if overrides do not change the profile; save-what-if persists them', async () => {
    await ctx.addSpending();
    await updateFinancialProfile(ctx.uid, { date_of_birth: '1996-06-15' });
    const before = await getFinancialProfile(ctx.uid);
    const base = await getRetirement(ctx.uid, { now: NOW });
    const what = await getRetirement(ctx.uid, { now: NOW, overrides: { returnPct: 12, retirementAge: 55, monthlyInvestment: 5000 } });
    expect(what.inputs).toMatchObject({ return_pct: 12, retirement_age: 55, monthly_investment: 5000 });
    expect(what.corpus_needed?.future).not.toBe(base.corpus_needed?.future);
    expect(await getFinancialProfile(ctx.uid)).toEqual(before);

    await saveWhatIf(ctx.uid, { returnPct: 12, inflationPct: 5, swrPct: 4, retirementAge: 55, monthlyInvestment: 5000 }, NOW);
    expect(await getFinancialProfile(ctx.uid)).toMatchObject({
      expected_return_pct: 12,
      inflation_pct: 5,
      swr_pct: 4,
      retirement_age: 55,
      savings_target_mode: 'amount',
      savings_target_value: 5000,
    });
    await expectThrowErrorCode(() => saveWhatIf(ctx.uid, { retirementAge: 29 }, NOW), 400);
  });

  test('corpus counts active ticked accounts at their balance as of now (negatives as 0) and assets at value, never INVAC balances', async () => {
    await ctx.addSpending();
    const past = monthRangeIST(OCT).from + 10 * DAY;
    const a = await ctx.mkAcc('Savings', 0, MYFIN.ACCOUNT_TYPES.SAVINGS);
    await ctx.move(a, 50000, past);
    await ctx.move(a, 70000, NOW + 5 * DAY); // future-dated: not yet in the corpus
    const neg = await ctx.mkAcc('Overdrawn', 0);
    await ctx.move(neg, -3000, past);
    const closed = await ctx.mkAcc('Closed', 0);
    await ctx.move(closed, 40000, past);
    await ctx.mkAcc('Unticked', 99999);
    const inv = await ctx.mkAcc('Broker', 777777, MYFIN.ACCOUNT_TYPES.INVESTING, { is_retirement: true });
    const asset = await ctx.asset('Fund', 2_500_000);
    await ctx.asset('Other', 9_900_000);
    await updateFinancialProfile(ctx.uid, {
      date_of_birth: '1996-06-15',
      retirement_account_ids: [Number(a.account_id), Number(neg.account_id), Number(closed.account_id)],
      retirement_asset_ids: [Number(asset.asset_id)],
    });
    await prisma.accounts.update({ where: { account_id: closed.account_id }, data: { status: MYFIN.ACCOUNT_STATUS.INACTIVE } });
    const r = await getRetirement(ctx.uid, { now: NOW });
    expect(r.inputs?.current_corpus).toBe(50000 + 25000);
    expect(inv.is_retirement).toBe(true);
    const p = await getFinancialProfile(ctx.uid);
    expect(p.retirement_account_ids.sort()).toEqual(
      [String(a.account_id), String(neg.account_id), String(closed.account_id)].sort()
    );
    expect(p.retirement_asset_ids).toEqual([String(asset.asset_id)]);
  });

  test("basis 'all' adds the yearly set-aside to annual spending (ruling D8); 'fixed' does not", async () => {
    await ctx.addSpending();
    await prisma.yearly_costs.create({
      data: { users_user_id: ctx.uid, name: 'Insurance', amount: 1_200_000n, due_month: 3, active: true, created_at: 1n },
    });
    await updateFinancialProfile(ctx.uid, { date_of_birth: '1996-06-15' });
    expect((await getRetirement(ctx.uid, { now: NOW })).inputs?.annual_spending_today).toBe(180000 + 12000);
    await updateFinancialProfile(ctx.uid, { retirement_spending_basis: 'fixed' });
    expect((await getRetirement(ctx.uid, { now: NOW })).inputs?.annual_spending_today).toBe(120000);
  });

  test('retirement_age is checked against the age only when it or the date of birth changes', async () => {
    await updateFinancialProfile(ctx.uid, { date_of_birth: '1980-01-01', retirement_age: 50 });
    // Time passes: the stored retirement age is now at or below the current age
    await prisma.user_financial_profile.update({ where: { users_user_id: ctx.uid }, data: { retirement_age: 40 } });
    const saved = await updateFinancialProfile(ctx.uid, { retirement_age: 40, date_of_birth: '1980-01-01', expected_return_pct: 9 });
    expect(saved).toMatchObject({ retirement_age: 40, expected_return_pct: 9 });
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { retirement_age: 41 }), 400);
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { date_of_birth: '1979-01-01' }), 400);
  });

  test("another user's account or asset ids, and a loan account, cannot be ticked; a retirement account cannot become emergency", async () => {
    const other = await UserService.createUser({ username: 'ret2', password: '123', email: 'ret2@x.com' });
    const theirAcc = await prisma.accounts.create({
      data: { name: 'Theirs', type: MYFIN.ACCOUNT_TYPES.SAVINGS, description: '', status: MYFIN.ACCOUNT_STATUS.ACTIVE, exclude_from_budgets: false, current_balance: 0, users_user_id: other.user_id },
    });
    const theirAsset = await prisma.invest_assets.create({
      data: { name: 'TheirFund', type: Object.values(MYFIN.INVEST.ASSET_TYPE)[0], units: 1, created_at: 1, users_user_id: other.user_id },
    });
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { retirement_account_ids: [Number(theirAcc.account_id)] }), 400);
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { retirement_asset_ids: [Number(theirAsset.asset_id)] }), 400);
    const loanAc = await ctx.mkAcc('HDFC loan', 0, MYFIN.ACCOUNT_TYPES.LOAN);
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { retirement_account_ids: [Number(loanAc.account_id)] }), 400);

    const ok = await ctx.mkAcc('Ok', 0, MYFIN.ACCOUNT_TYPES.SAVINGS);
    await updateFinancialProfile(ctx.uid, { retirement_account_ids: [Number(ok.account_id)] });
    await expectThrowErrorCode(
      () =>
        AccountService.updateAccount(
          {
            account_id: ok.account_id,
            new_name: 'Ok',
            new_type: MYFIN.ACCOUNT_TYPES.SAVINGS,
            new_description: '',
            new_status: MYFIN.ACCOUNT_STATUS.ACTIVE,
            exclude_from_budgets: false,
            current_balance: 0,
            new_is_emergency_fund: true,
            users_user_id: ctx.uid,
          },
          ctx.uid
        ),
      400
    );
    expect((await prisma.accounts.findUniqueOrThrow({ where: { account_id: ok.account_id } })).is_emergency_fund).toBe(false);
  });

  test('restore rejects out-of-range retirement fields with 406 before wiping anything', async () => {
    await updateFinancialProfile(ctx.uid, { date_of_birth: '1990-03-04' });
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    const bad: Array<Record<string, unknown>> = [
      { expected_return_pct: 31 },
      { expected_return_pct: 'abc' },
      { inflation_pct: -1 },
      { inflation_pct: 21 },
      { swr_pct: 0.5 },
      { swr_pct: 11 },
      { retirement_age: 81 },
      { retirement_age: 55.5 },
      { date_of_birth: '1990-02-31' },
      { date_of_birth: 12 },
      { family_support_monthly: -5 },
      { family_support_monthly: '1.5' },
      { family_support_years: -1 },
      { retirement_spending_basis: 'some' },
      { savings_target_value: 'x' },
      { small_spend_cutoff: 1.5 },
    ];
    for (const b of bad) {
      const body = { ...backup, financial_profile: { ...backup.financial_profile, ...b } };
      await expectThrowErrorCode(() => UserService.restoreUser(ctx.uid, body), 406);
    }
    expect((await getFinancialProfile(ctx.uid)).date_of_birth).toBe('1990-03-04');
    expect(await prisma.accounts.count({ where: { users_user_id: ctx.uid } })).toBe(1);
    // A null date of birth and string cents are fine
    await UserService.restoreUser(ctx.uid, {
      ...backup,
      financial_profile: { ...backup.financial_profile, date_of_birth: null, family_support_monthly: '120000' },
    });
    expect(await getFinancialProfile(ctx.uid)).toMatchObject({ date_of_birth: null, family_support_monthly: 1200 });
  });

  test('earmark rules: not emergency, sinking, INVAC or debt accounts; may overlap the savings target', async () => {
    const em = await ctx.mkAcc('Emergency', 0, MYFIN.ACCOUNT_TYPES.CHECKING, { is_emergency_fund: true });
    const sink = await ctx.mkAcc('Sinking', 0);
    const inv = await ctx.mkAcc('Broker', 0, MYFIN.ACCOUNT_TYPES.INVESTING);
    const card = await ctx.mkAcc('Card', 0, MYFIN.ACCOUNT_TYPES.CREDIT);
    const ok = await ctx.mkAcc('Ok', 0);
    await updateFinancialProfile(ctx.uid, { sinking_fund_account_id: Number(sink.account_id) });
    for (const acc of [em, sink, inv, card])
      await expectThrowErrorCode(
        () => updateFinancialProfile(ctx.uid, { retirement_account_ids: [Number(acc.account_id)] }),
        400
      );
    await updateFinancialProfile(ctx.uid, {
      savings_target_account_id: Number(ok.account_id),
      retirement_account_ids: [Number(ok.account_id)],
    });
    // The other direction: a retirement account cannot become sinking or emergency
    await expectThrowErrorCode(() => updateFinancialProfile(ctx.uid, { sinking_fund_account_id: Number(ok.account_id) }), 400);
  });

  test('a JSON backup round-trip keeps the retirement fields and flags', async () => {
    const a = await ctx.mkAcc('Savings', 100, MYFIN.ACCOUNT_TYPES.SAVINGS);
    const asset = await ctx.asset('Fund', 100_000);
    await updateFinancialProfile(ctx.uid, {
      date_of_birth: '1990-03-04',
      retirement_age: 58,
      expected_return_pct: 9.5,
      inflation_pct: 5.5,
      swr_pct: 3.25,
      retirement_spending_basis: 'fixed',
      family_support_monthly: 12000,
      family_support_years: 8,
      retirement_account_ids: [Number(a.account_id)],
      retirement_asset_ids: [Number(asset.asset_id)],
    });
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    await UserService.restoreUser(ctx.uid, backup);
    const p = await getFinancialProfile(ctx.uid);
    expect(p).toMatchObject({
      date_of_birth: '1990-03-04',
      retirement_age: 58,
      expected_return_pct: 9.5,
      inflation_pct: 5.5,
      swr_pct: 3.25,
      retirement_spending_basis: 'fixed',
      family_support_monthly: 12000,
      family_support_years: 8,
    });
    expect(p.retirement_account_ids).toHaveLength(1);
    expect(p.retirement_asset_ids).toHaveLength(1);
    expect((await prisma.accounts.findFirstOrThrow({ where: { users_user_id: ctx.uid, name: 'Savings' } })).is_retirement).toBe(true);
  });

  test('an old backup without the fields restores with defaults', async () => {
    await updateFinancialProfile(ctx.uid, { emergency_fund_target_months: 5 });
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(ctx.uid)));
    for (const k of ['date_of_birth', 'retirement_age', 'expected_return_pct', 'inflation_pct', 'swr_pct', 'retirement_spending_basis', 'family_support_monthly', 'family_support_years'])
      delete backup.financial_profile[k];
    for (const a of backup.accounts) delete a.is_retirement;
    await UserService.restoreUser(ctx.uid, backup);
    expect(await getFinancialProfile(ctx.uid)).toMatchObject({
      date_of_birth: null,
      retirement_age: 60,
      expected_return_pct: 10,
      inflation_pct: 6,
      swr_pct: 3.5,
      retirement_spending_basis: 'all',
      family_support_monthly: 0,
      family_support_years: 0,
    });
  });
});
