-- CreateTable
CREATE TABLE `legacy_entries` (
    `entry_id` BIGINT NOT NULL AUTO_INCREMENT,
    `users_user_id` BIGINT NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `account_id` BIGINT NULL,
    `data` JSON NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` BIGINT NOT NULL,
    `updated_at` BIGINT NOT NULL,

    INDEX `legacy_entries_user_idx`(`users_user_id`),
    INDEX `legacy_entries_account_idx`(`account_id`),
    PRIMARY KEY (`entry_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `legacy_entries` ADD CONSTRAINT `legacy_entries_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `legacy_entries` ADD CONSTRAINT `legacy_entries_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`account_id`) ON DELETE SET NULL ON UPDATE CASCADE;
