const TABLE = 'courier_deliveries';
const ACTIVE_COLUMN = 'active_invoice_key';
const ACTIVE_INDEX = 'uq_courier_deliveries_active_invoice';
const INDEXES = {
  idx_courier_deliveries_subscription: '(subscription_id)',
  idx_courier_deliveries_status_out: '(status, out_for_delivery_at)'
};

// getTable() is not used: the table has a generated column, and TypeORM then looks for typeorm_metadata.
async function hasColumn(queryRunner, column) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [TABLE, column]
  );
  return rows.length > 0;
}

async function hasIndex(queryRunner, index) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [TABLE, index]
  );
  return rows.length > 0;
}

async function hasTable(queryRunner) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [TABLE]
  );
  return rows.length > 0;
}

// One row per courier attempt for a paid Brazil cycle (courier-delivery). MySQL has no partial index:
// the stored generated key is the invoice while the row is out for delivery or delivered, else NULL,
// and UNIQUE ignores NULL, so failed and canceled attempts stay beside a new one.
class CreateCourierDeliveries1700000000063 {
  name = 'CreateCourierDeliveries1700000000063';

  async up(queryRunner) {
    if (!(await hasTable(queryRunner))) {
      await queryRunner.query(
        `CREATE TABLE ${TABLE} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          subscription_id VARCHAR(191) NOT NULL,
          user_id BIGINT UNSIGNED NULL,
          stripe_account VARCHAR(8) NULL,
          stripe_invoice_id VARCHAR(191) NOT NULL,
          method VARCHAR(16) NOT NULL,
          courier_name VARCHAR(120) NULL,
          tracking_url VARCHAR(500) NULL,
          cost_minor INT UNSIGNED NULL,
          currency VARCHAR(3) NOT NULL DEFAULT 'brl',
          note VARCHAR(500) NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'out_for_delivery',
          out_for_delivery_at DATETIME NOT NULL,
          delivered_at DATETIME NULL,
          failed_at DATETIME NULL,
          failure_reason VARCHAR(500) NULL,
          canceled_at DATETIME NULL,
          created_by BIGINT UNSIGNED NULL,
          updated_by BIGINT UNSIGNED NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      );
    }
    if (!(await hasColumn(queryRunner, ACTIVE_COLUMN))) {
      await queryRunner.query(
        `ALTER TABLE ${TABLE} ADD COLUMN ${ACTIVE_COLUMN} VARCHAR(191)
          GENERATED ALWAYS AS (CASE WHEN status IN ('out_for_delivery', 'delivered') THEN stripe_invoice_id ELSE NULL END) STORED`
      );
    }
    if (!(await hasIndex(queryRunner, ACTIVE_INDEX))) {
      await queryRunner.query(`CREATE UNIQUE INDEX ${ACTIVE_INDEX} ON ${TABLE} (${ACTIVE_COLUMN})`);
    }
    for (const [index, columns] of Object.entries(INDEXES)) {
      if (!(await hasIndex(queryRunner, index))) {
        await queryRunner.query(`CREATE INDEX ${index} ON ${TABLE} ${columns}`);
      }
    }
  }

  async down(queryRunner) {
    if (await hasTable(queryRunner)) {
      await queryRunner.query(`DROP TABLE ${TABLE}`);
    }
  }
}

module.exports = { CreateCourierDeliveries1700000000063 };
