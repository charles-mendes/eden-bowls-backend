const { TableColumn } = require('typeorm');

const TABLE_NAME = 'subscription_production_cycles';
// A cycle is produced only after its invoice is paid. The preparation day is the first valid day whose
// local midnight is at or after that payment, so a late payment moves it and the delivery date.
const COLUMNS = [
  new TableColumn({ name: 'paid_at', type: 'datetime', isNullable: true }),
  new TableColumn({ name: 'paid_invoice_id', type: 'varchar', length: '64', isNullable: true }),
  new TableColumn({ name: 'preparation_day', type: 'date', isNullable: true }),
  new TableColumn({ name: 'delivery_date', type: 'date', isNullable: true })
];

class AddProductionCyclePayment1700000000025 {
  name = 'AddProductionCyclePayment1700000000025';

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
  AddProductionCyclePayment1700000000025
};
