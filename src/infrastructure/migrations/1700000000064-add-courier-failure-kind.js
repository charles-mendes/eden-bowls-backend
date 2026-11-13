const TABLE = 'courier_deliveries';
const COLUMN = 'failure_kind';

async function hasColumn(queryRunner) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [TABLE, COLUMN]
  );
  return rows.length > 0;
}

// What kind of failure a courier attempt was (address_unusable, customer_absent, other), beside the free text.
// NULL for failures recorded before this column and for attempts that did not fail.
class AddCourierFailureKind1700000000064 {
  name = 'AddCourierFailureKind1700000000064';

  async up(queryRunner) {
    if (!(await hasColumn(queryRunner))) {
      await queryRunner.query(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} VARCHAR(32) NULL AFTER failure_reason`);
    }
  }

  async down(queryRunner) {
    if (await hasColumn(queryRunner)) {
      await queryRunner.query(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
    }
  }
}

module.exports = { AddCourierFailureKind1700000000064 };
