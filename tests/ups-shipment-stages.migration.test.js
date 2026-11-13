const { AddUpsShipmentStages1700000000062 } = require('../src/infrastructure/migrations/1700000000062-add-ups-shipment-stages');

function runner(existing = []) {
  return {
    query: jest.fn(async (sql, params) => (sql.includes('information_schema') && existing.includes(params[1]) ? [{ 1: 1 }] : []))
  };
}

const writes = (queryRunner) => queryRunner.query.mock.calls.map(([sql]) => sql).filter((sql) => /^(ALTER|UPDATE)/.test(sql));

describe('AddUpsShipmentStages1700000000062', () => {
  test('adds the three columns and counts past letters as sent', async () => {
    const queryRunner = runner();

    await new AddUpsShipmentStages1700000000062().up(queryRunner);

    expect(writes(queryRunner)).toEqual([
      'ALTER TABLE ups_shipments ADD COLUMN in_transit_at DATETIME NULL',
      'ALTER TABLE ups_shipments ADD COLUMN out_for_delivery_at DATETIME NULL',
      'ALTER TABLE ups_shipments ADD COLUMN shipped_letter_sent_at DATETIME NULL',
      "UPDATE ups_shipments SET shipped_letter_sent_at = shipped_at WHERE status IN ('created', 'delivered') AND shipped_at IS NOT NULL"
    ]);
    expect(queryRunner.getTable).toBeUndefined();
  });

  test('a second run changes nothing, so new labels keep their letter unsent', async () => {
    const queryRunner = runner(['in_transit_at', 'out_for_delivery_at', 'shipped_letter_sent_at']);

    await new AddUpsShipmentStages1700000000062().up(queryRunner);

    expect(writes(queryRunner)).toEqual([]);
  });

  test('down removes the columns it finds', async () => {
    const queryRunner = runner(['in_transit_at', 'shipped_letter_sent_at']);

    await new AddUpsShipmentStages1700000000062().down(queryRunner);

    expect(writes(queryRunner)).toEqual([
      'ALTER TABLE ups_shipments DROP COLUMN in_transit_at',
      'ALTER TABLE ups_shipments DROP COLUMN shipped_letter_sent_at'
    ]);
  });
});
