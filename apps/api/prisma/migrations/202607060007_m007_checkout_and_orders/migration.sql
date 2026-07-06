-- CreateTable
CREATE TABLE `checkout_orders` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NULL,
    `user_id` CHAR(36) NOT NULL,
    `plan_snapshot_id` CHAR(36) NULL,
    `status` ENUM('draft', 'pending_payment', 'paid', 'failed', 'cancelled') NOT NULL DEFAULT 'draft',
    `currency` VARCHAR(3) NOT NULL,
    `subtotal` DECIMAL(12,2) NOT NULL,
    `shipping_total` DECIMAL(12,2) NOT NULL,
    `total` DECIMAL(12,2) NOT NULL,
    `payment_state` VARCHAR(80) NOT NULL,
    `metadata_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `checkout_orders_user_id_status_created_at_idx`(`user_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `checkout_order_items` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `product_id` CHAR(36) NOT NULL,
    `variant_id` CHAR(36) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unit_price` DECIMAL(12,2) NOT NULL,
    `line_total` DECIMAL(12,2) NOT NULL,
    `payload_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `checkout_order_items_order_id_idx`(`order_id`),
    INDEX `checkout_order_items_product_id_idx`(`product_id`),
    INDEX `checkout_order_items_variant_id_idx`(`variant_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `checkout_shipping_selection` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `quote_id` CHAR(36) NULL,
    `rate_id` CHAR(36) NULL,
    `label` VARCHAR(160) NOT NULL,
    `cost` DECIMAL(12,2) NOT NULL,
    `tax_total` DECIMAL(12,2) NOT NULL,
    `total` DECIMAL(12,2) NOT NULL,
    `raw_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `checkout_shipping_selection_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` CHAR(36) NOT NULL,
    `checkout_order_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `status` ENUM('new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'new',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `orders_user_id_status_created_at_idx`(`user_id`, `status`, `created_at`),
    INDEX `orders_checkout_order_id_idx`(`checkout_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_status_history` (
    `id` CHAR(36) NOT NULL,
    `order_id` CHAR(36) NOT NULL,
    `from_status` ENUM('new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled') NULL,
    `to_status` ENUM('new', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled') NOT NULL,
    `reason` VARCHAR(255) NULL,
    `changed_by_user_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_status_history_order_id_created_at_idx`(`order_id`, `created_at`),
    INDEX `order_status_history_changed_by_user_id_idx`(`changed_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddIndex
CREATE INDEX `subscriptions_order_id_idx` ON `subscriptions`(`order_id`);

-- AddForeignKey
ALTER TABLE `checkout_orders` ADD CONSTRAINT `checkout_orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkout_order_items` ADD CONSTRAINT `checkout_order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `checkout_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkout_order_items` ADD CONSTRAINT `checkout_order_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkout_order_items` ADD CONSTRAINT `checkout_order_items_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkout_shipping_selection` ADD CONSTRAINT `checkout_shipping_selection_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `checkout_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_checkout_order_id_fkey` FOREIGN KEY (`checkout_order_id`) REFERENCES `checkout_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_status_history` ADD CONSTRAINT `order_status_history_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_status_history` ADD CONSTRAINT `order_status_history_changed_by_user_id_fkey` FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `checkout_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
