import type { Category } from './categoryServices.ts';

export type CategoryNode = { category: Category; children: Category[] };

const byName = (a: Category, b: Category) => a.name.localeCompare(b.name);

export const buildCategoryTree = (categories: Category[]): CategoryNode[] => {
  const ids = new Set(categories.map((c) => String(c.category_id)));
  const hasParent = (c: Category) =>
    c.parent_category_id != null && ids.has(String(c.parent_category_id));

  return categories
    .filter((c) => !hasParent(c))
    .sort(byName)
    .map((category) => ({
      category,
      children: categories
        .filter(
          (c) =>
            hasParent(c) &&
            String(c.parent_category_id) === String(category.category_id),
        )
        .sort(byName),
    }));
};

export const categoryLabel = (category: Category, all: Category[]): string => {
  if (category.parent_category_id == null) return category.name;
  const parent = all.find(
    (c) => String(c.category_id) === String(category.parent_category_id),
  );
  return parent ? `${parent.name} › ${category.name}` : category.name;
};
