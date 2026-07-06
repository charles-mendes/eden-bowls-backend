-- CreateTable
CREATE TABLE `onboarding_sessions` (
    `id` CHAR(36) NOT NULL,
    `status` ENUM('started', 'in_progress', 'ready_for_checkout', 'completed', 'abandoned') NOT NULL DEFAULT 'started',
    `linked_user_id` CHAR(36) NULL,
    `locale` VARCHAR(10) NOT NULL,
    `country` VARCHAR(2) NOT NULL,
    `state` VARCHAR(80) NULL,
    `token_hash` VARCHAR(255) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `onboarding_sessions_status_expires_at_updated_at_idx`(`status`, `expires_at`, `updated_at`),
    INDEX `onboarding_sessions_linked_user_id_idx`(`linked_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_session_pets` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `pet_id` CHAR(36) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `onboarding_session_pets_session_id_pet_id_key`(`session_id`, `pet_id`),
    INDEX `onboarding_session_pets_session_id_sort_order_idx`(`session_id`, `sort_order`),
    INDEX `onboarding_session_pets_pet_id_idx`(`pet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_answers` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `step_key` VARCHAR(120) NOT NULL,
    `answer_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `onboarding_answers_session_id_step_key_key`(`session_id`, `step_key`),
    INDEX `onboarding_answers_session_id_updated_at_idx`(`session_id`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recommendation_runs` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `recommendation_version` VARCHAR(80) NOT NULL,
    `market_country` VARCHAR(2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `total_daily_grams` DECIMAL(12, 3) NOT NULL,
    `total_monthly_grams` DECIMAL(12, 3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recommendation_runs_session_id_created_at_idx`(`session_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recommendation_pet_results` (
    `id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `pet_id` CHAR(36) NOT NULL,
    `daily_grams` DECIMAL(12, 3) NOT NULL,
    `monthly_grams` DECIMAL(12, 3) NOT NULL,
    `kcal_target` INTEGER NULL,
    `factors_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recommendation_pet_results_run_id_idx`(`run_id`),
    INDEX `recommendation_pet_results_pet_id_idx`(`pet_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_snapshots` (
    `id` CHAR(36) NOT NULL,
    `run_id` CHAR(36) NOT NULL,
    `snapshot_hash` VARCHAR(191) NOT NULL,
    `subtotal_amount` DECIMAL(12, 2) NOT NULL,
    `discount_amount` DECIMAL(12, 2) NOT NULL,
    `shipping_amount` DECIMAL(12, 2) NULL,
    `total_amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `payload_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `plan_snapshots_snapshot_hash_key`(`snapshot_hash`),
    INDEX `plan_snapshots_run_id_idx`(`run_id`),
    INDEX `plan_snapshots_snapshot_hash_idx`(`snapshot_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `onboarding_sessions` ADD CONSTRAINT `onboarding_sessions_linked_user_id_fkey`
    FOREIGN KEY (`linked_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_session_pets` ADD CONSTRAINT `onboarding_session_pets_session_id_fkey`
    FOREIGN KEY (`session_id`) REFERENCES `onboarding_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_session_pets` ADD CONSTRAINT `onboarding_session_pets_pet_id_fkey`
    FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_answers` ADD CONSTRAINT `onboarding_answers_session_id_fkey`
    FOREIGN KEY (`session_id`) REFERENCES `onboarding_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recommendation_runs` ADD CONSTRAINT `recommendation_runs_session_id_fkey`
    FOREIGN KEY (`session_id`) REFERENCES `onboarding_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recommendation_pet_results` ADD CONSTRAINT `recommendation_pet_results_run_id_fkey`
    FOREIGN KEY (`run_id`) REFERENCES `recommendation_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recommendation_pet_results` ADD CONSTRAINT `recommendation_pet_results_pet_id_fkey`
    FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_snapshots` ADD CONSTRAINT `plan_snapshots_run_id_fkey`
    FOREIGN KEY (`run_id`) REFERENCES `recommendation_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

