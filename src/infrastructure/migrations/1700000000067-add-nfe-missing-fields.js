const TABLE = 'bling_nfe';
const COLUMN = 'missing_fields';

async function hasColumn(queryRunner) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [TABLE, COLUMN]
  );
  return rows.length > 0;
}

// What a blocked note still needs from the customer (nfe-admin): ["tax_document"], ["fiscal_name"] or both.
// NULL on notes written before this column, until the job or a retry reads the customer again.
class AddNfeMissingFields1700000000067 {
  name = 'AddNfeMissingFields1700000000067';

  async up(queryRunner) {
    if (!(await hasColumn(queryRunner))) {
      await queryRunner.query(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} JSON NULL AFTER customer_address`);
    }
  }

  async down(queryRunner) {
    if (await hasColumn(queryRunner)) {
      await queryRunner.query(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
    }
  }
}

module.exports = { AddNfeMissingFields1700000000067 };
