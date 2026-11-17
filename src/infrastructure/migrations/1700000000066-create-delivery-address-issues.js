const TABLE = 'delivery_address_issues';
const INDEXES = {
  idx_delivery_address_issues_subscription: '(subscription_id, opened_at)',
  idx_delivery_address_issues_user: '(user_id)'
};

async function hasTable(queryRunner) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [TABLE]
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

// One row per address problem of a subscription (delivery-address-issues). `open_key` holds the subscription id
// while the problem is open and NULL after: the unique index keeps one open problem per subscription, and MySQL
// accepts many NULLs, so closed problems stay as history.
class CreateDeliveryAddressIssues1700000000066 {
  name = 'CreateDeliveryAddressIssues1700000000066';

  async up(queryRunner) {
    if (!(await hasTable(queryRunner))) {
      await queryRunner.query(
        `CREATE TABLE ${TABLE} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          subscription_id INT UNSIGNED NOT NULL,
          stripe_subscription_id VARCHAR(64) NOT NULL,
          user_id BIGINT UNSIGNED NOT NULL,
          stripe_account VARCHAR(8) NOT NULL,
          issue_codes JSON NOT NULL,
          source VARCHAR(32) NOT NULL,
          open_key VARCHAR(32) NULL,
          opened_at DATETIME NOT NULL,
          email_sent_at DATETIME NULL,
          resolved_at DATETIME NULL,
          resolved_by VARCHAR(16) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_delivery_address_issues_open (open_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
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

module.exports = { CreateDeliveryAddressIssues1700000000066 };
