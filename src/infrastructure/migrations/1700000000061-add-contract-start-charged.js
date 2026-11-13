const TABLE = 'stripe_subscriptions';
const COLUMN = 'contract_start_charged';

async function hasColumn(queryRunner) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [TABLE, COLUMN]
  );
  return rows.length > 0;
}

// Lifetime charged deliveries when the current contract started (subscription-contract). 0 keeps every count.
class AddContractStartCharged1700000000061 {
  name = 'AddContractStartCharged1700000000061';

  async up(queryRunner) {
    if (!(await hasColumn(queryRunner))) {
      await queryRunner.query(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} INT UNSIGNED NOT NULL DEFAULT 0`);
    }
  }

  async down(queryRunner) {
    if (await hasColumn(queryRunner)) {
      await queryRunner.query(`ALTER TABLE ${TABLE} DROP COLUMN ${COLUMN}`);
    }
  }
}

module.exports = { AddContractStartCharged1700000000061 };
