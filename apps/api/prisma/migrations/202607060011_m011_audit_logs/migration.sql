-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `actor_role` VARCHAR(64) NULL,
    `action` VARCHAR(120) NOT NULL,
    `resource` VARCHAR(120) NOT NULL,
    `resource_id` VARCHAR(120) NOT NULL,
    `before_json` JSON NULL,
    `after_json` JSON NULL,
    `correlation_id` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_resource_resource_id_created_at_idx`(`resource`, `resource_id`, `created_at`),
    INDEX `audit_logs_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
