-- AlterTable
ALTER TABLE `transactions` ADD COLUMN `yearly_cost_id` BIGINT NULL;

-- CreateTable
CREATE TABLE `yearly_costs` (
    `yearly_cost_id` BIGINT NOT NULL AUTO_INCREMENT,
    `users_user_id` BIGINT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `amount` BIGINT NOT NULL,
    `due_month` INTEGER NOT NULL,
    `category_id` BIGINT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` BIGINT NOT NULL,

    INDEX `yearly_costs_user_idx`(`users_user_id`),
    PRIMARY KEY (`yearly_cost_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `yearly_cost_dismissals` (
    `users_user_id` BIGINT NOT NULL,
    `payee_key` VARCHAR(255) NOT NULL,

    PRIMARY KEY (`users_user_id`, `payee_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `transactions_yearly_cost_idx` ON `transactions`(`yearly_cost_id`);

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_yearly_cost_fk` FOREIGN KEY (`yearly_cost_id`) REFERENCES `yearly_costs`(`yearly_cost_id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `yearly_costs` ADD CONSTRAINT `yearly_costs_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `yearly_cost_dismissals` ADD CONSTRAINT `yearly_cost_dismissals_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
