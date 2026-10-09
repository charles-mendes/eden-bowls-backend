const { TableColumn } = require('typeorm');

const TABLE_NAME = 'stripe_subscriptions';
// A change to the following delivery waits here while the current delivery is not paid yet.
const COLUMN = new TableColumn({
  name: 'pending_delivery_changes',
  type: 'json',
  isNullable: true
});

class AddLedgerPendingDeliveryChanges1700000000023 {
  name = 'AddLedgerPendingDeliveryChanges1700000000023';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }
    if (!(await queryRunner.hasColumn(TABLE_NAME, COLUMN.name))) {
      await queryRunner.addColumn(TABLE_NAME, COLUMN);
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }
    if (await queryRunner.hasColumn(TABLE_NAME, COLUMN.name)) {
      await queryRunner.dropColumn(TABLE_NAME, COLUMN.name);
    }
  }
}

module.exports = {
  AddLedgerPendingDeliveryChanges1700000000023
};
