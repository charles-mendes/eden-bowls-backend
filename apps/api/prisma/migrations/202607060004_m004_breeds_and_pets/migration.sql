-- CreateTable
CREATE TABLE `breeds` (
    `id` CHAR(36) NOT NULL,
    `species` ENUM('dog', 'cat') NOT NULL,
    `name_pt` VARCHAR(120) NOT NULL,
    `name_en` VARCHAR(120) NOT NULL,
    `size` VARCHAR(40) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `breeds_species_idx`(`species`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pets` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NULL,
    `name` VARCHAR(120) NOT NULL,
    `species` ENUM('dog', 'cat') NOT NULL,
    `breed_id` CHAR(36) NULL,
    `sex` ENUM('male', 'female', 'unknown') NULL,
    `birth_date` DATE NULL,
    `weight_kg` DECIMAL(8,3) NOT NULL,
    `neutered` BOOLEAN NOT NULL,
    `activity_level` VARCHAR(40) NOT NULL,
    `body_condition_score` INTEGER NULL,
    `nutrition_goal` VARCHAR(120) NULL,
    `restrictions_json` JSON NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pets_user_id_deleted_at_idx`(`user_id`, `deleted_at`),
    INDEX `pets_species_idx`(`species`),
    INDEX `pets_breed_id_idx`(`breed_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pets` ADD CONSTRAINT `pets_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pets` ADD CONSTRAINT `pets_breed_id_fkey` FOREIGN KEY (`breed_id`) REFERENCES `breeds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
