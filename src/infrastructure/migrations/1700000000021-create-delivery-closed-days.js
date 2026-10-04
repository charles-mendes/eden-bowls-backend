const { Table, TableIndex } = require('typeorm');
const { buildSeedRows } = require('../../core/delivery-closed-days');

class CreateDeliveryClosedDays1700000000021 {
  name = 'CreateDeliveryClosedDays1700000000021';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable('delivery_closed_days'))) {
      await queryRunner.createTable(new Table({
        name: 'delivery_closed_days',
        columns: [
          {
            name: 'id',
            type: 'int',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment'
          },
          { name: 'market', type: 'varchar', length: '8', isNullable: false },
          { name: 'closed_on', type: 'date', isNullable: false },
          { name: 'label', type: 'varchar', length: '191', isNullable: false },
          { name: 'origin', type: 'varchar', length: '16', isNullable: false },
          { name: 'active', type: 'boolean', isNullable: false, default: true },
          { name: 'closes_preparation', type: 'boolean', isNullable: false, default: false },
          { name: 'closes_pickup', type: 'boolean', isNullable: false, default: false },
          { name: 'closes_delivery', type: 'boolean', isNullable: false, default: false },
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

      await queryRunner.createIndex('delivery_closed_days', new TableIndex({
        name: 'uniq_delivery_closed_days_market_date',
        columnNames: ['market', 'closed_on'],
        isUnique: true
      }));
    }

    for (const item of buildSeedRows()) {
      await queryRunner.query(
        `INSERT IGNORE INTO delivery_closed_days
          (market, closed_on, label, origin, active, closes_preparation, closes_pickup, closes_delivery)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          item.market,
          item.closedOn,
          item.label,
          item.origin,
          item.closesPreparation ? 1 : 0,
          item.closesPickup ? 1 : 0,
          item.closesDelivery ? 1 : 0
        ]
      );
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('delivery_closed_days')) {
      await queryRunner.dropTable('delivery_closed_days');
    }
  }
}

module.exports = {
  CreateDeliveryClosedDays1700000000021
};
