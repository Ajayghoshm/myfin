-- A user can keep several named templates. The plain index must exist before the unique one
-- can go, because the users foreign key relies on an index starting with users_user_id.
ALTER TABLE `budget_templates` ADD COLUMN `name` VARCHAR(100) NOT NULL DEFAULT 'Default';
CREATE INDEX `budget_templates_user_idx` ON `budget_templates`(`users_user_id`);
DROP INDEX `budget_templates_user_uq` ON `budget_templates`;
CREATE UNIQUE INDEX `budget_templates_user_name_uq` ON `budget_templates`(`users_user_id`, `name`);
