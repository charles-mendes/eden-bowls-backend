const { TableColumn, TableIndex } = require('typeorm');

const TABLE_NAME = 'delivery_closed_days';
const OLD_INDEX = 'uniq_delivery_closed_days_market_date';
const NEW_INDEX = 'uniq_delivery_closed_days_market_date_type';
// One row per type on a date, so removing an adhoc closure leaves the national or carrier row of that date.
const TYPE_BY_ORIGIN = [
  ['national', ['fixed', 'movable']],
  ['carrier', ['ups']],
  ['regional', ['regional']],
  ['adhoc', ['one_off']]
];

class AddDeliveryClosedDayType1700000000027 {
  name = 'AddDeliveryClosedDayType1700000000027';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }
    if (!(await queryRunner.hasColumn(TABLE_NAME, 'type'))) {
      await queryRunner.addColumn(TABLE_NAME, new TableColumn({
        name: 'type',
        type: 'varchar',
        length: '16',
        isNullable: false,
        default: "'adhoc'"
      }));
    }
    for (const [type, origins] of TYPE_BY_ORIGIN) {
      await queryRunner.query(
        `UPDATE ${TABLE_NAME} SET type = ? WHERE origin IN (${origins.map(() => '?').join(', ')})`,
        [type, ...origins]
      );
    }
    const table = await queryRunner.getTable(TABLE_NAME);
    if (table.indices.some((index) => index.name === OLD_INDEX)) {
      await queryRunner.dropIndex(TABLE_NAME, OLD_INDEX);
    }
    if (!table.indices.some((index) => index.name === NEW_INDEX)) {
      await queryRunner.createIndex(TABLE_NAME, new TableIndex({
        name: NEW_INDEX,
        columnNames: ['market', 'closed_on', 'type'],
        isUnique: true
      }));
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE_NAME))) {
      return;
    }
    const shared = await queryRunner.query(
      `SELECT market, closed_on FROM ${TABLE_NAME} GROUP BY market, closed_on HAVING COUNT(*) > 1 LIMIT 1`
    );
    if (shared.length > 0) {
      throw new Error(`${this.name}.down: a date holds rows of more than one type; remove them before reverting.`);
    }
    const table = await queryRunner.getTable(TABLE_NAME);
    if (table.indices.some((index) => index.name === NEW_INDEX)) {
      await queryRunner.dropIndex(TABLE_NAME, NEW_INDEX);
    }
    if (!table.indices.some((index) => index.name === OLD_INDEX)) {
      await queryRunner.createIndex(TABLE_NAME, new TableIndex({
        name: OLD_INDEX,
        columnNames: ['market', 'closed_on'],
        isUnique: true
      }));
    }
    if (await queryRunner.hasColumn(TABLE_NAME, 'type')) {
      await queryRunner.dropColumn(TABLE_NAME, 'type');
    }
  }
}

module.exports = {
  AddDeliveryClosedDayType1700000000027
};
