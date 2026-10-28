-- CreateTable
CREATE TABLE `events` (
    `event_id` BIGINT NOT NULL AUTO_INCREMENT,
    `users_user_id` BIGINT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `repeat` VARCHAR(8) NOT NULL,
    `amount` BIGINT NULL,
    `gift_budget` BIGINT NULL,
    `account_id` BIGINT NULL,
    `category_id` BIGINT NULL,
    `payee_key` VARCHAR(255) NULL,
    `tag_id` BIGINT NULL,
    `source_key` VARCHAR(255) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` BIGINT NOT NULL,

    INDEX `events_user_idx`(`users_user_id`),
    UNIQUE INDEX `events_user_source_key`(`users_user_id`, `source_key`),
    PRIMARY KEY (`event_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_occurrences` (
    `occurrence_id` BIGINT NOT NULL AUTO_INCREMENT,
    `events_event_id` BIGINT NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'pending',
    `done_at` BIGINT NULL,

    UNIQUE INDEX `event_occurrences_event_date`(`events_event_id`, `date`),
    PRIMARY KEY (`occurrence_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_occurrence_transactions` (
    `occurrence_id` BIGINT NOT NULL,
    `transaction_id` BIGINT NOT NULL,

    UNIQUE INDEX `event_occurrence_transactions_trx`(`transaction_id`),
    PRIMARY KEY (`occurrence_id`, `transaction_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_suggestion_dismissals` (
    `users_user_id` BIGINT NOT NULL,
    `key` VARCHAR(255) NOT NULL,

    PRIMARY KEY (`users_user_id`, `key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `events_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `events_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`account_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `events_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`tag_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_occurrences` ADD CONSTRAINT `event_occurrences_events_event_id_fkey` FOREIGN KEY (`events_event_id`) REFERENCES `events`(`event_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_occurrence_transactions` ADD CONSTRAINT `event_occurrence_transactions_occurrence_id_fkey` FOREIGN KEY (`occurrence_id`) REFERENCES `event_occurrences`(`occurrence_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_occurrence_transactions` ADD CONSTRAINT `event_occurrence_transactions_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`transaction_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_suggestion_dismissals` ADD CONSTRAINT `event_suggestion_dismissals_users_user_id_fkey` FOREIGN KEY (`users_user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;
