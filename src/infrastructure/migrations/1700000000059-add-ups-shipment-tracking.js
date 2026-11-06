const TABLE = 'ups_shipments';
const COLUMNS = {
  tracking_status: 'VARCHAR(32) NULL',
  tracking_description: 'VARCHAR(255) NULL',
  tracking_response: 'LONGTEXT NULL',
  tracking_checked_at: 'DATETIME NULL',
  delivered_at: 'DATETIME NULL'
};

// getTable() is not used: this table has a generated column, and TypeORM then looks for typeorm_metadata.
async function hasColumn(queryRunner, column) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [TABLE, column]
  );
  return rows.length > 0;
}

// The last tracking answer gets its own columns, so `raw_response` keeps the purchase answer. That answer is
// the only copy of a label whose file could not be stored.
class AddUpsShipmentTracking1700000000059 {
  name = 'AddUpsShipmentTracking1700000000059';

  async up(queryRunner) {
    for (const [column, definition] of Object.entries(COLUMNS)) {
      if (!(await hasColumn(queryRunner, column))) {
        await queryRunner.query(`ALTER TABLE ${TABLE} ADD COLUMN ${column} ${definition}`);
      }
    }
  }

  async down(queryRunner) {
    for (const column of Object.keys(COLUMNS)) {
      if (await hasColumn(queryRunner, column)) {
        await queryRunner.query(`ALTER TABLE ${TABLE} DROP COLUMN ${column}`);
      }
    }
  }
}

module.exports = { AddUpsShipmentTracking1700000000059 };
