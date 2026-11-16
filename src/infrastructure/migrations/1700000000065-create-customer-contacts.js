const TABLE = 'customer_contacts';
const INDEXES = {
  idx_customer_contacts_subscription: '(subscription_id, created_at)',
  idx_customer_contacts_user: '(user_id)'
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

// One row per contact an operator made with a customer outside the system (customer-contacts). The channel is
// always WhatsApp, so it is not stored. Rows are never edited; they go with the customer's account.
class CreateCustomerContacts1700000000065 {
  name = 'CreateCustomerContacts1700000000065';

  async up(queryRunner) {
    if (!(await hasTable(queryRunner))) {
      await queryRunner.query(
        `CREATE TABLE ${TABLE} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          subscription_id VARCHAR(191) NOT NULL,
          user_id BIGINT UNSIGNED NULL,
          stripe_account VARCHAR(8) NULL,
          reason VARCHAR(32) NOT NULL,
          outcome VARCHAR(32) NOT NULL,
          note VARCHAR(500) NULL,
          actor_id BIGINT UNSIGNED NULL,
          actor_email VARCHAR(255) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

module.exports = { CreateCustomerContacts1700000000065 };
