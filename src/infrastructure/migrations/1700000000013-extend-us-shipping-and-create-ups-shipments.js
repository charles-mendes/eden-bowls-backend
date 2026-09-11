const { Table } = require('typeorm');

class ExtendUsShippingAndCreateUpsShipments1700000000013 {
  name = 'ExtendUsShippingAndCreateUpsShipments1700000000013';

  async up(queryRunner) {
    const usTable = 'shipping_us_settings';
    if (await queryRunner.hasTable(usTable)) {
      const columns = [
        ['quote_mode', "VARCHAR(16) NOT NULL DEFAULT 'fixed'"],
        ['fallback_enabled', 'TINYINT(1) NOT NULL DEFAULT 1'],
        ['ship_from_name', "VARCHAR(191) NOT NULL DEFAULT ''"],
        ['ship_from_street', "VARCHAR(191) NOT NULL DEFAULT ''"],
        ['ship_from_city', "VARCHAR(128) NOT NULL DEFAULT ''"],
        ['ship_from_state', "VARCHAR(8) NOT NULL DEFAULT ''"],
        ['ship_from_zipcode', "VARCHAR(16) NOT NULL DEFAULT ''"],
        ['ship_from_country', "VARCHAR(2) NOT NULL DEFAULT 'US'"],
        ['package_weight_lb', 'DECIMAL(10,2) NOT NULL DEFAULT 10'],
        ['package_length_in', 'DECIMAL(10,2) NOT NULL DEFAULT 12'],
        ['package_width_in', 'DECIMAL(10,2) NOT NULL DEFAULT 12'],
        ['package_height_in', 'DECIMAL(10,2) NOT NULL DEFAULT 12'],
        ['allowed_service_codes', "TEXT NULL"]
      ];

      for (const [name, definition] of columns) {
        const hasColumn = await queryRunner.hasColumn(usTable, name);
        if (!hasColumn) {
          await queryRunner.query(`ALTER TABLE \`${usTable}\` ADD COLUMN \`${name}\` ${definition}`);
        }
      }

      await queryRunner.query(
        `UPDATE \`${usTable}\` SET \`allowed_service_codes\` = ? WHERE \`id\` = 1 AND (\`allowed_service_codes\` IS NULL OR \`allowed_service_codes\` = '')`,
        [JSON.stringify(['03'])]
      );
    }

    if (!(await queryRunner.hasTable('ups_shipments'))) {
      await queryRunner.createTable(new Table({
        name: 'ups_shipments',
        columns: [
          { name: 'id', type: 'bigint', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'subscription_id', type: 'varchar', length: '191', isNullable: false },
          { name: 'stripe_invoice_id', type: 'varchar', length: '191', isNullable: false },
          { name: 'user_id', type: 'bigint', unsigned: true, isNullable: true },
          { name: 'ups_shipment_id', type: 'varchar', length: '191', isNullable: true },
          { name: 'tracking_number', type: 'varchar', length: '191', isNullable: true },
          { name: 'service_code', type: 'varchar', length: '16', isNullable: true },
          { name: 'label_format', type: 'varchar', length: '16', isNullable: true },
          { name: 'label_path', type: 'varchar', length: '512', isNullable: true },
          { name: 'quoted_shipping_cost', type: 'decimal', precision: 10, scale: 2, isNullable: true },
          { name: 'ups_monetary_value', type: 'decimal', precision: 10, scale: 2, isNullable: true },
          { name: 'status', type: 'varchar', length: '32', isNullable: false, default: "'pending'" },
          { name: 'shipped_at', type: 'datetime', isNullable: true },
          { name: 'raw_response', type: 'longtext', isNullable: true },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ],
        indices: [
          { name: 'idx_ups_shipments_subscription', columnNames: ['subscription_id'] },
          { name: 'idx_ups_shipments_invoice', columnNames: ['stripe_invoice_id'] },
          { name: 'uq_ups_shipments_ups_id', columnNames: ['ups_shipment_id'], isUnique: true }
        ]
      }), true);
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('ups_shipments')) {
      await queryRunner.dropTable('ups_shipments');
    }

    const usTable = 'shipping_us_settings';
    if (await queryRunner.hasTable(usTable)) {
      const dropColumns = [
        'allowed_service_codes',
        'package_height_in',
        'package_width_in',
        'package_length_in',
        'package_weight_lb',
        'ship_from_country',
        'ship_from_zipcode',
        'ship_from_state',
        'ship_from_city',
        'ship_from_street',
        'ship_from_name',
        'fallback_enabled',
        'quote_mode'
      ];
      for (const name of dropColumns) {
        if (await queryRunner.hasColumn(usTable, name)) {
          await queryRunner.query(`ALTER TABLE \`${usTable}\` DROP COLUMN \`${name}\``);
        }
      }
    }
  }
}

module.exports = {
  ExtendUsShippingAndCreateUpsShipments1700000000013
};
