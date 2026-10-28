const { TableColumn } = require('typeorm');

const LEDGER = 'stripe_subscriptions';
const INVOICES = 'customer_invoices';
const CHARGED = 'subscription_charged_invoices';

// activated_at is the first time a subscription was billable; canceled_at is when it really ended
// (Stripe ended_at, not the cancellation request). Reports count new, canceled and churn by them.
const COLUMNS = [
  new TableColumn({ name: 'activated_at', type: 'datetime', isNullable: true }),
  new TableColumn({ name: 'activated_at_approximate', type: 'tinyint', width: 1, isNullable: false, default: 0 }),
  new TableColumn({ name: 'canceled_at', type: 'datetime', isNullable: true }),
  new TableColumn({ name: 'canceled_at_approximate', type: 'tinyint', width: 1, isNullable: false, default: 0 })
];

const INDEXES = [
  { table: INVOICES, name: 'idx_customer_invoices_account_issued', columns: ['stripe_account', 'issued_at'] },
  { table: LEDGER, name: 'idx_stripe_subscriptions_account_activated', columns: ['stripe_account', 'activated_at'] },
  { table: LEDGER, name: 'idx_stripe_subscriptions_account_canceled', columns: ['stripe_account', 'canceled_at'] }
];

async function hasIndex(queryRunner, table, name) {
  const rows = await queryRunner.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
    [table, name]
  );
  return rows.length > 0;
}

// Rows from before this migration only have created_at and updated_at, so their dates are marked approximate.
// A canceled row counts as activated only when it has a paid or charged invoice; otherwise it was a checkout
// that never paid (Stripe incomplete_expired is stored as canceled).
async function backfill(queryRunner) {
  await queryRunner.query(
    `UPDATE \`${LEDGER}\` SET activated_at = created_at, activated_at_approximate = 1
      WHERE activated_at IS NULL AND status IN ('active', 'trialing', 'past_due', 'paused')`
  );

  const paidSources = [];
  if (await queryRunner.hasTable(INVOICES)) {
    paidSources.push(`EXISTS (SELECT 1 FROM \`${INVOICES}\` ci
      WHERE ci.stripe_subscription_id = s.stripe_subscription_id AND ci.invoice_status = 'paid')`);
  }
  if (await queryRunner.hasTable(CHARGED)) {
    paidSources.push(`EXISTS (SELECT 1 FROM \`${CHARGED}\` sc WHERE sc.stripe_subscription_id = s.stripe_subscription_id)`);
  }
  if (paidSources.length) {
    await queryRunner.query(
      `UPDATE \`${LEDGER}\` s SET s.activated_at = s.created_at, s.activated_at_approximate = 1
        WHERE s.activated_at IS NULL AND s.status = 'canceled' AND (${paidSources.join(' OR ')})`
    );
  }

  await queryRunner.query(
    `UPDATE \`${LEDGER}\` SET canceled_at = updated_at, canceled_at_approximate = 1
      WHERE canceled_at IS NULL AND status = 'canceled' AND activated_at IS NOT NULL`
  );
}

class AddSubscriptionLifecycleDates1700000000055 {
  name = 'AddSubscriptionLifecycleDates1700000000055';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(LEDGER))) {
      return;
    }
    for (const column of COLUMNS) {
      if (!(await queryRunner.hasColumn(LEDGER, column.name))) {
        await queryRunner.addColumn(LEDGER, column);
      }
    }
    await backfill(queryRunner);

    for (const index of INDEXES) {
      if (await queryRunner.hasTable(index.table) && !(await hasIndex(queryRunner, index.table, index.name))) {
        await queryRunner.query(`CREATE INDEX ${index.name} ON \`${index.table}\` (${index.columns.join(', ')})`);
      }
    }
  }

  async down(queryRunner) {
    for (const index of [...INDEXES].reverse()) {
      if (await queryRunner.hasTable(index.table) && await hasIndex(queryRunner, index.table, index.name)) {
        await queryRunner.query(`DROP INDEX ${index.name} ON \`${index.table}\``);
      }
    }
    if (!(await queryRunner.hasTable(LEDGER))) {
      return;
    }
    for (const column of [...COLUMNS].reverse()) {
      if (await queryRunner.hasColumn(LEDGER, column.name)) {
        await queryRunner.dropColumn(LEDGER, column.name);
      }
    }
  }
}

module.exports = {
  AddSubscriptionLifecycleDates1700000000055
};
