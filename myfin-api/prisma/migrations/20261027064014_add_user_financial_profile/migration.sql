-- CreateTable
CREATE TABLE `user_financial_profile` (
    `users_user_id` BIGINT NOT NULL,
    `salary_category_id` BIGINT NULL,
    `salary_cutoff_day` INTEGER NOT NULL DEFAULT 25,
    `updated_at` BIGINT NOT NULL,

    PRIMARY KEY (`users_user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_financial_profile` ADD CONSTRAINT `user_financial_profile_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
