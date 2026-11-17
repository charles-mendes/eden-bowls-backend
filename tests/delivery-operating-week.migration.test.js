const { CreateDeliveryOperatingWeek1700000000081 } = require('../src/infrastructure/migrations/1700000000081-create-delivery-operating-week');

function queryRunner(hasTable = false) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    createTable: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined)
  };
}

describe('CreateDeliveryOperatingWeek1700000000081', () => {
  test('creates one row per market and weekday, keyed by both', async () => {
    const runner = queryRunner();
    await new CreateDeliveryOperatingWeek1700000000081().up(runner);
    const [table] = runner.createTable.mock.calls[0];
    expect(table.name).toBe('delivery_operating_week');
    expect(table.columns.map((column) => column.name)).toEqual(['market', 'weekday', 'open', 'opens_at', 'closes_at', 'updated_at']);
    expect(table.columns.filter((column) => column.isPrimary).map((column) => column.name)).toEqual(['market', 'weekday']);
  });

  test('seeds the week applied before the table: Brazil Monday to Saturday, United States Monday to Friday, 09:00–20:00', async () => {
    const runner = queryRunner();
    await new CreateDeliveryOperatingWeek1700000000081().up(runner);
    const [sql, params] = runner.query.mock.calls[0];
    expect(sql).toContain('INSERT IGNORE INTO `delivery_operating_week`');
    expect(sql.match(/'09:00:00', '20:00:00'/g)).toHaveLength(14);
    const rows = [];
    for (let index = 0; index < params.length; index += 3) rows.push(params.slice(index, index + 3));
    expect(rows).toHaveLength(14);
    const open = (market) => rows.filter(([m, , isOpen]) => m === market && isOpen === 1).map(([, weekday]) => weekday);
    expect(open('BR')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(open('US')).toEqual([1, 2, 3, 4, 5]);
  });

  test('running up again does not create or seed twice; down drops the table', async () => {
    const existing = queryRunner(true);
    await new CreateDeliveryOperatingWeek1700000000081().up(existing);
    expect(existing.createTable).not.toHaveBeenCalled();
    expect(existing.query).not.toHaveBeenCalled();
    await new CreateDeliveryOperatingWeek1700000000081().down(existing);
    expect(existing.dropTable).toHaveBeenCalledWith('delivery_operating_week');
  });
});
