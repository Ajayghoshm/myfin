-- CreateTable
CREATE TABLE `balance_checks` (
    `check_id` BIGINT NOT NULL AUTO_INCREMENT,
    `accounts_account_id` BIGINT NOT NULL,
    `checked_at` BIGINT NOT NULL,
    `real_balance` BIGINT NOT NULL,
    `myfin_balance` BIGINT NOT NULL,
    `result` VARCHAR(16) NOT NULL,
    `adjustment_transaction_id` BIGINT NULL,

    INDEX `idx_balance_checks_account`(`accounts_account_id`, `checked_at`),
    PRIMARY KEY (`check_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `balance_checks` ADD CONSTRAINT `balance_checks_accounts_account_id_fkey` FOREIGN KEY (`accounts_account_id`) REFERENCES `accounts`(`account_id`) ON DELETE CASCADE ON UPDATE CASCADE;
