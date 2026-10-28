-- CreateTable
CREATE TABLE `milestones` (
    `milestone_id` BIGINT NOT NULL AUTO_INCREMENT,
    `users_user_id` BIGINT NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `achieved_at` BIGINT NOT NULL,
    `dismissed` BOOLEAN NOT NULL DEFAULT false,
    `data` JSON NULL,

    UNIQUE INDEX `milestones_users_user_id_kind_key_key`(`users_user_id`, `kind`, `key`),
    PRIMARY KEY (`milestone_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `milestones` ADD CONSTRAINT `milestones_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
