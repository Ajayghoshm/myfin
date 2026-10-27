-- AlterTable
ALTER TABLE `transactions` ADD COLUMN `debt_id` BIGINT NULL,
    ADD COLUMN `debt_role` VARCHAR(12) NULL;

-- CreateTable
CREATE TABLE `debts` (
    `debt_id` BIGINT NOT NULL AUTO_INCREMENT,
    `users_user_id` BIGINT NOT NULL,
    `kind` VARCHAR(10) NOT NULL,
    `counterparty_name` VARCHAR(255) NOT NULL,
    `counterparty_key` VARCHAR(255) NULL,
    `principal` BIGINT NOT NULL,
    `rate` DECIMAL(6, 3) NOT NULL DEFAULT 0,
    `tenure_months` INTEGER NULL,
    `emi` BIGINT NULL,
    `emi_day` INTEGER NULL,
    `account_id` BIGINT NULL,
    `loan_account_id` BIGINT NULL,
    `start_date` BIGINT NOT NULL,
    `due_date` BIGINT NULL,
    `note` TEXT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'open',
    `created_at` BIGINT NOT NULL,

    INDEX `debts_user_idx`(`users_user_id`),
    PRIMARY KEY (`debt_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `debt_payments` (
    `payment_id` BIGINT NOT NULL AUTO_INCREMENT,
    `debts_debt_id` BIGINT NOT NULL,
    `date` BIGINT NOT NULL,
    `amount` BIGINT NOT NULL,
    `principal_part` BIGINT NOT NULL,
    `interest_part` BIGINT NOT NULL DEFAULT 0,
    `transaction_id` BIGINT NULL,
    `principal_transaction_id` BIGINT NULL,
    `installment_no` INTEGER NULL,
    `manual` BOOLEAN NOT NULL DEFAULT false,

    INDEX `debt_payments_debt_idx`(`debts_debt_id`),
    PRIMARY KEY (`payment_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `transactions_debt_idx` ON `transactions`(`debt_id`);

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_debt_fk` FOREIGN KEY (`debt_id`) REFERENCES `debts`(`debt_id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `debts` ADD CONSTRAINT `debts_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `debts` ADD CONSTRAINT `debts_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`account_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `debts` ADD CONSTRAINT `debts_loan_account_id_fkey` FOREIGN KEY (`loan_account_id`) REFERENCES `accounts`(`account_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `debt_payments` ADD CONSTRAINT `debt_payments_debts_debt_id_fkey` FOREIGN KEY (`debts_debt_id`) REFERENCES `debts`(`debt_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `debt_payments` ADD CONSTRAINT `debt_payments_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`transaction_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `debt_payments` ADD CONSTRAINT `debt_payments_principal_transaction_id_fkey` FOREIGN KEY (`principal_transaction_id`) REFERENCES `transactions`(`transaction_id`) ON DELETE SET NULL ON UPDATE CASCADE;
