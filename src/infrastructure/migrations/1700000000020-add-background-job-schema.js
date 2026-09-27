const { Table, TableColumn } = require('typeorm');

const WEBHOOK_TABLE = 'stripe_webhook_events';
const MAIL_TABLE = 'subscription_mail_claims';
const CURSOR_TABLE = 'background_job_cursors';

const WEBHOOK_COLUMNS = [
  new TableColumn({ name: 'attempts', type: 'int', isNullable: false, default: 0 }),
  new TableColumn({ name: 'last_error', type: 'varchar', length: '500', isNullable: true }),
  new TableColumn({ name: 'next_attempt_at', type: 'datetime', isNullable: true }),
  new TableColumn({ name: 'failed_at', type: 'datetime', isNullable: true }),
  new TableColumn({
    name: 'created_at',
    type: 'datetime',
    isNullable: false,
    default: 'CURRENT_TIMESTAMP'
  })
];

const MAIL_COLUMNS = [
  new TableColumn({ name: 'attempts', type: 'int', isNullable: false, default: 0 }),
  new TableColumn({ name: 'last_error', type: 'varchar', length: '500', isNullable: true }),
  new TableColumn({ name: 'exhausted_at', type: 'datetime', isNullable: true }),
  new TableColumn({ name: 'payload', type: 'json', isNullable: true })
];

class AddBackgroundJobSchema1700000000020 {
  name = 'AddBackgroundJobSchema1700000000020';

  async up(queryRunner) {
    if (await queryRunner.hasTable(WEBHOOK_TABLE)) {
      await this.makeProcessedAtNullable(queryRunner);
      await this.addMissingColumns(queryRunner, WEBHOOK_TABLE, WEBHOOK_COLUMNS);
    }

    if (await queryRunner.hasTable(MAIL_TABLE)) {
      await this.addMissingColumns(queryRunner, MAIL_TABLE, MAIL_COLUMNS);
    }

    if (!(await queryRunner.hasTable(CURSOR_TABLE))) {
      await queryRunner.createTable(new Table({
        name: CURSOR_TABLE,
        columns: [
          { name: 'job_name', type: 'varchar', length: '64', isPrimary: true, isNullable: false },
          { name: 'cursor', type: 'varchar', length: '191', isNullable: false, default: "'0'" },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' }
        ]
      }));
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(CURSOR_TABLE)) {
      await queryRunner.dropTable(CURSOR_TABLE);
    }

    if (await queryRunner.hasTable(MAIL_TABLE)) {
      await this.dropColumns(queryRunner, MAIL_TABLE, MAIL_COLUMNS);
    }

    if (await queryRunner.hasTable(WEBHOOK_TABLE)) {
      await this.dropColumns(queryRunner, WEBHOOK_TABLE, WEBHOOK_COLUMNS);
      const table = await queryRunner.getTable(WEBHOOK_TABLE);
      const column = table && (table.columns || []).find((item) => item.name === 'processed_at');
      if (column && column.isNullable) {
        await queryRunner.changeColumn(WEBHOOK_TABLE, 'processed_at', new TableColumn({
          name: 'processed_at',
          type: 'datetime',
          isNullable: false,
          default: 'CURRENT_TIMESTAMP'
        }));
      }
    }
  }

  async makeProcessedAtNullable(queryRunner) {
    const table = await queryRunner.getTable(WEBHOOK_TABLE);
    const column = table && (table.columns || []).find((item) => item.name === 'processed_at');
    if (!column || column.isNullable) {
      return;
    }

    await queryRunner.changeColumn(WEBHOOK_TABLE, 'processed_at', new TableColumn({
      name: 'processed_at',
      type: 'datetime',
      isNullable: true
    }));
  }

  async addMissingColumns(queryRunner, tableName, columns) {
    for (const column of columns) {
      if (!(await queryRunner.hasColumn(tableName, column.name))) {
        await queryRunner.addColumn(tableName, column);
      }
    }
  }

  async dropColumns(queryRunner, tableName, columns) {
    for (const column of columns) {
      if (await queryRunner.hasColumn(tableName, column.name)) {
        await queryRunner.dropColumn(tableName, column.name);
      }
    }
  }
}

module.exports = {
  AddBackgroundJobSchema1700000000020
};
