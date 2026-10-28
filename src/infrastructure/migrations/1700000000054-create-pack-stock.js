const { Table, TableIndex } = require('typeorm');

const ITEMS = 'pack_stock_items';
const MOVEMENTS = 'pack_stock_movements';

// Ready-pack stock per market, recipe and pack size (pack-stock, design decision 2). `on_hand` is the sum of the
// item's movements, kept in the same transaction as each movement, and may be negative. Both tables start empty.
class CreatePackStock1700000000054 {
  name = 'CreatePackStock1700000000054';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(ITEMS))) {
      await queryRunner.createTable(new Table({
        name: ITEMS,
        columns: [
          { name: 'id', type: 'bigint', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'market', type: 'varchar', length: '8', isNullable: false },
          { name: 'flavor_key', type: 'varchar', length: '64', isNullable: false },
          { name: 'pack_size_grams', type: 'int', unsigned: true, isNullable: false },
          { name: 'on_hand', type: 'int', isNullable: false, default: 0 },
          { name: 'min_level', type: 'int', unsigned: true, isNullable: true },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ],
        uniques: [
          { name: 'uniq_pack_stock_item', columnNames: ['market', 'flavor_key', 'pack_size_grams'] }
        ]
      }), true);
    }

    if (!(await queryRunner.hasTable(MOVEMENTS))) {
      await queryRunner.createTable(new Table({
        name: MOVEMENTS,
        columns: [
          { name: 'id', type: 'bigint', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'item_id', type: 'bigint', unsigned: true, isNullable: false },
          { name: 'type', type: 'varchar', length: '32', isNullable: false },
          { name: 'quantity', type: 'int', isNullable: false },
          { name: 'reason', type: 'varchar', length: '16', isNullable: true },
          { name: 'note', type: 'varchar', length: '255', isNullable: true },
          { name: 'production_cycle_id', type: 'int', unsigned: true, isNullable: true },
          { name: 'subscription_id', type: 'int', unsigned: true, isNullable: true },
          { name: 'actor_user_id', type: 'bigint', unsigned: true, isNullable: true },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' }
        ]
      }), true);
      await queryRunner.createIndex(MOVEMENTS, new TableIndex({
        name: 'idx_pack_stock_movements_item_created',
        columnNames: ['item_id', 'created_at']
      }));
      await queryRunner.createIndex(MOVEMENTS, new TableIndex({
        name: 'idx_pack_stock_movements_cycle',
        columnNames: ['production_cycle_id']
      }));
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(MOVEMENTS)) {
      await queryRunner.dropTable(MOVEMENTS);
    }
    if (await queryRunner.hasTable(ITEMS)) {
      await queryRunner.dropTable(ITEMS);
    }
  }
}

module.exports = {
  CreatePackStock1700000000054
};
