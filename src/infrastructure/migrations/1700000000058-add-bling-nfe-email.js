const { TableColumn, TableIndex } = require('typeorm');

const TABLE = 'bling_nfe';
const INDEX = 'idx_bling_nfe_email_due';

// The email of the fiscal note to the customer. `email_status` stays NULL until the note is authorized, so a row that
// existed before this change never owes an email.
class AddBlingNfeEmail1700000000058 {
  name = 'AddBlingNfeEmail1700000000058';

  async up(queryRunner) {
    if (await queryRunner.hasColumn(TABLE, 'email_status')) {
      return;
    }
    await queryRunner.addColumns(TABLE, [
      new TableColumn({ name: 'email_status', type: 'varchar', length: '16', isNullable: true }),
      new TableColumn({ name: 'email_to', type: 'varchar', length: '255', isNullable: true }),
      new TableColumn({ name: 'email_sent_at', type: 'datetime', isNullable: true }),
      new TableColumn({ name: 'email_claimed_at', type: 'datetime', isNullable: true }),
      new TableColumn({ name: 'email_attempts', type: 'int', isNullable: false, default: 0 }),
      new TableColumn({ name: 'email_last_error', type: 'varchar', length: '1000', isNullable: true }),
      new TableColumn({ name: 'email_next_attempt_at', type: 'datetime', isNullable: true })
    ]);
    await queryRunner.createIndex(TABLE, new TableIndex({ name: INDEX, columnNames: ['email_status', 'email_next_attempt_at'] }));
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasColumn(TABLE, 'email_status'))) {
      return;
    }
    await queryRunner.dropIndex(TABLE, INDEX);
    for (const column of ['email_status', 'email_to', 'email_sent_at', 'email_claimed_at', 'email_attempts', 'email_last_error', 'email_next_attempt_at']) {
      await queryRunner.dropColumn(TABLE, column);
    }
  }
}

module.exports = { AddBlingNfeEmail1700000000058 };
