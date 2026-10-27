-- AlterTable
ALTER TABLE `accounts` ADD COLUMN `is_retirement` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `invest_assets` ADD COLUMN `is_retirement` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `user_financial_profile` ADD COLUMN `date_of_birth` VARCHAR(10) NULL,
    ADD COLUMN `expected_return_pct` DECIMAL(5, 2) NOT NULL DEFAULT 10,
    ADD COLUMN `family_support_monthly` BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN `family_support_years` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `inflation_pct` DECIMAL(5, 2) NOT NULL DEFAULT 6,
    ADD COLUMN `retirement_age` INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN `retirement_spending_basis` VARCHAR(8) NOT NULL DEFAULT 'all',
    ADD COLUMN `swr_pct` DECIMAL(5, 2) NOT NULL DEFAULT 3.5;
