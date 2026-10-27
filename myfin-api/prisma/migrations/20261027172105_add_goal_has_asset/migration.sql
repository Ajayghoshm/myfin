-- CreateTable
CREATE TABLE `goal_has_asset` (
    `goals_goal_id` BIGINT NOT NULL,
    `invest_assets_asset_id` BIGINT NOT NULL,
    `match_type` VARCHAR(45) NOT NULL,
    `match_value` DECIMAL(16, 6) NOT NULL,

    INDEX `fk_goal_has_asset_goals1_idx`(`goals_goal_id`),
    INDEX `fk_goal_has_asset_assets1_idx`(`invest_assets_asset_id`),
    PRIMARY KEY (`goals_goal_id`, `invest_assets_asset_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `goal_has_asset` ADD CONSTRAINT `goal_has_asset_goals_goal_id_fk` FOREIGN KEY (`goals_goal_id`) REFERENCES `goals`(`goal_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `goal_has_asset` ADD CONSTRAINT `goal_has_asset_invest_assets_asset_id_fk` FOREIGN KEY (`invest_assets_asset_id`) REFERENCES `invest_assets`(`asset_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
