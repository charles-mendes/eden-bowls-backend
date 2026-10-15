const { TableColumn } = require('typeorm');

const TABLE_NAME = 'stripe_subscriptions';
const COLUMNS = [
  new TableColumn({
    name: 'charged_deliveries',
    type: 'int',
    unsigned: true,
    isNullable: true
  }),
  new TableColumn({
    name: 'last_charged_invoice_id',
    type: 'varchar',
    length: '64',
    isNullable: true
  }),
  new TableColumn({
    name: 'auto_renew',
    type: 'tinyint',
    width: 1,
    isNullable: true
  })
];

class AddLedgerChargedDeliveries1700000000022 {
  name = 'AddLedgerChargedDeliveries1700000000022';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }
    for (const column of COLUMNS) {
      if (!(await queryRunner.hasColumn(TABLE_NAME, column.name))) {
        await queryRunner.addColumn(TABLE_NAME, column);
      }
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }
    for (const column of [...COLUMNS].reverse()) {
      if (await queryRunner.hasColumn(TABLE_NAME, column.name)) {
        await queryRunner.dropColumn(TABLE_NAME, column.name);
      }
    }
  }
}

module.exports = {
  AddLedgerChargedDeliveries1700000000022
};
