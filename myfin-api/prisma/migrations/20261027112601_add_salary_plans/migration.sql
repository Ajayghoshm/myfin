-- CreateTable
CREATE TABLE `salary_plans` (
    `salary_plan_id` BIGINT NOT NULL AUTO_INCREMENT,
    `users_user_id` BIGINT NOT NULL,
    `month` INTEGER NOT NULL,
    `salary_transaction_id` BIGINT NULL,
    `salary_amount` BIGINT NOT NULL,
    `buckets` JSON NOT NULL,
    `created_at` BIGINT NOT NULL,

    INDEX `salary_plans_trx_idx`(`salary_transaction_id`),
    UNIQUE INDEX `salary_plans_user_month_uq`(`users_user_id`, `month`),
    PRIMARY KEY (`salary_plan_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `salary_plans` ADD CONSTRAINT `salary_plans_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `salary_plans` ADD CONSTRAINT `salary_plans_salary_transaction_id_fkey` FOREIGN KEY (`salary_transaction_id`) REFERENCES `transactions`(`transaction_id`) ON DELETE SET NULL ON UPDATE CASCADE;
