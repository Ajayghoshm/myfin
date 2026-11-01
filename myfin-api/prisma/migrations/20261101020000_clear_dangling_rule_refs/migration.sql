-- Rules have no foreign keys to entities/categories; clear references to rows that were deleted
UPDATE rules SET assign_entity_id = NULL
WHERE assign_entity_id IS NOT NULL
  AND assign_entity_id NOT IN (SELECT entity_id FROM entities);

UPDATE rules SET assign_category_id = NULL
WHERE assign_category_id IS NOT NULL
  AND assign_category_id NOT IN (SELECT category_id FROM categories);
