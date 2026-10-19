const { TableColumn } = require('typeorm');

const TABLE_NAME = 'onboarding_pets';

// age_recorded_at defaults to the insert time, so a new pet gets its registration date without a code change.
// Existing pets take created_at: updated_at moves on any edit of the row (photo, name, weight).
const COLUMNS = [
  { name: 'age_recorded_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
  { name: 'birth_date', type: 'date', isNullable: true },
  { name: 'life_stage_announced_at', type: 'datetime', isNullable: true },
  { name: 'life_stage_announced_stage', type: 'varchar', length: '16', isNullable: true }
];

class AddPetAgeReference1700000000036 {
  name = 'AddPetAgeReference1700000000036';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }
    const added = [];
    for (const column of COLUMNS) {
      if (!(await queryRunner.hasColumn(TABLE_NAME, column.name))) {
        await queryRunner.addColumn(TABLE_NAME, new TableColumn(column));
        added.push(column.name);
      }
    }
    if (added.includes('age_recorded_at')) {
      await queryRunner.query(`UPDATE ${TABLE_NAME} SET age_recorded_at = created_at`);
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }
    for (const column of [...COLUMNS].reverse()) {
      if (await queryRunner.hasColumn(TABLE_NAME, column.name)) {
        await queryRunner.dropColumn(TABLE_NAME, column.name);
      }
    }
  }
}

module.exports = {
  AddPetAgeReference1700000000036
};
