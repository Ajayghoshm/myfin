-- AlterTable
ALTER TABLE `transactions` ADD COLUMN `external_id` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `import_instrument_mappings` (
    `mapping_id` BIGINT NOT NULL AUTO_INCREMENT,
    `users_user_id` BIGINT NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `instrument_key` VARCHAR(64) NOT NULL,
    `accounts_account_id` BIGINT NOT NULL,

    UNIQUE INDEX `import_instrument_mappings_users_user_id_source_instrument_k_key`(`users_user_id`, `source`, `instrument_key`),
    PRIMARY KEY (`mapping_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `transactions_external_id_idx` ON `transactions`(`external_id`);

-- AddForeignKey
ALTER TABLE `import_instrument_mappings` ADD CONSTRAINT `import_instrument_mappings_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_instrument_mappings` ADD CONSTRAINT `import_instrument_mappings_accounts_account_id_fkey` FOREIGN KEY (`accounts_account_id`) REFERENCES `accounts`(`account_id`) ON DELETE CASCADE ON UPDATE CASCADE;
