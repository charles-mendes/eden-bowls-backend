// UPS U.S. holiday calendar for 2027, with the same flags as the 2026 rows in core/delivery-closed-days.
// 2027-01-01 was already seeded by 1700000000021; INSERT IGNORE keeps that row as it is.
const ALL_CLOSED = { prep: true, pickup: true, delivery: true };

const US_2027_ROWS = [
  ['2027-01-01', 'New Year\'s Day', ALL_CLOSED],
  ['2027-01-18', 'Martin Luther King Jr. Day', ALL_CLOSED],
  ['2027-03-28', 'Easter', ALL_CLOSED],
  ['2027-05-09', 'Mother\'s Day', ALL_CLOSED],
  ['2027-05-31', 'Memorial Day', ALL_CLOSED],
  ['2027-07-05', 'Independence Day (observed)', ALL_CLOSED],
  ['2027-09-06', 'Labor Day', ALL_CLOSED],
  ['2027-11-25', 'Thanksgiving', ALL_CLOSED],
  ['2027-12-24', 'Christmas Eve', { prep: false, pickup: true, delivery: false }],
  ['2027-12-25', 'Christmas Day', ALL_CLOSED],
  ['2027-12-31', 'New Year\'s Eve', { prep: false, pickup: true, delivery: true }],
  ['2028-01-01', 'New Year\'s Day', ALL_CLOSED]
];

// 2027-01-01 belongs to the 2026 seed, so down leaves it in place.
const OWNED_DATES = US_2027_ROWS
  .map(([closedOn]) => closedOn)
  .filter((closedOn) => closedOn !== '2027-01-01');

class SeedUs2027DeliveryClosedDays1700000000026 {
  name = 'SeedUs2027DeliveryClosedDays1700000000026';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable('delivery_closed_days'))) {
      return;
    }
    for (const [closedOn, label, flags] of US_2027_ROWS) {
      await queryRunner.query(
        `INSERT IGNORE INTO delivery_closed_days
          (market, closed_on, label, origin, active, closes_preparation, closes_pickup, closes_delivery)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          'US',
          closedOn,
          label,
          'ups',
          flags.prep ? 1 : 0,
          flags.pickup ? 1 : 0,
          flags.delivery ? 1 : 0
        ]
      );
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable('delivery_closed_days'))) {
      return;
    }
    await queryRunner.query(
      `DELETE FROM delivery_closed_days
       WHERE market = 'US' AND origin = 'ups' AND closed_on IN (${OWNED_DATES.map(() => '?').join(', ')})`,
      OWNED_DATES
    );
  }
}

module.exports = {
  SeedUs2027DeliveryClosedDays1700000000026
};
