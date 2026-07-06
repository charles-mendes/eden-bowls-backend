-- CreateTable
CREATE TABLE `shipping_quotes` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `provider` ENUM('manual_local', 'usps', 'correios', 'melhor_envio', 'custom') NOT NULL,
    `destination_country` VARCHAR(2) NOT NULL,
    `destination_postcode` VARCHAR(30) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `subtotal` DECIMAL(12,2) NOT NULL,
    `selected_rate_id` CHAR(36) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shipping_quotes_session_id_expires_at_idx`(`session_id`, `expires_at`),
    INDEX `shipping_quotes_provider_expires_at_idx`(`provider`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shipping_quote_rates` (
    `id` CHAR(36) NOT NULL,
    `quote_id` CHAR(36) NOT NULL,
    `external_rate_id` VARCHAR(120) NULL,
    `service_code` VARCHAR(80) NOT NULL,
    `service_label` VARCHAR(160) NOT NULL,
    `amount` DECIMAL(12,2) NOT NULL,
    `eta_min_days` INTEGER NULL,
    `eta_max_days` INTEGER NULL,
    `raw_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shipping_quote_rates_quote_id_idx`(`quote_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `shipping_quote_rates` ADD CONSTRAINT `shipping_quote_rates_quote_id_fkey` FOREIGN KEY (`quote_id`) REFERENCES `shipping_quotes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
