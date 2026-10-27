import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import CategoryService from '../../src/services/categoryService.js';
import {
  getFinancialProfile,
  updateFinancialProfile,
} from '../../src/services/financialProfileService.js';
import UserService from '../../src/services/userService.js';
import BackupManager from '../../src/utils/backupManager.js';
import { expectThrowErrorCode } from './utils/testUtils.js';

const makeCategory = (userId: bigint, name: string) =>
  CategoryService.createCategory({
    name,
    description: '',
    color_gradient: 'red',
    icon_key: null,
    status: MYFIN.CATEGORY_STATUS.ACTIVE,
    exclude_from_budgets: 0,
    type: 'I',
    users_user_id: userId,
  } as never);

describe('Financial profile', () => {
  let user: { user_id: bigint };
  let other: { user_id: bigint };
  let salary: { category_id: bigint };

  beforeEach(async () => {
    user = await UserService.createUser({ username: 'fp', password: '123', email: 'fp@x.com' });
    other = await UserService.createUser({ username: 'fp2', password: '123', email: 'fp2@x.com' });
    salary = await makeCategory(user.user_id, 'Salary');
  });

  test('GET with no row returns defaults', async () => {
    expect(await getFinancialProfile(user.user_id)).toEqual({
      salary_category_id: null,
      salary_cutoff_day: 25,
    });
  });

  test('PUT sets both and GET returns them', async () => {
    const put = await updateFinancialProfile(user.user_id, {
      salary_category_id: Number(salary.category_id),
      salary_cutoff_day: 20,
    });
    const expected = { salary_category_id: String(salary.category_id), salary_cutoff_day: 20 };
    expect(put).toEqual(expected);
    expect(await getFinancialProfile(user.user_id)).toEqual(expected);
  });

  test('partial PUT keeps other field; null clears category', async () => {
    await updateFinancialProfile(user.user_id, {
      salary_category_id: Number(salary.category_id),
      salary_cutoff_day: 20,
    });
    expect((await updateFinancialProfile(user.user_id, { salary_cutoff_day: 10 })).salary_category_id).toBe(
      String(salary.category_id)
    );
    expect(await updateFinancialProfile(user.user_id, { salary_category_id: null })).toEqual({
      salary_category_id: null,
      salary_cutoff_day: 10,
    });
  });

  test("PUT with another user's category gives 401", async () => {
    const theirs = await makeCategory(other.user_id, 'Theirs');
    await expectThrowErrorCode(
      () => updateFinancialProfile(user.user_id, { salary_category_id: Number(theirs.category_id) }),
      401
    );
  });

  test.each([29, 0, 1.5])('salary_cutoff_day %s gives 400', async (day) => {
    await expectThrowErrorCode(
      () => updateFinancialProfile(user.user_id, { salary_cutoff_day: day }),
      400
    );
  });

  test('backup then restore keeps profile with category id remapped', async () => {
    await updateFinancialProfile(user.user_id, {
      salary_category_id: Number(salary.category_id),
      salary_cutoff_day: 18,
    });
    const backup = await UserService.backupUser(user.user_id);
    expect(backup.financial_profile).toBeTruthy();
    await BackupManager.restoreBackup(user.user_id, backup);
    const cats = await prisma.categories.findMany({ where: { users_user_id: user.user_id } });
    expect(cats).toHaveLength(1);
    expect(cats[0].category_id).not.toBe(salary.category_id);
    expect(await getFinancialProfile(user.user_id)).toEqual({
      salary_category_id: String(cats[0].category_id),
      salary_cutoff_day: 18,
    });
  });

  test('restoring a backup without financial_profile gives defaults', async () => {
    await updateFinancialProfile(user.user_id, { salary_cutoff_day: 18 });
    const backup = await UserService.backupUser(user.user_id);
    Reflect.deleteProperty(backup, 'financial_profile');
    await BackupManager.restoreBackup(user.user_id, backup);
    expect(await prisma.user_financial_profile.count({ where: { users_user_id: user.user_id } })).toBe(0);
    expect(await getFinancialProfile(user.user_id)).toEqual({
      salary_category_id: null,
      salary_cutoff_day: 25,
    });
  });

  test('user-data wipe removes the row', async () => {
    await updateFinancialProfile(user.user_id, { salary_cutoff_day: 18 });
    await UserService.deleteAllUserData(user.user_id);
    expect(await prisma.user_financial_profile.count({ where: { users_user_id: user.user_id } })).toBe(0);
  });
});
