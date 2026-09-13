const { SplitStripeAccounts1700000000014 } = require('../src/infrastructure/migrations/1700000000014-split-stripe-accounts');
const { CUSTOMER_META_KEYS, LEGACY_CUSTOMER_META_KEY } = require('../src/core/stripe-account');

describe('SplitStripeAccounts1700000000014', () => {
  test('adds stripe_account columns and renames the US customer meta key', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(true),
      hasColumn: jest.fn().mockResolvedValue(false),
      query: jest.fn().mockResolvedValue(undefined)
    };

    await new SplitStripeAccounts1700000000014().up(queryRunner);

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining("ADD COLUMN `stripe_account` VARCHAR(8) NOT NULL DEFAULT 'us'")
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      'ALTER TABLE `stripe_webhook_events` ADD PRIMARY KEY (`event_id`, `stripe_account`)'
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      'ALTER TABLE `stripe_first_purchase_promos` ADD PRIMARY KEY (`stripe_account`, `term_months`)'
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      'UPDATE `wp_usermeta` SET `meta_key` = ? WHERE `meta_key` = ?',
      [CUSTOMER_META_KEYS.us, LEGACY_CUSTOMER_META_KEY]
    );
  });
});
