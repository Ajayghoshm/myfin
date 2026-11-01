import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import app from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import BalanceCheckService from '../../src/services/balanceCheckService.js';
import BudgetTemplateService from '../../src/services/budgetTemplateService.js';
import { updateFinancialProfile } from '../../src/services/financialProfileService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';
import BackupManager from '../../src/utils/backupManager.js';

describe('Backup JSON round trip', () => {
  let uid: bigint;
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
    const user = await UserService.createUser({
      username: 'rt',
      password: '123',
      email: 'rt@x.com',
    });
    uid = user.user_id;
  });

  const seed = async () => {
    const bank = await AccountService.createAccount(
      {
        name: 'Bank',
        type: MYFIN.ACCOUNT_TYPES.CHECKING,
        description: '',
        status: MYFIN.ACCOUNT_STATUS.ACTIVE,
        exclude_from_budgets: false,
        current_balance: 0,
        users_user_id: uid,
      },
      uid
    );
    await prisma.accounts.update({
      where: { account_id: bank.account_id },
      data: { stale_after_days: 14 },
    });
    // Restore recreates categories, so the salary category gets a new id afterwards.
    const salary = await prisma.categories.create({
      data: { name: 'Salary', type: 'I', users_user_id: uid, is_fixed: true },
    });
    await updateFinancialProfile(uid, {
      salary_category_id: Number(salary.category_id),
      salary_cutoff_day: 20,
    });
    await TransactionService.createTransaction(uid, {
      amount: 100,
      type: 'I',
      description: 'Pay',
      account_to_id: bank.account_id,
      category_id: salary.category_id,
      date_timestamp: 1_700_000_000,
      is_essential: false,
    } as never);
    await BalanceCheckService.writeOff(uid, bank.account_id, 90);
    await BalanceCheckService.recordCheck(uid, bank.account_id, 90);
    await prisma.import_instrument_mappings.create({
      data: {
        users_user_id: uid,
        source: 'phonepe',
        instrument_key: 'hdfc-1234',
        accounts_account_id: bank.account_id,
      },
    });
  };

  const assertIntact = async () => {
    const salary = await prisma.categories.findFirstOrThrow({
      where: { users_user_id: uid, name: 'Salary' },
    });
    expect(salary.is_fixed).toBe(true);
    const profile = await prisma.user_financial_profile.findFirstOrThrow({
      where: { users_user_id: uid },
    });
    expect(profile.salary_category_id).toBe(salary.category_id);
    expect(profile.salary_cutoff_day).toBe(20);
    const account = await prisma.accounts.findFirstOrThrow({
      where: { users_user_id: uid, name: 'Bank' },
    });
    expect(account.stale_after_days).toBe(14);
    expect(await prisma.transactions.count({ where: { is_adjustment: true } })).toBe(1);
    expect(
      await prisma.balance_checks.count({ where: { accounts_account_id: account.account_id } })
    ).toBe(2);
    const mapping = await prisma.import_instrument_mappings.findFirstOrThrow({
      where: { users_user_id: uid, source: 'phonepe', instrument_key: 'hdfc-1234' },
    });
    expect(mapping.accounts_account_id).toBe(account.account_id);
  };

  test('restoreUser from a JSON round-tripped backup keeps profile and Phase A fields', async () => {
    await seed();
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(uid)));
    await UserService.restoreUser(uid, backup);
    await assertIntact();
  });

  test('GET /user/backup then PUT /user/restore over HTTP', async () => {
    await seed();
    const login = await UserService.attemptLogin('rt', '123', false);
    const headers = {
      authusername: 'rt',
      sessionkey: login.sessionkey,
      'content-type': 'application/json',
    };
    const got = await fetch(`${baseUrl}/user/backup`, { headers });
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body.financial_profile).toBeTruthy();
    const put = await fetch(`${baseUrl}/user/restore`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    expect(put.status).toBe(200);
    await assertIntact();
  });

  test('round trip keeps subcategory parents', async () => {
    const food = await prisma.categories.create({
      data: { name: 'Food', type: 'E', users_user_id: uid },
    });
    await prisma.categories.create({
      data: {
        name: 'Groceries',
        type: 'E',
        users_user_id: uid,
        parent_category_id: food.category_id,
      },
    });
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(uid)));
    await UserService.restoreUser(uid, backup);
    const newFood = await prisma.categories.findFirstOrThrow({
      where: { users_user_id: uid, name: 'Food' },
    });
    const groceries = await prisma.categories.findFirstOrThrow({
      where: { users_user_id: uid, name: 'Groceries' },
    });
    expect(newFood.parent_category_id).toBeNull();
    expect(groceries.parent_category_id).toBe(newFood.category_id);
  });

  test('restoring a backup whose categories have no parent_category_id gives top-level categories', async () => {
    const food = await prisma.categories.create({
      data: { name: 'Food', type: 'E', users_user_id: uid },
    });
    await prisma.categories.create({
      data: {
        name: 'Groceries',
        type: 'E',
        users_user_id: uid,
        parent_category_id: food.category_id,
      },
    });
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(uid)));
    for (const row of backup.categories) delete row.parent_category_id;
    await UserService.restoreUser(uid, backup);
    const rows = await prisma.categories.findMany({ where: { users_user_id: uid } });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.parent_category_id === null)).toBe(true);
  });

  const seedTemplate = async () => {
    const food = await prisma.categories.create({
      data: { name: 'Food', type: 'E', users_user_id: uid },
    });
    const pay = await prisma.categories.create({
      data: { name: 'Pay', type: 'I', users_user_id: uid },
    });
    await BudgetTemplateService.replace(uid, [
      {
        category_id: food.category_id,
        expense_items: [
          { label: 'Rice', amount: '30.50', sort_order: 0 },
          { label: 'Veg', amount: '19.50', sort_order: 1 },
        ],
      },
      { category_id: pay.category_id, planned_value_credit: 1000 },
    ]);
  };

  test('round trip keeps the budget template with items', async () => {
    await seedTemplate();
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(uid)));
    expect(backup.budget_templates).toHaveLength(1);
    expect(backup.budget_template_rows).toHaveLength(2);
    expect(backup.budget_template_items).toHaveLength(2);
    await UserService.restoreUser(uid, backup);
    const food = await prisma.categories.findFirstOrThrow({
      where: { users_user_id: uid, name: 'Food' },
    });
    const pay = await prisma.categories.findFirstOrThrow({
      where: { users_user_id: uid, name: 'Pay' },
    });
    const { rows } = await BudgetTemplateService.get(uid);
    expect(rows).toHaveLength(2);
    const foodRow = rows.find((r) => r.category_id === food.category_id);
    expect(foodRow?.planned_value_debit).toBe(50);
    expect(foodRow?.expense_items.map((i) => [i.label, i.amount])).toEqual([
      ['Rice', 30.5],
      ['Veg', 19.5],
    ]);
    expect(rows.find((r) => r.category_id === pay.category_id)?.planned_value_credit).toBe(1000);
  });

  test('a backup without template data restores with no template', async () => {
    await seedTemplate();
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(uid)));
    delete backup.budget_templates;
    delete backup.budget_template_rows;
    delete backup.budget_template_items;
    await UserService.restoreUser(uid, backup);
    expect(await BudgetTemplateService.get(uid)).toEqual({ rows: [], updated_at: null });
  });

  test('restore rejects a template whose items do not match planned totals', async () => {
    await seedTemplate();
    const backup = JSON.parse(JSON.stringify(await BackupManager.createBackup(uid)));
    backup.budget_template_items[0].amount = Number(backup.budget_template_items[0].amount) + 100;
    await expect(UserService.restoreUser(uid, backup)).rejects.toBeTruthy();
    const { rows } = await BudgetTemplateService.get(uid);
    expect(rows).toHaveLength(2);
    expect(await prisma.categories.count({ where: { users_user_id: uid } })).toBe(2);
  });
});
