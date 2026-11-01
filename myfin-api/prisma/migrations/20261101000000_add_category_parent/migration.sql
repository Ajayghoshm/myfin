-- AlterTable
ALTER TABLE `categories` ADD COLUMN `parent_category_id` BIGINT NULL;

-- CreateIndex
CREATE INDEX `categories_parent_idx` ON `categories`(`parent_category_id`);

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_parent_fk` FOREIGN KEY (`parent_category_id`) REFERENCES `categories`(`category_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
