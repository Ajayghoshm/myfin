-- CreateTable
CREATE TABLE `monthly_records` (
    `users_user_id` BIGINT NOT NULL,
    `month` INTEGER NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `data` JSON NOT NULL,
    `frozen_at` BIGINT NULL,

    PRIMARY KEY (`users_user_id`, `month`, `kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `monthly_records` ADD CONSTRAINT `monthly_records_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
