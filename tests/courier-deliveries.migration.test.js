const { CreateCourierDeliveries1700000000063 } = require('../src/infrastructure/migrations/1700000000063-create-courier-deliveries');

function runner(existing = []) {
  return {
    query: jest.fn(async (sql, params = []) => {
      if (!sql.includes('information_schema')) return [];
      const name = sql.includes('information_schema.TABLES') ? 'table' : params[1];
      return existing.includes(name) ? [{ 1: 1 }] : [];
    })
  };
}

const writes = (queryRunner) => queryRunner.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim()).filter((sql) => /^(CREATE|ALTER|DROP)/.test(sql));

describe('CreateCourierDeliveries1700000000063', () => {
  test('creates the table, the active invoice key and the indexes without getTable', async () => {
    const queryRunner = runner();

    await new CreateCourierDeliveries1700000000063().up(queryRunner);

    const sql = writes(queryRunner);
    expect(sql[0]).toMatch(/^CREATE TABLE courier_deliveries \(/);
    expect(sql[1]).toBe("ALTER TABLE courier_deliveries ADD COLUMN active_invoice_key VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN status IN ('out_for_delivery', 'delivered') THEN stripe_invoice_id ELSE NULL END) STORED");
    expect(sql.slice(2)).toEqual([
      'CREATE UNIQUE INDEX uq_courier_deliveries_active_invoice ON courier_deliveries (active_invoice_key)',
      'CREATE INDEX idx_courier_deliveries_subscription ON courier_deliveries (subscription_id)',
      'CREATE INDEX idx_courier_deliveries_status_out ON courier_deliveries (status, out_for_delivery_at)'
    ]);
    expect(queryRunner.getTable).toBeUndefined();
  });

  test('a second run changes nothing', async () => {
    const queryRunner = runner(['table', 'active_invoice_key', 'uq_courier_deliveries_active_invoice', 'idx_courier_deliveries_subscription', 'idx_courier_deliveries_status_out']);

    await new CreateCourierDeliveries1700000000063().up(queryRunner);

    expect(writes(queryRunner)).toEqual([]);
  });

  test('down drops the table', async () => {
    const queryRunner = runner(['table']);

    await new CreateCourierDeliveries1700000000063().down(queryRunner);

    expect(writes(queryRunner)).toEqual(['DROP TABLE courier_deliveries']);
  });
});
