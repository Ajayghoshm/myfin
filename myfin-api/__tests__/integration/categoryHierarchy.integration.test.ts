import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "../../src/config/prisma.js";
import CategoryService from "../../src/services/categoryService.js";
import UserService from "../../src/services/userService.js";

describe("Category hierarchy", () => {
  let user: { user_id: bigint; username: string };
  let other: { user_id: bigint; username: string };

  const mk = (name: string, userId = user.user_id, parent?: bigint | null) =>
    CategoryService.createCategory({
      name,
      description: "",
      color_gradient: "red",
      status: "A",
      type: "E",
      exclude_from_budgets: 0,
      users_user_id: userId,
      parent_category_id: parent,
    });

  beforeEach(async () => {
    user = await UserService.createUser({
      username: "demo",
      password: "123",
      email: "demo@afaneca.com",
    });
    other = await UserService.createUser({
      username: "other",
      password: "123",
      email: "other@afaneca.com",
    });
  });

  test("creates a subcategory under a top-level category", async () => {
    const parent = await mk("Food");
    const sub = await mk("Groceries", user.user_id, parent.category_id);
    expect(sub.parent_category_id).toBe(parent.category_id);
  });

  test("rejects a parent that itself has a parent", async () => {
    const top = await mk("Food");
    const sub = await mk("Groceries", user.user_id, top.category_id);
    await expect(mk("Veg", user.user_id, sub.category_id)).rejects.toThrow();
  });

  test("rejects giving a parent to a category that has subcategories", async () => {
    const a = await mk("A");
    await mk("A1", user.user_id, a.category_id);
    const b = await mk("B");
    await expect(CategoryService.setCategoryParent(user.user_id, a.category_id, b.category_id)).rejects.toThrow();
  });

  test("rejects a parent owned by another user", async () => {
    const foreign = await mk("Foreign", other.user_id);
    await expect(mk("Mine", user.user_id, foreign.category_id)).rejects.toThrow();
  });

  test("rejects a category as its own parent", async () => {
    const a = await mk("A");
    await expect(CategoryService.setCategoryParent(user.user_id, a.category_id, a.category_id)).rejects.toThrow();
  });

  test("setCategoryParent(null) makes a subcategory top-level", async () => {
    const parent = await mk("Food");
    const sub = await mk("Groceries", user.user_id, parent.category_id);
    await CategoryService.setCategoryParent(user.user_id, sub.category_id, null);
    const reloaded = await prisma.categories.findUnique({ where: { category_id: sub.category_id } });
    expect(reloaded?.parent_category_id).toBeNull();
  });

  test("delete is rejected while subcategories exist, allowed once they are moved", async () => {
    const parent = await mk("Food");
    const sub = await mk("Groceries", user.user_id, parent.category_id);
    await expect(CategoryService.deleteCategory(user.user_id, Number(parent.category_id))).rejects.toThrow();
    await CategoryService.setCategoryParent(user.user_id, sub.category_id, null);
    await CategoryService.deleteCategory(user.user_id, Number(parent.category_id));
    expect(await prisma.categories.findUnique({ where: { category_id: parent.category_id } })).toBeNull();
  });

  test("moving a category keeps its transactions", async () => {
    const p1 = await mk("P1");
    const p2 = await mk("P2");
    const c = await mk("C", user.user_id, p1.category_id);
    const trx = await prisma.transactions.create({
      data: {
        date_timestamp: 1,
        amount: 1000,
        type: "E",
        categories_category_id: c.category_id,
      },
    });
    await CategoryService.setCategoryParent(user.user_id, c.category_id, p2.category_id);
    const after = await prisma.transactions.findUnique({
      where: { transaction_id: trx.transaction_id },
    });
    expect(after?.categories_category_id).toBe(c.category_id);
  });
});
