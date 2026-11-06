const PICKUPS = 'ups_pickups';
const SHIPMENTS = 'ups_shipments';
const US_SETTINGS = 'shipping_us_settings';
const PICKUP_INDEX = 'idx_ups_shipments_pickup';

async function hasIndex(queryRunner, table, index) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [table, index]
  );
  return rows.length > 0;
}

// One row per UPS on-demand pickup (ups-pickup). `ups_shipments.pickup_id` points to the active pickup of a
// label and goes back to NULL when the pickup is canceled or closed; `shipment_ids` keeps the list sent.
class CreateUpsPickups1700000000068 {
  name = 'CreateUpsPickups1700000000068';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(PICKUPS))) {
      await queryRunner.query(
        `CREATE TABLE ${PICKUPS} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          pickup_date DATE NOT NULL,
          ready_time CHAR(5) NOT NULL,
          close_time CHAR(5) NOT NULL,
          package_count INT UNSIGNED NOT NULL,
          status VARCHAR(16) NOT NULL,
          prn VARCHAR(32) NULL,
          shipment_ids JSON NOT NULL,
          requested_by VARCHAR(191) NULL,
          closed_by VARCHAR(191) NULL,
          closed_at DATETIME NULL,
          last_error VARCHAR(500) NULL,
          raw_response JSON NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_ups_pickups_date (pickup_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
    }
    if (await queryRunner.hasTable(SHIPMENTS)) {
      if (!(await queryRunner.hasColumn(SHIPMENTS, 'pickup_id'))) {
        await queryRunner.query(`ALTER TABLE \`${SHIPMENTS}\` ADD COLUMN \`pickup_id\` BIGINT UNSIGNED NULL`);
      }
      if (!(await hasIndex(queryRunner, SHIPMENTS, PICKUP_INDEX))) {
        await queryRunner.query(`CREATE INDEX ${PICKUP_INDEX} ON \`${SHIPMENTS}\` (\`pickup_id\`)`);
      }
    }
    if (await queryRunner.hasTable(US_SETTINGS) && !(await queryRunner.hasColumn(US_SETTINGS, 'ship_from_phone'))) {
      await queryRunner.query(`ALTER TABLE \`${US_SETTINGS}\` ADD COLUMN \`ship_from_phone\` VARCHAR(32) NOT NULL DEFAULT ''`);
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(US_SETTINGS) && await queryRunner.hasColumn(US_SETTINGS, 'ship_from_phone')) {
      await queryRunner.query(`ALTER TABLE \`${US_SETTINGS}\` DROP COLUMN \`ship_from_phone\``);
    }
    if (await queryRunner.hasTable(SHIPMENTS) && await queryRunner.hasColumn(SHIPMENTS, 'pickup_id')) {
      if (await hasIndex(queryRunner, SHIPMENTS, PICKUP_INDEX)) {
        await queryRunner.query(`DROP INDEX ${PICKUP_INDEX} ON \`${SHIPMENTS}\``);
      }
      await queryRunner.query(`ALTER TABLE \`${SHIPMENTS}\` DROP COLUMN \`pickup_id\``);
    }
    if (await queryRunner.hasTable(PICKUPS)) {
      await queryRunner.query(`DROP TABLE ${PICKUPS}`);
    }
  }
}

module.exports = { CreateUpsPickups1700000000068 };
