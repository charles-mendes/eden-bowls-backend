const { Table, TableIndex } = require('typeorm');

const TABLE_NAME = 'subscription_charged_invoices';
const UNIQUE_NAME = 'uniq_subscription_charged_invoice';

// One row per cycle invoice counted as a charged delivery. The unique key makes a repeated or concurrent
// invoice.paid a no-op, so the ledger count rises only when a row is new.
class CreateSubscriptionChargedInvoices1700000000024 {
  name = 'CreateSubscriptionChargedInvoices1700000000024';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      await queryRunner.createTable(new Table({
        name: TABLE_NAME,
        columns: [
          { name: 'id', type: 'int', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'stripe_subscription_id', type: 'varchar', length: '64', isNullable: false },
          { name: 'invoice_id', type: 'varchar', length: '64', isNullable: false },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' }
        ]
      }), true);
      await queryRunner.createIndex(TABLE_NAME, new TableIndex({
        name: UNIQUE_NAME,
        columnNames: ['stripe_subscription_id', 'invoice_id'],
        isUnique: true
      }));
    }

    // The last invoice each ledger row already counted, so its late repeat stays a no-op.
    if (await queryRunner.hasTable('stripe_subscriptions')
      && await queryRunner.hasColumn('stripe_subscriptions', 'last_charged_invoice_id')) {
      await queryRunner.query(
        `INSERT IGNORE INTO \`${TABLE_NAME}\` (\`stripe_subscription_id\`, \`invoice_id\`)
          SELECT \`stripe_subscription_id\`, \`last_charged_invoice_id\` FROM \`stripe_subscriptions\`
          WHERE \`last_charged_invoice_id\` IS NOT NULL AND \`last_charged_invoice_id\` <> ''`
      );
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE_NAME)) {
      await queryRunner.dropTable(TABLE_NAME);
    }
  }
}

module.exports = {
  CreateSubscriptionChargedInvoices1700000000024
};
