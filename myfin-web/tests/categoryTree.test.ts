import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCategoryTree,
  categoryLabel,
} from '../src/services/category/categoryTree.ts';
import type { Category } from '../src/services/category/categoryServices.ts';

const cat = (
  id: number,
  name: string,
  parent: number | null = null,
): Category =>
  ({
    category_id: BigInt(id),
    name,
    parent_category_id: parent === null ? null : BigInt(parent),
  }) as Category;

describe('buildCategoryTree', () => {
  test('groups subcategories under their parent', () => {
    const tree = buildCategoryTree([
      cat(3, 'Online', 1),
      cat(2, 'Bills'),
      cat(1, 'Food'),
      cat(4, 'Dining', 1),
    ]);
    assert.deepEqual(
      tree.map((n) => n.category.name),
      ['Bills', 'Food'],
    );
    assert.deepEqual(
      tree[1].children.map((c) => c.name),
      ['Dining', 'Online'],
    );
  });

  test('top-level categories with no children have empty children', () => {
    const tree = buildCategoryTree([cat(1, 'Food')]);
    assert.deepEqual(tree[0].children, []);
  });

  test('a category whose parent is missing is treated as top-level', () => {
    const tree = buildCategoryTree([cat(1, 'Food'), cat(2, 'Orphan', 99)]);
    assert.deepEqual(
      tree.map((n) => n.category.name),
      ['Food', 'Orphan'],
    );
  });
});

describe('categoryLabel', () => {
  test('categoryLabel joins parent and child with " › "', () => {
    const all = [cat(1, 'Food'), cat(2, 'Online', 1)];
    assert.equal(categoryLabel(all[1], all), 'Food › Online');
    assert.equal(categoryLabel(all[0], all), 'Food');
  });
});
