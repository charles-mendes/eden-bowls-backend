const { PackStockRepository } = require('../src/infrastructure/repositories/pack-stock.repository');

function missingTable() {
  return Object.assign(new Error("Table 'eden.pack_stock_items' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
}

function dataSource(query) {
  return { isInitialized: true, query: jest.fn(query) };
}

describe('PackStockRepository', () => {
  test('isAvailable checks the tables once per process', async () => {
    const source = dataSource(async () => []);
    const repository = new PackStockRepository(source);

    await expect(repository.isAvailable()).resolves.toBe(true);
    await expect(repository.isAvailable()).resolves.toBe(true);
    expect(source.query).toHaveBeenCalledTimes(2);
  });

  test('isAvailable is false without the tables, and reads return empty', async () => {
    const repository = new PackStockRepository(dataSource(async () => { throw missingTable(); }));

    await expect(repository.isAvailable()).resolves.toBe(false);
    await expect(repository.listItems('BR')).resolves.toEqual([]);
    await expect(repository.listMovements({ market: 'BR' })).resolves.toEqual({ total: 0, items: [] });
  });

  test('applyMovements locks the items in key order, writes each movement and moves on_hand by their sum', async () => {
    const onHand = { 'BR|frango|300': 10, 'BR|carne|300': 0 };
    const ids = { 'BR|carne|300': 1, 'BR|frango|300': 2 };
    const manager = {
      query: jest.fn(async (sql, params) => {
        if (sql.startsWith('SELECT')) {
          const key = params.join('|');
          return [{ id: ids[key], market: params[0], flavor_key: params[1], pack_size_grams: params[2], on_hand: onHand[key], min_level: null }];
        }
        return { affectedRows: 1 };
      })
    };
    const repository = new PackStockRepository(dataSource(async () => []));

    const touched = await repository.applyMovements(manager, [
      { market: 'BR', flavorKey: 'frango', packSizeGrams: 300, type: 'separation', quantity: -4, productionCycleId: 9, subscriptionId: 42 },
      { market: 'BR', flavorKey: 'carne', packSizeGrams: 300, type: 'separation', quantity: -2, productionCycleId: 9, subscriptionId: 42 },
      { market: 'BR', flavorKey: 'frango', packSizeGrams: 300, type: 'adjustment', quantity: -1, reason: 'loss' }
    ]);

    const locks = manager.query.mock.calls.filter(([sql]) => sql.includes('FOR UPDATE')).map(([, params]) => params[1]);
    expect(locks).toEqual(['carne', 'frango']);
    expect(manager.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO `pack_stock_movements`'))).toHaveLength(3);
    const updates = manager.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE')).map(([, params]) => params);
    expect(updates).toEqual([[-2, 1], [-5, 2]]);
    expect(touched.map((item) => [item.flavorKey, item.onHand])).toEqual([['carne', -2], ['frango', 5]]);
  });

  test('openSeparationsForCycle maps what the cycle still has separated', async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ market: 'BR', flavor_key: 'frango', pack_size_grams: 300, quantity: '-4' }]) };
    const repository = new PackStockRepository(dataSource(async () => []));

    await expect(repository.openSeparationsForCycle(manager, 9)).resolves.toEqual([
      { market: 'BR', flavorKey: 'frango', packSizeGrams: 300, quantity: -4 }
    ]);
    expect(manager.query.mock.calls[0][1]).toEqual([9, 'separation', 'separation_reversal']);
  });

  test('listMovements filters one item and pages newest first', async () => {
    const source = dataSource(async (sql) => (sql.startsWith('SELECT COUNT')
      ? [{ total: 3 }]
      : [{ id: 5, market: 'BR', flavor_key: 'frango', pack_size_grams: 300, type: 'production', quantity: 30, actor_user_id: 7, actor_name: 'Ana', created_at: '2026-10-20 10:00:00' }]));
    const repository = new PackStockRepository(source);

    const result = await repository.listMovements({ market: 'BR', flavorKey: 'frango', packSizeGrams: 300 }, { perPage: 1, offset: 0 });

    expect(result.total).toBe(3);
    expect(result.items[0]).toMatchObject({ type: 'production', quantity: 30, actorName: 'Ana' });
    const [listSql, listParams] = source.query.mock.calls[1];
    expect(listSql).toContain('ORDER BY m.`created_at` DESC');
    expect(listParams).toEqual(['BR', 'frango', 300, 1, 0]);
  });
});
