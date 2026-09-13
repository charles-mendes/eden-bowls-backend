const {
  LEGACY_CUSTOMER_META_KEY,
  CUSTOMER_META_KEYS
} = require('../../core/stripe-account');

class SplitStripeAccounts1700000000014 {
  name = 'SplitStripeAccounts1700000000014';

  async up(queryRunner) {
    if (await queryRunner.hasTable('stripe_subscriptions')) {
      const hasAccount = await queryRunner.hasColumn('stripe_subscriptions', 'stripe_account');
      if (!hasAccount) {
        await queryRunner.query(
          "ALTER TABLE `stripe_subscriptions` ADD COLUMN `stripe_account` VARCHAR(8) NOT NULL DEFAULT 'us'"
        );
      }
    }

    if (await queryRunner.hasTable('stripe_webhook_events')) {
      const hasAccount = await queryRunner.hasColumn('stripe_webhook_events', 'stripe_account');
      if (!hasAccount) {
        await queryRunner.query(
          "ALTER TABLE `stripe_webhook_events` ADD COLUMN `stripe_account` VARCHAR(8) NOT NULL DEFAULT 'us'"
        );
        await queryRunner.query('ALTER TABLE `stripe_webhook_events` DROP PRIMARY KEY');
        await queryRunner.query(
          'ALTER TABLE `stripe_webhook_events` ADD PRIMARY KEY (`event_id`, `stripe_account`)'
        );
      }
    }

    if (await queryRunner.hasTable('stripe_first_purchase_promos')) {
      const hasAccount = await queryRunner.hasColumn('stripe_first_purchase_promos', 'stripe_account');
      if (!hasAccount) {
        await queryRunner.query(
          "ALTER TABLE `stripe_first_purchase_promos` ADD COLUMN `stripe_account` VARCHAR(8) NOT NULL DEFAULT 'us' FIRST"
        );
        await queryRunner.query('ALTER TABLE `stripe_first_purchase_promos` DROP PRIMARY KEY');
        await queryRunner.query(
          'ALTER TABLE `stripe_first_purchase_promos` ADD PRIMARY KEY (`stripe_account`, `term_months`)'
        );
      }
    }

    if (await queryRunner.hasTable('wp_usermeta')) {
      await queryRunner.query(
        'UPDATE `wp_usermeta` SET `meta_key` = ? WHERE `meta_key` = ?',
        [CUSTOMER_META_KEYS.us, LEGACY_CUSTOMER_META_KEY]
      );
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('wp_usermeta')) {
      await queryRunner.query(
        'UPDATE `wp_usermeta` SET `meta_key` = ? WHERE `meta_key` = ?',
        [LEGACY_CUSTOMER_META_KEY, CUSTOMER_META_KEYS.us]
      );
    }

    if (await queryRunner.hasTable('stripe_first_purchase_promos')
      && await queryRunner.hasColumn('stripe_first_purchase_promos', 'stripe_account')) {
      await queryRunner.query(
        "DELETE FROM `stripe_first_purchase_promos` WHERE `stripe_account` <> 'us'"
      );
      await queryRunner.query('ALTER TABLE `stripe_first_purchase_promos` DROP PRIMARY KEY');
      await queryRunner.query('ALTER TABLE `stripe_first_purchase_promos` DROP COLUMN `stripe_account`');
      await queryRunner.query(
        'ALTER TABLE `stripe_first_purchase_promos` ADD PRIMARY KEY (`term_months`)'
      );
    }

    if (await queryRunner.hasTable('stripe_webhook_events')
      && await queryRunner.hasColumn('stripe_webhook_events', 'stripe_account')) {
      await queryRunner.query(
        "DELETE FROM `stripe_webhook_events` WHERE `stripe_account` <> 'us'"
      );
      await queryRunner.query('ALTER TABLE `stripe_webhook_events` DROP PRIMARY KEY');
      await queryRunner.query('ALTER TABLE `stripe_webhook_events` DROP COLUMN `stripe_account`');
      await queryRunner.query(
        'ALTER TABLE `stripe_webhook_events` ADD PRIMARY KEY (`event_id`)'
      );
    }

    if (await queryRunner.hasTable('stripe_subscriptions')
      && await queryRunner.hasColumn('stripe_subscriptions', 'stripe_account')) {
      await queryRunner.query('ALTER TABLE `stripe_subscriptions` DROP COLUMN `stripe_account`');
    }
  }
}

module.exports = {
  SplitStripeAccounts1700000000014
};
