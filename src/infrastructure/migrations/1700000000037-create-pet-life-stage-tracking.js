const { Table, TableForeignKey, TableIndex } = require('typeorm');

const AGE_CHANGES_TABLE = 'pet_age_changes';
const NOTICES_TABLE = 'pet_life_stage_notices';
const ANNOUNCEMENTS_TABLE = 'life_stage_announcements';

const idColumn = {
  name: 'id',
  type: 'int',
  unsigned: true,
  isPrimary: true,
  isGenerated: true,
  generationStrategy: 'increment'
};

const timestamps = [
  { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
  { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
];

class CreatePetLifeStageTracking1700000000037 {
  name = 'CreatePetLifeStageTracking1700000000037';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(AGE_CHANGES_TABLE))) {
      // History outlives the pet row, so there is no foreign key to onboarding_pets.
      await queryRunner.createTable(new Table({
        name: AGE_CHANGES_TABLE,
        columns: [
          idColumn,
          { name: 'pet_id', type: 'varchar', length: '36', isNullable: false },
          { name: 'user_id', type: 'bigint', unsigned: true, isNullable: false },
          { name: 'old_age_years', type: 'int', unsigned: true, isNullable: true },
          { name: 'old_age_months', type: 'int', unsigned: true, isNullable: true },
          { name: 'old_birth_date', type: 'date', isNullable: true },
          { name: 'new_age_years', type: 'int', unsigned: true, isNullable: true },
          { name: 'new_age_months', type: 'int', unsigned: true, isNullable: true },
          { name: 'new_birth_date', type: 'date', isNullable: true },
          { name: 'old_life_stage', type: 'varchar', length: '16', isNullable: true },
          { name: 'new_life_stage', type: 'varchar', length: '16', isNullable: true },
          { name: 'source', type: 'varchar', length: '16', isNullable: false },
          { name: 'changed_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' }
        ]
      }), true);
      await queryRunner.createIndex(AGE_CHANGES_TABLE, new TableIndex({
        name: 'idx_pet_age_changes_pet_changed',
        columnNames: ['pet_id', 'changed_at']
      }));
    }

    if (!(await queryRunner.hasTable(NOTICES_TABLE))) {
      await queryRunner.createTable(new Table({
        name: NOTICES_TABLE,
        columns: [
          idColumn,
          { name: 'subscription_id', type: 'int', unsigned: true, isNullable: false },
          { name: 'pet_id', type: 'varchar', length: '36', isNullable: false },
          { name: 'from_line', type: 'varchar', length: '16', isNullable: false },
          { name: 'to_line', type: 'varchar', length: '16', isNullable: false },
          { name: 'detected_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'dismissed_at', type: 'datetime', isNullable: true },
          { name: 'resolved_at', type: 'datetime', isNullable: true },
          { name: 'notified_at', type: 'datetime', isNullable: true },
          { name: 'notified_via', type: 'varchar', length: '24', isNullable: true },
          ...timestamps
        ]
      }), true);
      await queryRunner.createIndex(NOTICES_TABLE, new TableIndex({
        name: 'uniq_pet_life_stage_notices_transition',
        columnNames: ['subscription_id', 'pet_id', 'from_line', 'to_line'],
        isUnique: true
      }));
      // The email job checks every row of the same pet and transition, across subscriptions.
      await queryRunner.createIndex(NOTICES_TABLE, new TableIndex({
        name: 'idx_pet_life_stage_notices_pet_transition',
        columnNames: ['pet_id', 'from_line', 'to_line']
      }));
      if (await queryRunner.hasTable('stripe_subscriptions')) {
        await queryRunner.createForeignKey(NOTICES_TABLE, new TableForeignKey({
          name: 'fk_pet_life_stage_notices_subscription_id',
          columnNames: ['subscription_id'],
          referencedTableName: 'stripe_subscriptions',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE'
        }));
      }
    }

    if (!(await queryRunner.hasTable(ANNOUNCEMENTS_TABLE))) {
      // One row per market; sent_at turns on the stage-change email job there.
      await queryRunner.createTable(new Table({
        name: ANNOUNCEMENTS_TABLE,
        columns: [
          { name: 'market', type: 'varchar', length: '8', isPrimary: true },
          { name: 'started_at', type: 'datetime', isNullable: true },
          { name: 'sent_at', type: 'datetime', isNullable: true },
          ...timestamps
        ]
      }), true);
    }
  }

  async down(queryRunner) {
    for (const table of [ANNOUNCEMENTS_TABLE, NOTICES_TABLE, AGE_CHANGES_TABLE]) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropTable(table);
      }
    }
  }
}

module.exports = {
  CreatePetLifeStageTracking1700000000037
};
