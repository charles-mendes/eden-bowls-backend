const { Table, TableIndex } = require('typeorm');

class CreateStripeSubscriptionLedgerTables1700000000009 {
  name = 'CreateStripeSubscriptionLedgerTables1700000000009';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable('stripe_subscriptions'))) {
      await queryRunner.createTable(new Table({
        name: 'stripe_subscriptions',
        columns: [
          { name: 'id', type: 'int', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'user_id', type: 'bigint', unsigned: true, isNullable: false },
          { name: 'customer_email', type: 'varchar', length: '255', isNullable: true },
          { name: 'stripe_subscription_id', type: 'varchar', length: '64', isNullable: false, isUnique: true },
          { name: 'stripe_customer_id', type: 'varchar', length: '64', isNullable: false },
          { name: 'status', type: 'varchar', length: '32', isNullable: false },
          { name: 'plan_label', type: 'varchar', length: '128', isNullable: true },
          { name: 'stripe_price_id', type: 'varchar', length: '64', isNullable: true },
          { name: 'current_period_start', type: 'datetime', isNullable: true },
          { name: 'current_period_end', type: 'datetime', isNullable: true },
          { name: 'cancel_at_period_end', type: 'tinyint', width: 1, isNullable: false, default: 0 },
          { name: 'payment_method_last4', type: 'varchar', length: '8', isNullable: true },
          { name: 'payment_method_brand', type: 'varchar', length: '32', isNullable: true },
          { name: 'pets_snapshot', type: 'json', isNullable: true },
          { name: 'plan_selection', type: 'json', isNullable: true },
          { name: 'shipping', type: 'json', isNullable: true },
          { name: 'address', type: 'json', isNullable: true },
          { name: 'subscription_term_months', type: 'tinyint', unsigned: true, isNullable: true },
          { name: 'edit_payment_pending', type: 'tinyint', width: 1, isNullable: false, default: 0 },
          { name: 'edit_pending', type: 'json', isNullable: true },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ]
      }), true);

      await queryRunner.createIndex('stripe_subscriptions', new TableIndex({
        name: 'idx_stripe_subscriptions_user_id',
        columnNames: ['user_id']
      }));
    }

    if (!(await queryRunner.hasTable('stripe_webhook_events'))) {
      await queryRunner.createTable(new Table({
        name: 'stripe_webhook_events',
        columns: [
          { name: 'event_id', type: 'varchar', length: '64', isPrimary: true },
          { name: 'type', type: 'varchar', length: '64', isNullable: false },
          { name: 'processed_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'payload_summary', type: 'json', isNullable: true }
        ]
      }), true);
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('stripe_webhook_events')) {
      await queryRunner.dropTable('stripe_webhook_events');
    }

    if (await queryRunner.hasTable('stripe_subscriptions')) {
      await queryRunner.dropTable('stripe_subscriptions');
    }
  }
}

module.exports = {
  CreateStripeSubscriptionLedgerTables1700000000009
};
