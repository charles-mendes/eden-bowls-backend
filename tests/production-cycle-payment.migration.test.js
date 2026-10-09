const { AddProductionCyclePayment1700000000025 } = require('../src/infrastructure/migrations/1700000000025-add-production-cycle-payment');

function queryRunner(existing = [], hasTable = true) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    hasColumn: jest.fn(async (_table, name) => existing.includes(name)),
    addColumn: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined)
  };
}

describe('AddProductionCyclePayment1700000000025 (3.12)', () => {
  test('adds four nullable payment columns to subscription_production_cycles', async () => {
    const runner = queryRunner();
    await new AddProductionCyclePayment1700000000025().up(runner);
    const added = Object.fromEntries(runner.addColumn.mock.calls.map(([table, column]) => {
      expect(table).toBe('subscription_production_cycles');
      return [column.name, column];
    }));
    expect(added.paid_at).toMatchObject({ type: 'datetime', isNullable: true });
    expect(added.paid_invoice_id).toMatchObject({ type: 'varchar', length: '64', isNullable: true });
    expect(added.preparation_day).toMatchObject({ type: 'date', isNullable: true });
    expect(added.delivery_date).toMatchObject({ type: 'date', isNullable: true });
  });

  test('skips columns that exist and a missing table; down drops the four in reverse order', async () => {
    const all = ['paid_at', 'paid_invoice_id', 'preparation_day', 'delivery_date'];
    const again = queryRunner(all);
    await new AddProductionCyclePayment1700000000025().up(again);
    expect(again.addColumn).not.toHaveBeenCalled();

    const missing = queryRunner([], false);
    await new AddProductionCyclePayment1700000000025().up(missing);
    expect(missing.addColumn).not.toHaveBeenCalled();

    const down = queryRunner(all);
    await new AddProductionCyclePayment1700000000025().down(down);
    expect(down.dropColumn.mock.calls.map(([, name]) => name)).toEqual([...all].reverse());
  });
});
