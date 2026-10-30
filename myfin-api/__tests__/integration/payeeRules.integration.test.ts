import { beforeEach, describe, expect, test } from "vitest";
import { MYFIN } from "../../src/consts.js";
import { prisma } from "../../src/config/prisma.js";
import CategoryService from "../../src/services/categoryService.js";
import EntityService from "../../src/services/entityService.js";
import RuleService from "../../src/services/ruleService.js";
import UserService from "../../src/services/userService.js";
import { expectThrowErrorCode } from "./utils/testUtils.js";

const makeCategory = (userId: bigint, name: string) =>
  CategoryService.createCategory({
    name,
    description: "",
    color_gradient: "red",
    icon_key: null,
    status: MYFIN.CATEGORY_STATUS.ACTIVE,
    exclude_from_budgets: 0,
    type: "M",
    users_user_id: userId,
  } as never);

const matchFor = (userId: bigint, description: string, type: string) =>
  RuleService.getRuleForTransaction(userId, description, 10, type, undefined, undefined, "RULES_MATCHING_IGNORE", "RULES_MATCHING_IGNORE");

describe("savePayeeRules", () => {
  let user: { user_id: bigint };
  let food: { category_id: bigint };
  let entity: { entity_id: bigint };

  beforeEach(async () => {
    user = await UserService.createUser({ username: "demo", password: "123", email: "demo@afaneca.com" });
    food = await makeCategory(user.user_id, "Food");
    entity = await EntityService.createEntity({ name: "Swiggy", users_user_id: user.user_id });
  });

  test("creates a payee rule that matches the same direction only", async () => {
    const count = await RuleService.savePayeeRules(
      user.user_id,
      [{ match_text: "SWIGGY", type: "E", category_id: food.category_id }],
      prisma
    );
    expect(count).toBe(1);

    const rules = await prisma.rules.findMany({ where: { users_user_id: user.user_id } });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      matcher_description_operator: MYFIN.RULES.OPERATOR.CONTAINS,
      matcher_description_value: "SWIGGY",
      matcher_type_operator: MYFIN.RULES.OPERATOR.EQUALS,
      matcher_type_value: "E",
      assign_category_id: food.category_id,
    });

    expect((await matchFor(user.user_id, "Paid to SWIGGY", "E"))?.assign_category_id).toBe(food.category_id);
    expect((await matchFor(user.user_id, "Received from SWIGGY", "I"))?.assign_category_id).toBeUndefined();
  });

  test("updates the existing payee rule and keeps fields the user did not set", async () => {
    await RuleService.savePayeeRules(user.user_id, [{ match_text: "SWIGGY", type: "E", category_id: food.category_id }], prisma);
    await RuleService.savePayeeRules(user.user_id, [{ match_text: "swiggy", type: "E", entity_id: entity.entity_id }], prisma);

    const rules = await prisma.rules.findMany({ where: { users_user_id: user.user_id } });
    expect(rules).toHaveLength(1);
    expect(rules[0].assign_category_id).toBe(food.category_id);
    expect(rules[0].assign_entity_id).toBe(entity.entity_id);
  });

  test("stores the essential flag only when it is provided", async () => {
    await RuleService.savePayeeRules(user.user_id, [{ match_text: "NETFLIX", type: "E", category_id: food.category_id, is_essential: true }], prisma);
    await RuleService.savePayeeRules(user.user_id, [{ match_text: "NETFLIX", type: "E", entity_id: entity.entity_id }], prisma);

    const [rule] = await prisma.rules.findMany({ where: { users_user_id: user.user_id } });
    expect(rule.assign_is_essential).toBe(true);
  });

  test("two entries for the same payee and type in one call produce one rule", async () => {
    const count = await RuleService.savePayeeRules(
      user.user_id,
      [
        { match_text: "Veg Basket", type: "E", category_id: food.category_id },
        { match_text: "VEG BASKET", type: "E", entity_id: entity.entity_id },
      ],
      prisma
    );
    expect(count).toBe(1);
    const rules = await prisma.rules.findMany({ where: { users_user_id: user.user_id } });
    expect(rules).toHaveLength(1);
    expect(rules[0].assign_category_id).toBe(food.category_id);
    expect(rules[0].assign_entity_id).toBe(entity.entity_id);
  });

  test("does not touch a broader rule that is not a pure payee rule", async () => {
    await RuleService.createRule(
      user.user_id,
      {
        matcher_description_operator: MYFIN.RULES.OPERATOR.CONTAINS,
        matcher_description_value: "SWIGGY",
        matcher_amount_operator: MYFIN.RULES.OPERATOR.EQUALS,
        matcher_amount_value: 5,
        assign_category_id: food.category_id,
      },
      prisma
    );
    await RuleService.savePayeeRules(user.user_id, [{ match_text: "SWIGGY", type: "E", entity_id: entity.entity_id }], prisma);
    expect(await prisma.rules.count({ where: { users_user_id: user.user_id } })).toBe(2);
  });

  test("a typeless rule for the same text is kept; the new typed rule inherits its values", async () => {
    await RuleService.createRule(
      user.user_id,
      {
        matcher_description_operator: MYFIN.RULES.OPERATOR.CONTAINS,
        matcher_description_value: "SWIGGY",
        assign_category_id: food.category_id,
        assign_is_essential: true,
      },
      prisma
    );
    await RuleService.savePayeeRules(user.user_id, [{ match_text: "SWIGGY", type: "E", entity_id: entity.entity_id }], prisma);

    const rules = await prisma.rules.findMany({ where: { users_user_id: user.user_id }, orderBy: { rule_id: "asc" } });
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ assign_category_id: food.category_id, assign_entity_id: null, assign_is_essential: true });
    expect(rules[1]).toMatchObject({
      matcher_type_value: "E",
      assign_category_id: food.category_id,
      assign_entity_id: entity.entity_id,
      assign_is_essential: true,
    });
  });

  test("an exact rule matches the whole description, not payees that merely contain it", async () => {
    await RuleService.savePayeeRules(
      user.user_id,
      [{ match_text: "Paid to AB", type: "E", exact: true, category_id: food.category_id }],
      prisma
    );
    const [rule] = await prisma.rules.findMany({ where: { users_user_id: user.user_id } });
    expect(rule).toMatchObject({ matcher_description_operator: MYFIN.RULES.OPERATOR.EQUALS, matcher_description_value: "Paid to AB" });
    expect((await matchFor(user.user_id, "Paid to AB", "E"))?.assign_category_id).toBe(food.category_id);
    expect((await matchFor(user.user_id, "Paid to ABHISHEK KUMAR", "E"))?.assign_category_id).toBeUndefined();
  });

  test("defaults fill fields on a new rule only", async () => {
    await RuleService.savePayeeRules(
      user.user_id,
      [{ match_text: "NETFLIX", type: "E", category_id: food.category_id, defaults: { entity_id: entity.entity_id, is_essential: true } }],
      prisma
    );
    let [rule] = await prisma.rules.findMany({ where: { users_user_id: user.user_id } });
    expect(rule).toMatchObject({ assign_category_id: food.category_id, assign_entity_id: entity.entity_id, assign_is_essential: true });

    await prisma.rules.update({
      where: { rule_id_users_user_id: { rule_id: rule.rule_id, users_user_id: user.user_id } },
      data: { assign_entity_id: null },
    });
    await RuleService.savePayeeRules(
      user.user_id,
      [{ match_text: "NETFLIX", type: "E", category_id: food.category_id, defaults: { entity_id: entity.entity_id } }],
      prisma
    );
    [rule] = await prisma.rules.findMany({ where: { users_user_id: user.user_id } });
    expect(rule.assign_entity_id).toBeNull();
  });

  test("rejects a category that belongs to another user and creates nothing", async () => {
    const other = await UserService.createUser({ username: "other", password: "123", email: "other@afaneca.com" });
    const foreign = await makeCategory(other.user_id, "Theirs");
    await expectThrowErrorCode(
      () => RuleService.savePayeeRules(user.user_id, [{ match_text: "SWIGGY", type: "E", category_id: foreign.category_id }], prisma),
      400
    );
    expect(await prisma.rules.count({ where: { users_user_id: user.user_id } })).toBe(0);
  });
});
