const { Table, TableIndex } = require('typeorm');

class CreateOnboardingQuotesTable1700000000006 {
  name = 'CreateOnboardingQuotesTable1700000000006';

  async up(queryRunner) {
    if (await queryRunner.hasTable('onboarding_quotes')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'onboarding_quotes',
      columns: [
        { name: 'id', type: 'varchar', length: '64', isPrimary: true },
        { name: 'user_id', type: 'bigint', unsigned: true, isNullable: true },
        { name: 'payload_hash', type: 'char', length: '64', isNullable: false },
        { name: 'payload', type: 'json', isNullable: false },
        { name: 'pricing', type: 'json', isNullable: false },
        { name: 'status', type: 'varchar', length: '16', isNullable: false, default: "'active'" },
        { name: 'expires_at', type: 'datetime', isNullable: false },
        { name: 'consumed_at', type: 'datetime', isNullable: true },
        { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
      ]
    }), true);

    await queryRunner.createIndex('onboarding_quotes', new TableIndex({
      name: 'idx_onboarding_quotes_hash_status',
      columnNames: ['payload_hash', 'status']
    }));

    await queryRunner.createIndex('onboarding_quotes', new TableIndex({
      name: 'idx_onboarding_quotes_expires_status',
      columnNames: ['expires_at', 'status']
    }));
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('onboarding_quotes')) {
      await queryRunner.dropTable('onboarding_quotes');
    }
  }
}

module.exports = {
  CreateOnboardingQuotesTable1700000000006
};