import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import { emergencyAccountIds } from '../../src/services/earmarkService.js';
import {
  getFinancialProfile,
  updateFinancialProfile,
} from '../../src/services/financialProfileService.js';
import UserService from '../../src/services/userService.js';
import BackupManager from '../../src/utils/backupManager.js';
import { expectThrowErrorCode } from './utils/testUtils.js';

describe('Planning settings and earmarked accounts', () => {
  let uid: bigint;
  let otherUid: bigint;

  const mk = (userId: bigint, name: string, type = MYFIN.ACCOUNT_TYPES.CHECKING, extra = {}) =>
    AccountService.createAccount(
      {
        name,
        type,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: userId,
        ...extra,
      } as never,
      userId
    );
  const update = (accountId: bigint, userId: bigint, extra = {}, type = 'CHEAC', name = 'x') =>
    AccountService.updateAccount(
      {
        account_id: accountId,
        new_name: name,
        new_type: type,
        new_description: '',
        new_status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        ...extra,
      } as never,
      userId
    );

  beforeEach(async () => {
    uid = (await UserService.createUser({ username: 'em', password: '123', email: 'em@x.com' }))
      .user_id;
    otherUid = (await UserService.createUser({ username: 'em2', password: '123', email: 'em2@x.com' }))
      .user_id;
  });

  test('defaults with no row', async () => {
    expect(await getFinancialProfile(uid)).toMatchObject({
      savings_target_mode: 'amount',
      savings_target_value: 0,
      savings_target_account_id: null,
      sinking_fund_account_id: null,
      emergency_fund_target_months: 6,
      emergency_topup_percent: 10,
    });
  });

  test('valid settings round-trip (amount and percent)', async () => {
    const sink = await mk(uid, 'Sink');
    const sav = await mk(uid, 'Sav');
    const put = await updateFinancialProfile(uid, {
      savings_target_mode: 'amount',
      savings_target_value: 1234.56,
      savings_target_account_id: Number(sav.account_id),
      sinking_fund_account_id: Number(sink.account_id),
      emergency_fund_target_months: 9,
      emergency_topup_percent: 15,
    });
    expect(put).toMatchObject({
      savings_target_mode: 'amount',
      savings_target_value: 1234.56,
      savings_target_account_id: String(sav.account_id),
      sinking_fund_account_id: String(sink.account_id),
      emergency_fund_target_months: 9,
      emergency_topup_percent: 15,
    });
    expect((await prisma.user_financial_profile.findUnique({ where: { users_user_id: uid } }))
      ?.savings_target_value).toBe(123456n);
    // mode change without a value resets the value
    expect((await updateFinancialProfile(uid, { savings_target_mode: 'percent' })).savings_target_value).toBe(0);
    expect(
      (await updateFinancialProfile(uid, { savings_target_value: 20 })).savings_target_value
    ).toBe(20);
    // partial patch keeps the rest
    expect(await getFinancialProfile(uid)).toMatchObject({
      savings_target_mode: 'percent',
      sinking_fund_account_id: String(sink.account_id),
    });
    // clearing
    expect(
      (await updateFinancialProfile(uid, { sinking_fund_account_id: null })).sinking_fund_account_id
    ).toBeNull();
  });

  test.each([
    [{ savings_target_value: -1 }],
    [{ savings_target_mode: 'percent', savings_target_value: 101 }],
    [{ savings_target_mode: 'percent', savings_target_value: 12.5 }],
    [{ savings_target_mode: 'bogus' }],
    [{ emergency_fund_target_months: 0 }],
    [{ emergency_fund_target_months: 25 }],
    [{ emergency_topup_percent: 101 }],
    [{ emergency_topup_percent: -1 }],
  ])('invalid patch %j gives 400', async (patch) => {
    await expectThrowErrorCode(() => updateFinancialProfile(uid, patch as never), 400);
  });

  test('sinking account cannot be an emergency account', async () => {
    const a = await mk(uid, 'A', MYFIN.ACCOUNT_TYPES.CHECKING, { is_emergency_fund: true });
    await expectThrowErrorCode(
      () => updateFinancialProfile(uid, { sinking_fund_account_id: Number(a.account_id) }),
      400
    );
    await expectThrowErrorCode(
      () => updateFinancialProfile(uid, { savings_target_account_id: Number(a.account_id) }),
      400
    );
  });

  test('savings-target account cannot equal the sinking account', async () => {
    const a = await mk(uid, 'A');
    await updateFinancialProfile(uid, { sinking_fund_account_id: Number(a.account_id) });
    await expectThrowErrorCode(
      () => updateFinancialProfile(uid, { savings_target_account_id: Number(a.account_id) }),
      400
    );
    // and the reverse
    const b = await mk(uid, 'B');
    await updateFinancialProfile(uid, { savings_target_account_id: Number(b.account_id) });
    await expectThrowErrorCode(
      () => updateFinancialProfile(uid, { sinking_fund_account_id: Number(b.account_id) }),
      400
    );
  });

  test('both roles set in one patch on the same account gives 400', async () => {
    const a = await mk(uid, 'A');
    await expectThrowErrorCode(
      () =>
        updateFinancialProfile(uid, {
          sinking_fund_account_id: Number(a.account_id),
          savings_target_account_id: Number(a.account_id),
        }),
      400
    );
  });

  test('ticking emergency on the sinking account gives 400 (update)', async () => {
    const a = await mk(uid, 'A');
    await updateFinancialProfile(uid, { sinking_fund_account_id: Number(a.account_id) });
    await expectThrowErrorCode(
      () => update(a.account_id, uid, { new_is_emergency_fund: true }, 'CHEAC', 'A'),
      400
    );
    const b = await mk(uid, 'B');
    await updateFinancialProfile(uid, { savings_target_account_id: Number(b.account_id) });
    await expectThrowErrorCode(
      () => update(b.account_id, uid, { new_is_emergency_fund: true }, 'CHEAC', 'B'),
      400
    );
  });

  test('ticking emergency on an INVAC gives 400 (create and update)', async () => {
    await expectThrowErrorCode(
      () => mk(uid, 'Inv', MYFIN.ACCOUNT_TYPES.INVESTING, { is_emergency_fund: true }),
      400
    );
    const inv = await mk(uid, 'Inv2', MYFIN.ACCOUNT_TYPES.INVESTING);
    await expectThrowErrorCode(
      () => update(inv.account_id, uid, { new_is_emergency_fund: true }, 'INVAC', 'Inv2'),
      400
    );
  });

  test('INVAC cannot be a sinking or savings-target account', async () => {
    const inv = await mk(uid, 'Inv', MYFIN.ACCOUNT_TYPES.INVESTING);
    await expectThrowErrorCode(
      () => updateFinancialProfile(uid, { sinking_fund_account_id: Number(inv.account_id) }),
      400
    );
    await expectThrowErrorCode(
      () => updateFinancialProfile(uid, { savings_target_account_id: Number(inv.account_id) }),
      400
    );
  });

  test("another user's account gives 400 as sinking or savings-target", async () => {
    const theirs = await mk(otherUid, 'Theirs');
    await expectThrowErrorCode(
      () => updateFinancialProfile(uid, { sinking_fund_account_id: Number(theirs.account_id) }),
      400
    );
    await expectThrowErrorCode(
      () => updateFinancialProfile(uid, { savings_target_account_id: Number(theirs.account_id) }),
      400
    );
  });

  test('changing a ticked or earmarked account to INVAC gives 400', async () => {
    const e = await mk(uid, 'E', MYFIN.ACCOUNT_TYPES.CHECKING, { is_emergency_fund: true });
    await expectThrowErrorCode(() => update(e.account_id, uid, {}, 'INVAC', 'E'), 400);
    const s = await mk(uid, 'S');
    await updateFinancialProfile(uid, { sinking_fund_account_id: Number(s.account_id) });
    await expectThrowErrorCode(() => update(s.account_id, uid, {}, 'INVAC', 'S'), 400);
    // allowed when untick is sent along
    await update(e.account_id, uid, { new_is_emergency_fund: false }, 'INVAC', 'E');
  });

  test('omitted new_is_emergency_fund leaves it unchanged; emergencyAccountIds lists active ticked', async () => {
    const e = await mk(uid, 'E', MYFIN.ACCOUNT_TYPES.CHECKING, { is_emergency_fund: true });
    const e2 = await mk(uid, 'E2', MYFIN.ACCOUNT_TYPES.CHECKING, { is_emergency_fund: true });
    await mk(uid, 'Plain');
    await update(e.account_id, uid, {}, 'CHEAC', 'E');
    expect((await emergencyAccountIds(uid)).sort()).toEqual([e.account_id, e2.account_id].sort());
    await update(e2.account_id, uid, { new_status: MYFIN.ACCOUNT_STATUS.INACTIVE }, 'CHEAC', 'E2');
    expect(await emergencyAccountIds(uid)).toEqual([e.account_id]);
    await update(e.account_id, uid, { new_is_emergency_fund: false }, 'CHEAC', 'E');
    expect(await emergencyAccountIds(uid)).toEqual([]);
  });

  test('JSON round-tripped backup restores fields with remapped account ids', async () => {
    const e = await mk(uid, 'E', MYFIN.ACCOUNT_TYPES.CHECKING, { is_emergency_fund: true });
    const sink = await mk(uid, 'Sink');
    const sav = await mk(uid, 'Sav');
    await updateFinancialProfile(uid, {
      savings_target_mode: 'amount',
      savings_target_value: 500.5,
      savings_target_account_id: Number(sav.account_id),
      sinking_fund_account_id: Number(sink.account_id),
      emergency_fund_target_months: 12,
      emergency_topup_percent: 25,
    });
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(uid)));
    await UserService.restoreUser(uid, backup);
    const accs = await prisma.accounts.findMany({ where: { users_user_id: uid } });
    const byName = Object.fromEntries(accs.map((a) => [a.name, a]));
    expect(byName.E.account_id).not.toBe(e.account_id);
    expect(byName.E.is_emergency_fund).toBe(true);
    expect(byName.Sink.is_emergency_fund).toBe(false);
    expect(await getFinancialProfile(uid)).toMatchObject({
      savings_target_mode: 'amount',
      savings_target_value: 500.5,
      savings_target_account_id: String(byName.Sav.account_id),
      sinking_fund_account_id: String(byName.Sink.account_id),
      emergency_fund_target_months: 12,
      emergency_topup_percent: 25,
    });
  });

  test('pre-Phase-B backup restores defaults', async () => {
    const e = await mk(uid, 'E');
    await updateFinancialProfile(uid, { salary_cutoff_day: 18, sinking_fund_account_id: Number(e.account_id) });
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(uid)));
    for (const k of [
      'savings_target_mode',
      'savings_target_value',
      'savings_target_account_id',
      'sinking_fund_account_id',
      'emergency_fund_target_months',
      'emergency_topup_percent',
    ])
      delete backup.financial_profile[k];
    for (const a of backup.accounts) delete a.is_emergency_fund;
    await UserService.restoreUser(uid, backup);
    expect(await getFinancialProfile(uid)).toMatchObject({
      salary_cutoff_day: 18,
      savings_target_mode: 'amount',
      savings_target_value: 0,
      savings_target_account_id: null,
      sinking_fund_account_id: null,
      emergency_fund_target_months: 6,
      emergency_topup_percent: 10,
    });
    expect((await prisma.accounts.findMany({ where: { users_user_id: uid } }))[0].is_emergency_fund).toBe(false);
  });
});
