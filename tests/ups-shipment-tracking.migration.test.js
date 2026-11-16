const { AddUpsShipmentTracking1700000000059 } = require('../src/infrastructure/migrations/1700000000059-add-ups-shipment-tracking');

function runner(existing = []) {
  return {
    query: jest.fn(async (sql, params) => (sql.includes('information_schema') && existing.includes(params[1]) ? [{ 1: 1 }] : []))
  };
}

const changes = (queryRunner) => queryRunner.query.mock.calls.map(([sql]) => sql).filter((sql) => sql.startsWith('ALTER'));

describe('AddUpsShipmentTracking1700000000059', () => {
  test('adds only the missing columns, without the TypeORM table reader', async () => {
    const queryRunner = runner(['tracking_status']);

    await new AddUpsShipmentTracking1700000000059().up(queryRunner);

    expect(changes(queryRunner)).toHaveLength(4);
    expect(changes(queryRunner).join()).not.toContain('tracking_status');
    expect(queryRunner.getTable).toBeUndefined();
  });

  test('down removes the columns it finds', async () => {
    const queryRunner = runner(['delivered_at']);

    await new AddUpsShipmentTracking1700000000059().down(queryRunner);

    expect(changes(queryRunner)).toEqual(['ALTER TABLE ups_shipments DROP COLUMN delivered_at']);
  });
});
