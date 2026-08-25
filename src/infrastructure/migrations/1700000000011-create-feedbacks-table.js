const { Table, TableIndex } = require('typeorm');

class CreateFeedbacksTable1700000000011 {
  name = 'CreateFeedbacksTable1700000000011';

  async up(queryRunner) {
    if (await queryRunner.hasTable('feedbacks')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'feedbacks',
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
          name: 'name',
          type: 'varchar',
          length: '191',
          isNullable: false
        },
        {
          name: 'category',
          type: 'varchar',
          length: '32',
          isNullable: false
        },
        {
          name: 'country',
          type: 'varchar',
          length: '2',
          isNullable: false
        },
        {
          name: 'photo',
          type: 'varchar',
          length: '512',
          isNullable: false,
          default: "''"
        },
        {
          name: 'comment',
          type: 'text',
          isNullable: false
        },
        {
          name: 'active',
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
    }), true);

    await queryRunner.createIndex('feedbacks', new TableIndex({
      name: 'idx_feedbacks_country',
      columnNames: ['country']
    }));
    await queryRunner.createIndex('feedbacks', new TableIndex({
      name: 'idx_feedbacks_country_active',
      columnNames: ['country', 'active']
    }));
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable('feedbacks'))) {
      return;
    }

    await queryRunner.dropIndex('feedbacks', 'idx_feedbacks_country_active');
    await queryRunner.dropIndex('feedbacks', 'idx_feedbacks_country');
    await queryRunner.dropTable('feedbacks');
  }
}

module.exports = {
  CreateFeedbacksTable1700000000011
};
