const { Table } = require('typeorm');

class CreateShippingSettingsTables1700000000010 {
  name = 'CreateShippingSettingsTables1700000000010';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable('shipping_br_settings'))) {
      await queryRunner.createTable(new Table({
        name: 'shipping_br_settings',
        columns: [
          { name: 'id', type: 'tinyint', unsigned: true, isPrimary: true },
          { name: 'enabled', type: 'tinyint', width: 1, isNullable: false, default: 1 },
          { name: 'label', type: 'varchar', length: '191', isNullable: false },
          { name: 'center_name', type: 'varchar', length: '191', isNullable: false },
          { name: 'center_street', type: 'varchar', length: '191', isNullable: false, default: "''" },
          { name: 'center_city', type: 'varchar', length: '128', isNullable: false, default: "''" },
          { name: 'center_state', type: 'varchar', length: '8', isNullable: false, default: "''" },
          { name: 'center_zipcode', type: 'varchar', length: '16', isNullable: false, default: "''" },
          { name: 'center_lat', type: 'decimal', precision: 10, scale: 6, isNullable: false },
          { name: 'center_lng', type: 'decimal', precision: 10, scale: 6, isNullable: false },
          { name: 'center_version', type: 'varchar', length: '32', isNullable: false, default: "'1'" },
          { name: 'per_km', type: 'decimal', precision: 10, scale: 4, isNullable: false },
          { name: 'road_factor', type: 'decimal', precision: 8, scale: 4, isNullable: false },
          { name: 'min_fee', type: 'decimal', precision: 10, scale: 2, isNullable: false, default: 0 },
          { name: 'max_fee', type: 'decimal', precision: 10, scale: 2, isNullable: true },
          { name: 'max_distance_km', type: 'decimal', precision: 10, scale: 2, isNullable: false },
          { name: 'km_per_day', type: 'decimal', precision: 10, scale: 2, isNullable: false },
          { name: 'min_days', type: 'int', isNullable: false, default: 2 },
          { name: 'max_days', type: 'int', isNullable: false, default: 10 },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ]
      }), true);

      await queryRunner.query(
        [
          'INSERT INTO `shipping_br_settings` (',
          '`id`, `enabled`, `label`, `center_name`, `center_lat`, `center_lng`, `center_version`,',
          '`per_km`, `road_factor`, `min_fee`, `max_fee`, `max_distance_km`, `km_per_day`, `min_days`, `max_days`',
          ') VALUES (1, 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)'
        ].join(' '),
        [
          'Entrega Eden Bowl',
          'CD',
          -25.44839,
          -49.21741,
          '1',
          0.95,
          1.3,
          0,
          500,
          80,
          2,
          10
        ]
      );
    }

    if (!(await queryRunner.hasTable('shipping_us_settings'))) {
      await queryRunner.createTable(new Table({
        name: 'shipping_us_settings',
        columns: [
          { name: 'id', type: 'tinyint', unsigned: true, isPrimary: true },
          { name: 'enabled', type: 'tinyint', width: 1, isNullable: false, default: 1 },
          { name: 'cost', type: 'decimal', precision: 10, scale: 2, isNullable: false },
          { name: 'label', type: 'varchar', length: '191', isNullable: false },
          { name: 'carrier', type: 'varchar', length: '128', isNullable: false },
          { name: 'delivery', type: 'varchar', length: '191', isNullable: false },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ]
      }), true);

      await queryRunner.query(
        'INSERT INTO `shipping_us_settings` (`id`, `enabled`, `cost`, `label`, `carrier`, `delivery`) VALUES (1, 1, ?, ?, ?, ?)',
        [12.9, 'FedEx 3–5 business days', 'FedEx', '3–5 business days']
      );
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('shipping_us_settings')) {
      await queryRunner.dropTable('shipping_us_settings');
    }

    if (await queryRunner.hasTable('shipping_br_settings')) {
      await queryRunner.dropTable('shipping_br_settings');
    }
  }
}

module.exports = {
  CreateShippingSettingsTables1700000000010
};
