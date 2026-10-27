-- AlterTable
ALTER TABLE `accounts` ADD COLUMN `is_emergency_fund` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `user_financial_profile` ADD COLUMN `emergency_fund_target_months` INTEGER NOT NULL DEFAULT 6,
    ADD COLUMN `emergency_topup_percent` INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN `savings_target_account_id` BIGINT NULL,
    ADD COLUMN `savings_target_mode` VARCHAR(8) NOT NULL DEFAULT 'amount',
    ADD COLUMN `savings_target_value` BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN `sinking_fund_account_id` BIGINT NULL;
