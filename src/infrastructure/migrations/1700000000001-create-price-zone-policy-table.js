const { Table, TableIndex } = require('typeorm');

class CreatePriceZonePolicyTable1700000000001 {
  name = 'CreatePriceZonePolicyTable1700000000001';

  async up(queryRunner) {
    const table = new Table({
      name: 'price_zone_policy',
      columns: [
        {
          name: 'id',
          type: 'bigint',
          unsigned: true,
          isPrimary: true,
          isGenerated: true,
          generationStrategy: 'increment'
        },
        {
          name: 'country_code',
          type: 'varchar',
          length: '2',
          isNullable: false
        },
        {
          name: 'currency_code',
          type: 'varchar',
          length: '3',
          isNullable: false
        },
        {
          name: 'zone_id',
          type: 'varchar',
          length: '64',
          isNullable: false
        },
        {
          name: 'is_active',
          type: 'tinyint',
          width: 1,
          isNullable: false,
          default: 1
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
    });

    await queryRunner.createTable(table, true);
    await queryRunner.createIndex(table, new TableIndex({
      name: 'uk_price_zone_country_currency',
      columnNames: ['country_code', 'currency_code'],
      isUnique: true
    }));
    await queryRunner.createIndex(table, new TableIndex({
      name: 'idx_price_zone_active',
      columnNames: ['is_active']
    }));

    await queryRunner.query(
      "INSERT INTO `price_zone_policy` (`country_code`, `currency_code`, `zone_id`, `is_active`) VALUES ('BR', 'BRL', 'br', 1), ('US', 'USD', 'us', 1)"
    );
  }

  async down(queryRunner) {
    await queryRunner.dropIndex('price_zone_policy', 'idx_price_zone_active');
    await queryRunner.dropIndex('price_zone_policy', 'uk_price_zone_country_currency');
    await queryRunner.dropTable('price_zone_policy');
  }
}

module.exports = {
  CreatePriceZonePolicyTable1700000000001
};
