-- AlterTable
ALTER TABLE `user_financial_profile` ADD COLUMN `small_spend_cutoff` BIGINT NOT NULL DEFAULT 20000;
