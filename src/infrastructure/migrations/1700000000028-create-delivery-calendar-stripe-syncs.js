const { Table, TableIndex } = require('typeorm');

const TABLE_NAME = 'delivery_calendar_stripe_syncs';
const DUE_INDEX = 'idx_delivery_calendar_syncs_status_due';
const SUBSCRIPTION_INDEX = 'idx_delivery_calendar_syncs_subscription';

// One row per subscription a calendar closure moved. It is written in the closure's transaction, and the
// background job applies `target_trial_end` in Stripe only while Stripe still has `expected_trial_end`.
class CreateDeliveryCalendarStripeSyncs1700000000028 {
  name = 'CreateDeliveryCalendarStripeSyncs1700000000028';

  async up(queryRunner) {
    if (await queryRunner.hasTable(TABLE_NAME)) {
      return;
    }
    await queryRunner.createTable(new Table({
      name: TABLE_NAME,
      columns: [
        { name: 'id', type: 'int', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        { name: 'stripe_subscription_id', type: 'varchar', length: '64', isNullable: false },
        { name: 'market', type: 'varchar', length: '8', isNullable: false },
        { name: 'audit_event_id', type: 'bigint', unsigned: true, isNullable: true },
        { name: 'expected_trial_end', type: 'datetime', isNullable: true },
        { name: 'target_trial_end', type: 'datetime', isNullable: false },
        { name: 'found_trial_end', type: 'datetime', isNullable: true },
        { name: 'status', type: 'varchar', length: '16', isNullable: false, default: "'pending'" },
        { name: 'attempts', type: 'int', isNullable: false, default: 0 },
        { name: 'last_error', type: 'varchar', length: '500', isNullable: true },
        { name: 'next_attempt_at', type: 'datetime', isNullable: true },
        { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'synced_at', type: 'datetime', isNullable: true }
      ]
    }), true);
    await queryRunner.createIndex(TABLE_NAME, new TableIndex({
      name: DUE_INDEX,
      columnNames: ['status', 'next_attempt_at']
    }));
    await queryRunner.createIndex(TABLE_NAME, new TableIndex({
      name: SUBSCRIPTION_INDEX,
      columnNames: ['stripe_subscription_id', 'status']
    }));
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE_NAME)) {
      await queryRunner.dropTable(TABLE_NAME);
    }
  }
}

module.exports = {
  CreateDeliveryCalendarStripeSyncs1700000000028
};
