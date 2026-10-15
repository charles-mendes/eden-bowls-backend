const { AddDeliveryClosedDayType1700000000027 } = require('../src/infrastructure/migrations/1700000000027-add-delivery-closed-day-type');

function queryRunner({ hasTable = true, hasType = false, indices = ['uniq_delivery_closed_days_market_date'], shared = [] } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    hasColumn: jest.fn().mockResolvedValue(hasType),
    addColumn: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined),
    getTable: jest.fn().mockResolvedValue({ indices: indices.map((name) => ({ name })) }),
    dropIndex: jest.fn().mockResolvedValue(undefined),
    createIndex: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql) => (sql.startsWith('SELECT') ? shared : undefined))
  };
}

describe('AddDeliveryClosedDayType1700000000027', () => {
  test('adds type, fills it from origin, and swaps the unique key to market, date, and type', async () => {
    const runner = queryRunner();
    await new AddDeliveryClosedDayType1700000000027().up(runner);

    const [table, column] = runner.addColumn.mock.calls[0];
    expect(table).toBe('delivery_closed_days');
    expect(column).toMatchObject({ name: 'type', type: 'varchar', length: '16', isNullable: false });

    const updates = runner.query.mock.calls.map(([, params]) => params);
    expect(updates).toEqual([
      ['national', 'fixed', 'movable'],
      ['carrier', 'ups'],
      ['regional', 'regional'],
      ['adhoc', 'one_off']
    ]);

    expect(runner.dropIndex).toHaveBeenCalledWith('delivery_closed_days', 'uniq_delivery_closed_days_market_date');
    const [, index] = runner.createIndex.mock.calls[0];
    expect(index).toMatchObject({
      name: 'uniq_delivery_closed_days_market_date_type',
      columnNames: ['market', 'closed_on', 'type'],
      isUnique: true
    });
  });

  test('a second run adds nothing, and a missing table is skipped', async () => {
    const again = queryRunner({ hasType: true, indices: ['uniq_delivery_closed_days_market_date_type'] });
    await new AddDeliveryClosedDayType1700000000027().up(again);
    expect(again.addColumn).not.toHaveBeenCalled();
    expect(again.dropIndex).not.toHaveBeenCalled();
    expect(again.createIndex).not.toHaveBeenCalled();

    const missing = queryRunner({ hasTable: false });
    await new AddDeliveryClosedDayType1700000000027().up(missing);
    expect(missing.addColumn).not.toHaveBeenCalled();
    expect(missing.query).not.toHaveBeenCalled();
  });

  test('down restores the date key and drops type when no date has two rows', async () => {
    const runner = queryRunner({ hasType: true, indices: ['uniq_delivery_closed_days_market_date_type'] });
    await new AddDeliveryClosedDayType1700000000027().down(runner);
    expect(runner.dropIndex).toHaveBeenCalledWith('delivery_closed_days', 'uniq_delivery_closed_days_market_date_type');
    const [, index] = runner.createIndex.mock.calls[0];
    expect(index).toMatchObject({ name: 'uniq_delivery_closed_days_market_date', columnNames: ['market', 'closed_on'], isUnique: true });
    expect(runner.dropColumn).toHaveBeenCalledWith('delivery_closed_days', 'type');
  });

  test('down refuses while a date holds rows of two types', async () => {
    const runner = queryRunner({
      hasType: true,
      indices: ['uniq_delivery_closed_days_market_date_type'],
      shared: [{ market: 'BR', closed_on: '2028-01-01' }]
    });
    await expect(new AddDeliveryClosedDayType1700000000027().down(runner)).rejects.toThrow(/more than one type/);
    expect(runner.dropIndex).not.toHaveBeenCalled();
    expect(runner.dropColumn).not.toHaveBeenCalled();
  });
});
