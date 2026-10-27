-- AlterTable
ALTER TABLE `debt_payments` ADD COLUMN `original_amount` BIGINT NULL,
    ADD COLUMN `original_category_id` BIGINT NULL;
