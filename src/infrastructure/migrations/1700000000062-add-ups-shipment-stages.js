const TABLE = 'ups_shipments';
const COLUMNS = {
  in_transit_at: 'DATETIME NULL',
  out_for_delivery_at: 'DATETIME NULL',
  shipped_letter_sent_at: 'DATETIME NULL'
};

// getTable() is not used: this table has a generated column, and TypeORM then looks for typeorm_metadata.
async function hasColumn(queryRunner, column) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [TABLE, column]
  );
  return rows.length > 0;
}

// First UPS scan of each carrier stage (delivery-tracking), and when the shipped letter went out.
// Labels bought before this migration had their letter at purchase, so they count as sent.
class AddUpsShipmentStages1700000000062 {
  name = 'AddUpsShipmentStages1700000000062';

  async up(queryRunner) {
    for (const [column, definition] of Object.entries(COLUMNS)) {
      if (await hasColumn(queryRunner, column)) {
        continue;
      }
      await queryRunner.query(`ALTER TABLE ${TABLE} ADD COLUMN ${column} ${definition}`);
      if (column === 'shipped_letter_sent_at') {
        await queryRunner.query(
          `UPDATE ${TABLE} SET shipped_letter_sent_at = shipped_at WHERE status IN ('created', 'delivered') AND shipped_at IS NOT NULL`
        );
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

module.exports = { AddUpsShipmentStages1700000000062 };
