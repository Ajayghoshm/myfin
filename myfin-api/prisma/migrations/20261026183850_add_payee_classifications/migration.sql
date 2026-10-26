-- CreateTable
CREATE TABLE `payee_classifications` (
    `classification_id` BIGINT NOT NULL AUTO_INCREMENT,
    `users_user_id` BIGINT NOT NULL,
    `payee_key` VARCHAR(255) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,

    UNIQUE INDEX `payee_classifications_users_user_id_payee_key_key`(`users_user_id`, `payee_key`),
    PRIMARY KEY (`classification_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payee_classifications` ADD CONSTRAINT `payee_classifications_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
