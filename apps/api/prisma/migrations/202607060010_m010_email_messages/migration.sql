-- CreateTable
CREATE TABLE `email_messages` (
    `id` CHAR(36) NOT NULL,
    `template_key` VARCHAR(120) NOT NULL,
    `recipient_email` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(80) NOT NULL,
    `status` ENUM('queued', 'sent', 'failed') NOT NULL DEFAULT 'queued',
    `error_message` VARCHAR(500) NULL,
    `payload_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sent_at` DATETIME(3) NULL,

    INDEX `email_messages_status_created_at_idx`(`status`, `created_at`),
    INDEX `email_messages_recipient_email_idx`(`recipient_email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
