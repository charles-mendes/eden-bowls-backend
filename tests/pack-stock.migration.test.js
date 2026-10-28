const { CreatePackStock1700000000054 } = require('../src/infrastructure/migrations/1700000000054-create-pack-stock');
const { buildDataSourceOptions } = require('../src/infrastructure/db');

function queryRunner({ hasTable = false } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    createTable: jest.fn(),
    createIndex: jest.fn(),
    dropTable: jest.fn()
  };
}

describe('CreatePackStock1700000000054', () => {
  test('creates the item and movement tables with the item key and the movement indexes', async () => {
    const runner = queryRunner();

    await new CreatePackStock1700000000054().up(runner);

    const [items, movements] = runner.createTable.mock.calls.map(([table]) => table);
    expect(items.name).toBe('pack_stock_items');
    expect(items.uniques[0].columnNames).toEqual(['market', 'flavor_key', 'pack_size_grams']);
    expect(items.columns.find((column) => column.name === 'on_hand').unsigned).toBeFalsy();
    expect(movements.name).toBe('pack_stock_movements');
    expect(movements.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'item_id', 'type', 'quantity', 'reason', 'note', 'production_cycle_id', 'subscription_id', 'actor_user_id'
    ]));
    expect(runner.createIndex.mock.calls.map(([, index]) => index.columnNames)).toEqual([
      ['item_id', 'created_at'],
      ['production_cycle_id']
    ]);
  });

  test('running again keeps the existing tables', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreatePackStock1700000000054().up(runner);
    expect(runner.createTable).not.toHaveBeenCalled();
  });

  test('down removes both tables', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreatePackStock1700000000054().down(runner);
    expect(runner.dropTable.mock.calls.map(([name]) => name)).toEqual(['pack_stock_movements', 'pack_stock_items']);
  });

  test('is registered after the automated email settings', () => {
    const names = buildDataSourceOptions({}).migrations.map((migration) => migration.name);
    expect(names[names.length - 1]).toBe('CreatePackStock1700000000054');
  });
});
