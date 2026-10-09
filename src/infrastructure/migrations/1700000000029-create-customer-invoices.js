const { Table, TableIndex } = require('typeorm');

const TABLE_NAME = 'customer_invoices';
const SEQUENCES_TABLE = 'customer_invoice_sequences';

// One row per Stripe invoice turned into an Eden Bowls invoice PDF (EB-YYYY-NNNNNN). The PDF is written to
// INVOICE_PDF_DIR and the row keeps its file name, its hash and when it was emailed to the customer.
// The sequence table hands out one number per year, so a number is never given twice.
class CreateCustomerInvoices1700000000029 {
  name = 'CreateCustomerInvoices1700000000029';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(SEQUENCES_TABLE))) {
      await queryRunner.createTable(new Table({
        name: SEQUENCES_TABLE,
        columns: [
          { name: 'year', type: 'smallint', unsigned: true, isPrimary: true },
          { name: 'last_value', type: 'int', unsigned: true, isNullable: false, default: 0 }
        ]
      }), true);
    }

    if (await queryRunner.hasTable(TABLE_NAME)) {
      return;
    }
    await queryRunner.createTable(new Table({
      name: TABLE_NAME,
      columns: [
        { name: 'id', type: 'int', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        { name: 'invoice_number', type: 'varchar', length: '32', isNullable: false },
        { name: 'stripe_account', type: 'varchar', length: '8', isNullable: false },
        { name: 'stripe_invoice_id', type: 'varchar', length: '64', isNullable: false },
        { name: 'stripe_subscription_id', type: 'varchar', length: '64', isNullable: true },
        { name: 'user_id', type: 'bigint', unsigned: true, isNullable: true },
        { name: 'locale', type: 'varchar', length: '8', isNullable: false },
        { name: 'currency', type: 'varchar', length: '3', isNullable: false },
        { name: 'total_minor', type: 'int', isNullable: false, default: 0 },
        { name: 'amount_paid_minor', type: 'int', isNullable: false, default: 0 },
        { name: 'invoice_status', type: 'varchar', length: '16', isNullable: false },
        { name: 'billing_reason', type: 'varchar', length: '32', isNullable: true },
        { name: 'issued_at', type: 'datetime', isNullable: false },
        { name: 'pdf_filename', type: 'varchar', length: '128', isNullable: true },
        { name: 'pdf_sha256', type: 'char', length: '64', isNullable: true },
        { name: 'pdf_generated_at', type: 'datetime', isNullable: true },
        { name: 'customer_name', type: 'varchar', length: '255', isNullable: true },
        { name: 'email_to', type: 'varchar', length: '255', isNullable: true },
        { name: 'email_status', type: 'varchar', length: '16', isNullable: false, default: "'pending'" },
        { name: 'email_sent_at', type: 'datetime', isNullable: true },
        { name: 'email_attempts', type: 'int', isNullable: false, default: 0 },
        { name: 'email_last_error', type: 'varchar', length: '500', isNullable: true },
        { name: 'email_next_attempt_at', type: 'datetime', isNullable: true },
        { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
      ]
    }), true);
    await queryRunner.createIndex(TABLE_NAME, new TableIndex({
      name: 'uniq_customer_invoices_number',
      columnNames: ['invoice_number'],
      isUnique: true
    }));
    await queryRunner.createIndex(TABLE_NAME, new TableIndex({
      name: 'uniq_customer_invoices_stripe',
      columnNames: ['stripe_account', 'stripe_invoice_id'],
      isUnique: true
    }));
    await queryRunner.createIndex(TABLE_NAME, new TableIndex({
      name: 'idx_customer_invoices_subscription',
      columnNames: ['stripe_subscription_id']
    }));
    await queryRunner.createIndex(TABLE_NAME, new TableIndex({
      name: 'idx_customer_invoices_email_due',
      columnNames: ['email_status', 'email_next_attempt_at']
    }));
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE_NAME)) {
      await queryRunner.dropTable(TABLE_NAME);
    }
    if (await queryRunner.hasTable(SEQUENCES_TABLE)) {
      await queryRunner.dropTable(SEQUENCES_TABLE);
    }
  }
}

module.exports = {
  CreateCustomerInvoices1700000000029
};
