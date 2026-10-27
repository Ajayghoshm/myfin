-- CreateTable
CREATE TABLE `planned_transactions` (
    `planned_id` BIGINT NOT NULL AUTO_INCREMENT,
    `users_user_id` BIGINT NOT NULL,
    `date_timestamp` BIGINT NOT NULL,
    `amount` BIGINT NOT NULL,
    `type` CHAR(1) NOT NULL,
    `accounts_account_from_id` BIGINT NULL,
    `accounts_account_to_id` BIGINT NULL,
    `categories_category_id` BIGINT NULL,
    `description` VARCHAR(255) NOT NULL,
    `salary_plan_id` BIGINT NULL,
    `bucket` VARCHAR(16) NULL,
    `created_at` BIGINT NOT NULL,

    INDEX `planned_transactions_user_date_idx`(`users_user_id`, `date_timestamp`),
    PRIMARY KEY (`planned_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `planned_transactions` ADD CONSTRAINT `planned_transactions_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `planned_transactions` ADD CONSTRAINT `planned_transactions_accounts_account_from_id_fkey` FOREIGN KEY (`accounts_account_from_id`) REFERENCES `accounts`(`account_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `planned_transactions` ADD CONSTRAINT `planned_transactions_accounts_account_to_id_fkey` FOREIGN KEY (`accounts_account_to_id`) REFERENCES `accounts`(`account_id`) ON DELETE CASCADE ON UPDATE CASCADE;
