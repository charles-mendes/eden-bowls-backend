const { Table, TableIndex } = require('typeorm');

const NOTES_TABLE = 'bling_nfe';
const CONNECTION_TABLE = 'bling_connection';

// One row per paid Stripe invoice of the BR account: what was sent to Bling and what came back. This is the fiscal
// note and has nothing to do with customer_invoices (EB-YYYY-NNNNNN). bling_connection holds the one OAuth grant of
// this environment, with the tokens encrypted.
class CreateBlingNfe1700000000057 {
  name = 'CreateBlingNfe1700000000057';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(CONNECTION_TABLE))) {
      await queryRunner.createTable(new Table({
        name: CONNECTION_TABLE,
        columns: [
          { name: 'id', type: 'tinyint', unsigned: true, isPrimary: true },
          { name: 'access_token_enc', type: 'text', isNullable: true },
          { name: 'refresh_token_enc', type: 'text', isNullable: true },
          { name: 'access_expires_at', type: 'datetime', isNullable: true },
          { name: 'refreshed_at', type: 'datetime', isNullable: true },
          { name: 'needs_authorization', type: 'tinyint', isNullable: false, default: 1 },
          { name: 'state_hash', type: 'char', length: '64', isNullable: true },
          { name: 'state_expires_at', type: 'datetime', isNullable: true },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ]
      }), true);
    }

    if (await queryRunner.hasTable(NOTES_TABLE)) {
      return;
    }
    await queryRunner.createTable(new Table({
      name: NOTES_TABLE,
      columns: [
        { name: 'id', type: 'int', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        { name: 'status', type: 'varchar', length: '32', isNullable: false },
        { name: 'user_id', type: 'bigint', unsigned: true, isNullable: true },
        { name: 'stripe_account', type: 'varchar', length: '8', isNullable: false },
        { name: 'stripe_subscription_id', type: 'varchar', length: '64', isNullable: true },
        { name: 'stripe_invoice_id', type: 'varchar', length: '64', isNullable: false },
        { name: 'bling_contact_id', type: 'bigint', unsigned: true, isNullable: true },
        { name: 'bling_order_id', type: 'bigint', unsigned: true, isNullable: true },
        { name: 'bling_nfe_id', type: 'bigint', unsigned: true, isNullable: true },
        { name: 'nfe_number', type: 'varchar', length: '32', isNullable: true },
        { name: 'nfe_series', type: 'varchar', length: '16', isNullable: true },
        { name: 'access_key', type: 'varchar', length: '64', isNullable: true },
        { name: 'protocol', type: 'varchar', length: '32', isNullable: true },
        { name: 'bling_situacao', type: 'smallint', isNullable: true },
        { name: 'total_minor', type: 'int', isNullable: false, default: 0 },
        { name: 'currency', type: 'varchar', length: '3', isNullable: false },
        { name: 'customer_name', type: 'varchar', length: '255', isNullable: true },
        { name: 'customer_email', type: 'varchar', length: '255', isNullable: true },
        { name: 'customer_document', type: 'varchar', length: '14', isNullable: true },
        { name: 'customer_address', type: 'json', isNullable: true },
        { name: 'request_payload', type: 'json', isNullable: true },
        { name: 'response_payload', type: 'json', isNullable: true },
        { name: 'danfe_url', type: 'varchar', length: '1024', isNullable: true },
        { name: 'pdf_url', type: 'varchar', length: '1024', isNullable: true },
        { name: 'xml_url', type: 'varchar', length: '1024', isNullable: true },
        { name: 'last_error', type: 'varchar', length: '1000', isNullable: true },
        { name: 'attempts', type: 'int', isNullable: false, default: 0 },
        { name: 'next_attempt_at', type: 'datetime', isNullable: true },
        { name: 'submitted_at', type: 'datetime', isNullable: true },
        { name: 'authorized_at', type: 'datetime', isNullable: true },
        { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
      ]
    }), true);
    await queryRunner.createIndex(NOTES_TABLE, new TableIndex({
      name: 'uniq_bling_nfe_stripe',
      columnNames: ['stripe_account', 'stripe_invoice_id'],
      isUnique: true
    }));
    await queryRunner.createIndex(NOTES_TABLE, new TableIndex({
      name: 'idx_bling_nfe_due',
      columnNames: ['status', 'next_attempt_at']
    }));
    await queryRunner.createIndex(NOTES_TABLE, new TableIndex({
      name: 'idx_bling_nfe_subscription',
      columnNames: ['stripe_subscription_id']
    }));
    await queryRunner.createIndex(NOTES_TABLE, new TableIndex({
      name: 'idx_bling_nfe_created',
      columnNames: ['created_at']
    }));
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(NOTES_TABLE)) {
      await queryRunner.dropTable(NOTES_TABLE);
    }
    if (await queryRunner.hasTable(CONNECTION_TABLE)) {
      await queryRunner.dropTable(CONNECTION_TABLE);
    }
  }
}

module.exports = {
  CreateBlingNfe1700000000057
};
