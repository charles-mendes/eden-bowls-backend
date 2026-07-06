-- CreateTable
CREATE TABLE `stripe_customers` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `stripe_customer_id` VARCHAR(120) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `metadata_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `stripe_customers_user_id_idx`(`user_id`),
    UNIQUE INDEX `stripe_customers_stripe_customer_id_key`(`stripe_customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stripe_payment_methods` (
    `id` CHAR(36) NOT NULL,
    `stripe_customer_ref_id` CHAR(36) NOT NULL,
    `stripe_payment_method_id` VARCHAR(120) NOT NULL,
    `brand` VARCHAR(50) NULL,
    `last4` VARCHAR(4) NULL,
    `exp_month` INTEGER NULL,
    `exp_year` INTEGER NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `stripe_payment_methods_stripe_customer_ref_id_is_default_idx`(`stripe_customer_ref_id`, `is_default`),
    UNIQUE INDEX `stripe_payment_methods_stripe_payment_method_id_key`(`stripe_payment_method_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stripe_product_price_map` (
    `id` CHAR(36) NOT NULL,
    `variant_id` CHAR(36) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `stripe_product_id` VARCHAR(120) NOT NULL,
    `stripe_price_id` VARCHAR(120) NOT NULL,
    `fingerprint` VARCHAR(255) NOT NULL,
    `synced_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `stripe_product_price_map_currency_synced_at_idx`(`currency`, `synced_at`),
    UNIQUE INDEX `stripe_product_price_map_variant_id_currency_key`(`variant_id`, `currency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_events` (
    `id` CHAR(36) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `event_type` VARCHAR(120) NOT NULL,
    `payload_hash` VARCHAR(255) NOT NULL,
    `state` ENUM('processing', 'processed', 'failed') NOT NULL DEFAULT 'processing',
    `attempts` INTEGER NOT NULL DEFAULT 1,
    `next_retry_at` DATETIME(3) NULL,
    `correlation_id` VARCHAR(120) NULL,
    `payload_json` JSON NOT NULL,
    `error_message` VARCHAR(500) NULL,
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `webhook_events_provider_state_next_retry_at_idx`(`provider`, `state`, `next_retry_at`),
    UNIQUE INDEX `webhook_events_provider_event_id_key`(`provider`, `event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stripe_customers` ADD CONSTRAINT `stripe_customers_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stripe_payment_methods` ADD CONSTRAINT `stripe_payment_methods_stripe_customer_ref_id_fkey` FOREIGN KEY (`stripe_customer_ref_id`) REFERENCES `stripe_customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stripe_product_price_map` ADD CONSTRAINT `stripe_product_price_map_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
