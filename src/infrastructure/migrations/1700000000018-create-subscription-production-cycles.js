const { Table, TableForeignKey, TableIndex } = require('typeorm');

const LEDGER_INDEX_NAME = 'idx_stripe_subscriptions_status_period_end';

class CreateSubscriptionProductionCycles1700000000018 {
  name = 'CreateSubscriptionProductionCycles1700000000018';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable('subscription_production_cycles'))) {
      await queryRunner.createTable(new Table({
        name: 'subscription_production_cycles',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment'
          },
          {
            name: 'subscription_id',
            type: 'int',
            unsigned: true,
            isNullable: false
          },
          {
            name: 'period_end',
            type: 'datetime',
            isNullable: false
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            isNullable: false
          },
          {
            name: 'note',
            type: 'varchar',
            length: '255',
            isNullable: true
          },
          {
            name: 'updated_by_user_id',
            type: 'bigint',
            unsigned: true,
            isNullable: true
          },
          {
            name: 'created_at',
            type: 'datetime',
            isNullable: false,
            default: 'CURRENT_TIMESTAMP'
          },
          {
            name: 'updated_at',
            type: 'datetime',
            isNullable: false,
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP'
          }
        ]
      }), true);

      await queryRunner.createForeignKey('subscription_production_cycles', new TableForeignKey({
        name: 'fk_subscription_production_cycles_subscription_id',
        columnNames: ['subscription_id'],
        referencedTableName: 'stripe_subscriptions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE'
      }));

      await queryRunner.createIndex('subscription_production_cycles', new TableIndex({
        name: 'uniq_subscription_production_cycle',
        columnNames: ['subscription_id', 'period_end'],
        isUnique: true
      }));

      await queryRunner.createIndex('subscription_production_cycles', new TableIndex({
        name: 'idx_subscription_production_cycles_status',
        columnNames: ['status']
      }));

      await queryRunner.createIndex('subscription_production_cycles', new TableIndex({
        name: 'idx_subscription_production_cycles_period_end',
        columnNames: ['period_end']
      }));
    }

    if (await queryRunner.hasTable('stripe_subscriptions')) {
      const table = await queryRunner.getTable('stripe_subscriptions');
      const hasIndex = Boolean(table && (table.indices || []).some((index) => index.name === LEDGER_INDEX_NAME));
      if (!hasIndex) {
        await queryRunner.createIndex('stripe_subscriptions', new TableIndex({
          name: LEDGER_INDEX_NAME,
          columnNames: ['status', 'current_period_end']
        }));
      }
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('stripe_subscriptions')) {
      const table = await queryRunner.getTable('stripe_subscriptions');
      const hasIndex = Boolean(table && (table.indices || []).some((index) => index.name === LEDGER_INDEX_NAME));
      if (hasIndex) {
        await queryRunner.dropIndex('stripe_subscriptions', LEDGER_INDEX_NAME);
      }
    }

    if (await queryRunner.hasTable('subscription_production_cycles')) {
      await queryRunner.dropTable('subscription_production_cycles');
    }
  }
}

module.exports = {
  CreateSubscriptionProductionCycles1700000000018
};
