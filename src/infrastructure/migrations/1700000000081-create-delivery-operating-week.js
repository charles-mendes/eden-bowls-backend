const { Table } = require('typeorm');

const TABLE_NAME = 'delivery_operating_week';

// The standard week of each market (delivery-calendar): which weekdays prepare orders and their hours, in the
// market's time zone. Weekday 1 is Monday. The seed is the week the code applied before this table, so no
// scheduled delivery moves on deploy: Brazil Monday to Saturday, United States Monday to Friday, 09:00–20:00.
const SEED = [
  ...[1, 2, 3, 4, 5, 6, 7].map((weekday) => ['BR', weekday, weekday <= 6]),
  ...[1, 2, 3, 4, 5, 6, 7].map((weekday) => ['US', weekday, weekday <= 5])
];

class CreateDeliveryOperatingWeek1700000000081 {
  name = 'CreateDeliveryOperatingWeek1700000000081';

  async up(queryRunner) {
    if (await queryRunner.hasTable(TABLE_NAME)) {
      return;
    }
    await queryRunner.createTable(new Table({
      name: TABLE_NAME,
      columns: [
        { name: 'market', type: 'varchar', length: '8', isPrimary: true },
        { name: 'weekday', type: 'tinyint', unsigned: true, isPrimary: true },
        { name: 'open', type: 'tinyint', width: 1, isNullable: false, default: 0 },
        { name: 'opens_at', type: 'time', isNullable: false, default: "'09:00:00'" },
        { name: 'closes_at', type: 'time', isNullable: false, default: "'20:00:00'" },
        { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
      ]
    }), true);
    const values = SEED.map(() => "(?, ?, ?, '09:00:00', '20:00:00')").join(', ');
    await queryRunner.query(
      `INSERT IGNORE INTO \`${TABLE_NAME}\` (\`market\`, \`weekday\`, \`open\`, \`opens_at\`, \`closes_at\`) VALUES ${values}`,
      SEED.flatMap(([market, weekday, open]) => [market, weekday, open ? 1 : 0])
    );
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE_NAME)) {
      await queryRunner.dropTable(TABLE_NAME);
    }
  }
}

module.exports = {
  CreateDeliveryOperatingWeek1700000000081
};
