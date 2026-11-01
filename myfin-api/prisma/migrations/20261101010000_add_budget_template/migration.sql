-- CreateTable
CREATE TABLE `budget_templates` (
    `template_id` BIGINT NOT NULL AUTO_INCREMENT,
    `users_user_id` BIGINT NOT NULL,
    `updated_at` BIGINT NOT NULL,

    UNIQUE INDEX `budget_templates_user_uq`(`users_user_id`),
    PRIMARY KEY (`template_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_template_rows` (
    `template_id` BIGINT NOT NULL,
    `categories_category_id` BIGINT NOT NULL,
    `planned_amount_credit` BIGINT NOT NULL DEFAULT 0,
    `planned_amount_debit` BIGINT NOT NULL DEFAULT 0,

    INDEX `budget_template_rows_category_idx`(`categories_category_id`),
    PRIMARY KEY (`template_id`, `categories_category_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_template_items` (
    `item_id` BIGINT NOT NULL AUTO_INCREMENT,
    `template_id` BIGINT NOT NULL,
    `categories_category_id` BIGINT NOT NULL,
    `direction` ENUM('EXPENSE', 'INCOME') NOT NULL,
    `label` VARCHAR(255) NOT NULL,
    `amount` BIGINT NOT NULL,
    `sort_order` INTEGER NOT NULL,

    INDEX `budget_template_items_row_idx`(`template_id`, `categories_category_id`, `direction`, `sort_order`),
    PRIMARY KEY (`item_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `budget_templates` ADD CONSTRAINT `budget_templates_users_fk` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `budget_template_rows` ADD CONSTRAINT `budget_template_rows_template_fk` FOREIGN KEY (`template_id`) REFERENCES `budget_templates`(`template_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `budget_template_rows` ADD CONSTRAINT `budget_template_rows_category_fk` FOREIGN KEY (`categories_category_id`) REFERENCES `categories`(`category_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `budget_template_items` ADD CONSTRAINT `budget_template_items_row_fk` FOREIGN KEY (`template_id`, `categories_category_id`) REFERENCES `budget_template_rows`(`template_id`, `categories_category_id`) ON DELETE CASCADE ON UPDATE CASCADE;
