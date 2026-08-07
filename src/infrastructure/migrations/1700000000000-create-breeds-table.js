const { Table, TableColumn, TableIndex } = require('typeorm');

class CreateBreedsTable1700000000000 {
  name = 'CreateBreedsTable1700000000000';

  async up(queryRunner) {
    const table = new Table({
      name: 'wp_hsr_breeds',
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
          name: 'name_pt',
          type: 'varchar',
          length: '191',
          isNullable: false
        },
        {
          name: 'name_en',
          type: 'varchar',
          length: '191',
          isNullable: false
        },
        {
          name: 'size',
          type: 'varchar',
          length: '50',
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
    });

    await queryRunner.createTable(table, true);
    await queryRunner.createIndex(table, new TableIndex({ name: 'idx_name_pt', columnNames: ['name_pt'] }));
    await queryRunner.createIndex(table, new TableIndex({ name: 'idx_name_en', columnNames: ['name_en'] }));
  }

  async down(queryRunner) {
    await queryRunner.dropIndex('wp_hsr_breeds', 'idx_name_en');
    await queryRunner.dropIndex('wp_hsr_breeds', 'idx_name_pt');
    await queryRunner.dropTable('wp_hsr_breeds');
  }
}

module.exports = {
  CreateBreedsTable1700000000000
};