const { CreateUpsPickups1700000000068 } = require('../src/infrastructure/migrations/1700000000068-create-ups-pickups');

function runner({ table = false, column = false, index = false } = {}) {
  return {
    hasTable: jest.fn(async (name) => (name === 'ups_pickups' ? table : true)),
    hasColumn: jest.fn().mockResolvedValue(column),
    query: jest.fn(async (sql) => (sql.includes('information_schema.STATISTICS') ? (index ? [{ 1: 1 }] : []) : undefined))
  };
}

const statements = (queryRunner) => queryRunner.query.mock.calls.map(([sql]) => sql);

describe('CreateUpsPickups1700000000068', () => {
  test('creates the pickups table, the shipment link and the ship-from phone', async () => {
    const queryRunner = runner();
    await new CreateUpsPickups1700000000068().up(queryRunner);
    const sql = statements(queryRunner);
    expect(sql).toEqual(expect.arrayContaining([
      expect.stringContaining('CREATE TABLE ups_pickups'),
      expect.stringContaining('ADD COLUMN `pickup_id`'),
      expect.stringContaining('CREATE INDEX idx_ups_shipments_pickup'),
      expect.stringContaining('ADD COLUMN `ship_from_phone`')
    ]));
  });

  test('skips what already exists', async () => {
    const queryRunner = runner({ table: true, column: true, index: true });
    await new CreateUpsPickups1700000000068().up(queryRunner);
    expect(statements(queryRunner).filter((sql) => !sql.includes('information_schema'))).toEqual([]);
  });

  test('down removes the three', async () => {
    const queryRunner = runner({ table: true, column: true, index: true });
    await new CreateUpsPickups1700000000068().down(queryRunner);
    const sql = statements(queryRunner);
    expect(sql).toEqual(expect.arrayContaining([
      expect.stringContaining('DROP COLUMN `ship_from_phone`'),
      expect.stringContaining('DROP INDEX idx_ups_shipments_pickup'),
      expect.stringContaining('DROP COLUMN `pickup_id`'),
      expect.stringContaining('DROP TABLE ups_pickups')
    ]));
  });
});
