import { beforeEach, describe, expect, test } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import { MYFIN } from '../../src/consts.js';
import AccountService from '../../src/services/accountService.js';
import CategoryService from '../../src/services/categoryService.js';
import EntityService from '../../src/services/entityService.js';
import { applyRuleChanges, previewRuleApplication } from '../../src/services/ruleApplyService.js';
import RuleService from '../../src/services/ruleService.js';
import TransactionService from '../../src/services/transactionService.js';
import UserService from '../../src/services/userService.js';

const E = MYFIN.TRX_TYPES.EXPENSE;
const T = MYFIN.TRX_TYPES.TRANSFER;
const JUNE_10 = Date.UTC(2026, 5, 10, 6, 30) / 1000;

describe('apply rules to existing transactions', () => {
  let userId: bigint;
  let bankId: bigint;
  let otherBankId: bigint;
  let foodId: bigint;
  let travelId: bigint;
  let shopId: bigint;

  const makeUser = async (username: string) => {
    const user = await UserService.createUser({ username, password: '123', email: `${username}@myfin.test` });
    const mk = (name: string) =>
      AccountService.createAccount(
        {
          name,
          type: MYFIN.ACCOUNT_TYPES.CHECKING,
          description: '',
          status: MYFIN.ACCOUNT_STATUS.ACTIVE,
          exclude_from_budgets: false,
          current_balance: 0,
          users_user_id: user.user_id,
        } as never,
        user.user_id
      );
    return { userId: user.user_id, bankId: (await mk('Bank')).account_id, otherId: (await mk('Other')).account_id };
  };
  const add = async (owner: bigint, bank: bigint, description: string, extra: Record<string, unknown> = {}) => {
    await TransactionService.createTransaction(owner, {
      account_from_id: bank,
      amount: 50,
      type: E,
      description,
      date_timestamp: JUNE_10,
      is_essential: false,
      ...extra,
    } as never);
    return (await prisma.transactions.findFirstOrThrow({ orderBy: { transaction_id: 'desc' } })).transaction_id;
  };
  const rule = (owner: bigint, description: string, assign: Record<string, unknown>) =>
    RuleService.createRule(owner, {
      matcher_description_operator: MYFIN.RULES.OPERATOR.CONTAINS,
      matcher_description_value: description,
      matcher_amount_operator: MYFIN.RULES.OPERATOR.IGNORE,
      matcher_type_operator: MYFIN.RULES.OPERATOR.IGNORE,
      matcher_account_to_id_operator: MYFIN.RULES.OPERATOR.IGNORE,
      matcher_account_from_id_operator: MYFIN.RULES.OPERATOR.IGNORE,
      ...assign,
    } as never);
  const trx = (id: bigint) => prisma.transactions.findFirstOrThrow({ where: { transaction_id: id } });

  beforeEach(async () => {
    ({ userId, bankId, otherId: otherBankId } = await makeUser('applyrules'));
    const cat = (name: string) =>
      CategoryService.createCategory({
        name,
        type: E,
        status: MYFIN.CATEGORY_STATUS.ACTIVE,
        users_user_id: userId,
      });
    foodId = (await cat('Food')).category_id;
    travelId = (await cat('Travel')).category_id;
    shopId = (await EntityService.createEntity({ name: 'Shop', users_user_id: userId })).entity_id;
  });

  test('preview lists only transactions whose category or entity would change', async () => {
    await rule(userId, 'swiggy', { assign_category_id: foodId });
    const changing = await add(userId, bankId, 'Swiggy order');
    const already = await add(userId, bankId, 'Swiggy again');
    await prisma.transactions.update({ where: { transaction_id: already }, data: { categories_category_id: foodId } });
    await add(userId, bankId, 'Unrelated');

    const { changes, truncated } = await previewRuleApplication(userId);
    expect(truncated).toBe(false);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      transaction_id: String(changing),
      current_category_id: null,
      new_category_id: String(foodId),
      current_entity_id: null,
      new_entity_id: null,
    });
  });

  test('preview uses the same priority as import', async () => {
    // Two matching attributes (description + type) beat one
    await rule(userId, 'swiggy', { assign_category_id: travelId });
    await rule(userId, 'swiggy', { matcher_type_operator: MYFIN.RULES.OPERATOR.EQUALS, matcher_type_value: E, assign_category_id: foodId });
    const id = await add(userId, bankId, 'Swiggy order');
    const { changes } = await previewRuleApplication(userId);
    expect(changes).toHaveLength(1);
    expect(changes[0].new_category_id).toBe(String(foodId));
    const instructions = await TransactionService.autoCategorizeTransaction(userId, 'Swiggy order', 50, E, bankId, null);
    expect(String(instructions.selectedCategoryID)).toBe(String(foodId));
    expect(changes[0].transaction_id).toBe(String(id));
  });

  test('preview skips transfers, adjustments and debt rows', async () => {
    await rule(userId, 'swiggy', { assign_category_id: foodId });
    const transfer = await add(userId, bankId, 'Swiggy transfer', { type: T, account_to_id: otherBankId });
    const adjustment = await add(userId, bankId, 'Swiggy adjustment');
    await prisma.transactions.update({ where: { transaction_id: adjustment }, data: { is_adjustment: true } });
    const debtRow = await add(userId, bankId, 'Swiggy debt');
    const debt = await prisma.debts.create({
      data: { users_user_id: userId, kind: 'lent', counterparty_name: 'X', principal: 5000n, start_date: 1n, created_at: 1n } as never,
    });
    await prisma.transactions.update({ where: { transaction_id: debtRow }, data: { debt_id: debt.debt_id } });
    const plain = await add(userId, bankId, 'Swiggy plain');

    const { changes } = await previewRuleApplication(userId);
    const ids = changes.map((c) => c.transaction_id);
    expect(ids).toEqual([String(plain)]);
    expect(ids).not.toContain(String(transfer));
  });

  test('preview is empty with no rules', async () => {
    await add(userId, bankId, 'Swiggy order');
    expect(await previewRuleApplication(userId)).toEqual({ changes: [], truncated: false });
  });

  test('apply overwrites a hand-set category', async () => {
    await rule(userId, 'swiggy', { assign_category_id: foodId });
    const id = await add(userId, bankId, 'Swiggy order', { category_id: travelId });
    await prisma.transactions.update({ where: { transaction_id: id }, data: { categories_category_id: travelId } });
    expect(await applyRuleChanges(userId, [id])).toEqual({ updated: 1, skipped: 0 });
    expect((await trx(id)).categories_category_id).toBe(foodId);
  });

  test('apply re-matches server-side', async () => {
    await rule(userId, 'swiggy', { assign_category_id: foodId });
    const matching = await add(userId, bankId, 'Swiggy order');
    const nonMatching = await add(userId, bankId, 'Something else');
    expect(await applyRuleChanges(userId, [matching, nonMatching])).toEqual({ updated: 1, skipped: 1 });
    expect((await trx(nonMatching)).categories_category_id).toBeNull();
    expect((await trx(matching)).categories_category_id).toBe(foodId);
  });

  test('apply never changes accounts or type', async () => {
    await rule(userId, 'swiggy', {
      assign_category_id: foodId,
      assign_account_from_id: otherBankId,
      assign_type: MYFIN.TRX_TYPES.INCOME,
    });
    const id = await add(userId, bankId, 'Swiggy order');
    const before = await trx(id);
    expect((await applyRuleChanges(userId, [id])).updated).toBe(1);
    const after = await trx(id);
    expect(after.categories_category_id).toBe(foodId);
    expect(after.accounts_account_from_id).toBe(before.accounts_account_from_id);
    expect(after.accounts_account_to_id).toBe(before.accounts_account_to_id);
    expect(after.type).toBe(before.type);
    expect(after.amount).toBe(before.amount);
  });

  test("apply ignores ids of another user's transactions", async () => {
    const other = await makeUser('applyother');
    await rule(userId, 'swiggy', { assign_category_id: foodId });
    const theirs = await add(other.userId, other.bankId, 'Swiggy order');
    const res = await applyRuleChanges(userId, [theirs]);
    expect(res).toEqual({ updated: 0, skipped: 1 });
    expect((await trx(theirs)).categories_category_id).toBeNull();
  });

  test('a rule that assigns only a category leaves entity untouched', async () => {
    await rule(userId, 'swiggy', { assign_category_id: foodId });
    const id = await add(userId, bankId, 'Swiggy order');
    await prisma.transactions.update({ where: { transaction_id: id }, data: { entities_entity_id: shopId } });
    const { changes } = await previewRuleApplication(userId);
    expect(changes[0]).toMatchObject({ current_entity_id: String(shopId), new_entity_id: String(shopId) });
    await applyRuleChanges(userId, [id]);
    const after = await trx(id);
    expect(after.entities_entity_id).toBe(shopId);
    expect(after.categories_category_id).toBe(foodId);
  });
});
