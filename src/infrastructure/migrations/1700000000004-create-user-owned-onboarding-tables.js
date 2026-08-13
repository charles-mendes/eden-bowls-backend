const { Table, TableForeignKey, TableIndex } = require('typeorm');

class CreateUserOwnedOnboardingTables1700000000004 {
  name = 'CreateUserOwnedOnboardingTables1700000000004';

  async up(queryRunner) {
    await this.createPetsTable(queryRunner);
    await this.createUserStateTable(queryRunner);
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('onboarding_user_state')) {
      await queryRunner.dropTable('onboarding_user_state');
    }

    if (await queryRunner.hasTable('onboarding_pets')) {
      await queryRunner.dropTable('onboarding_pets');
    }
  }

  async createPetsTable(queryRunner) {
    if (await queryRunner.hasTable('onboarding_pets')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'onboarding_pets',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'user_id', type: 'bigint', unsigned: true, isNullable: false },
        { name: 'local_id', type: 'varchar', length: '36', isNullable: true },
        { name: 'name', type: 'varchar', length: '120', isNullable: false },
        { name: 'breed', type: 'varchar', length: '120', isNullable: false, default: "''" },
        { name: 'age_years', type: 'int', unsigned: true, isNullable: false, default: 0 },
        { name: 'age_months', type: 'int', unsigned: true, isNullable: false, default: 0 },
        { name: 'weight_input', type: 'decimal', precision: 10, scale: 2, isNullable: false, default: 0 },
        { name: 'weight_unit', type: 'varchar', length: '2', isNullable: false },
        { name: 'size', type: 'varchar', length: '16', isNullable: false, default: "''" },
        { name: 'activity_level', type: 'varchar', length: '16', isNullable: false, default: "''" },
        { name: 'pet_condition', type: 'varchar', length: '16', isNullable: false, default: "''" },
        { name: 'neutered', type: 'tinyint', width: 1, isNullable: false, default: 0 },
        { name: 'image_url', type: 'varchar', length: '2048', isNullable: true },
        { name: 'deleted_at', type: 'datetime', isNullable: true },
        { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
      ]
    }), true);

    await queryRunner.createForeignKey('onboarding_pets', new TableForeignKey({
      name: 'fk_onboarding_pets_user_id',
      columnNames: ['user_id'],
      referencedTableName: 'wp_users',
      referencedColumnNames: ['ID'],
      onDelete: 'CASCADE'
    }));

    await queryRunner.createIndex('onboarding_pets', new TableIndex({
      name: 'idx_onboarding_pets_user_deleted',
      columnNames: ['user_id', 'deleted_at']
    }));

    await queryRunner.createIndex('onboarding_pets', new TableIndex({
      name: 'uk_onboarding_pets_user_local_id',
      columnNames: ['user_id', 'local_id'],
      isUnique: true
    }));
  }

  async createUserStateTable(queryRunner) {
    if (await queryRunner.hasTable('onboarding_user_state')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'onboarding_user_state',
      columns: [
        { name: 'user_id', type: 'bigint', unsigned: true, isPrimary: true },
        { name: 'recurrence', type: 'json', isNullable: true },
        { name: 'plan_selection', type: 'json', isNullable: true },
        { name: 'address', type: 'json', isNullable: true },
        { name: 'shipping', type: 'json', isNullable: true },
        { name: 'payment_reference', type: 'json', isNullable: true },
        { name: 'checkout_reference', type: 'json', isNullable: true },
        { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
      ]
    }), true);

    await queryRunner.createForeignKey('onboarding_user_state', new TableForeignKey({
      name: 'fk_onboarding_user_state_user_id',
      columnNames: ['user_id'],
      referencedTableName: 'wp_users',
      referencedColumnNames: ['ID'],
      onDelete: 'CASCADE'
    }));
  }
}

module.exports = {
  CreateUserOwnedOnboardingTables1700000000004
};