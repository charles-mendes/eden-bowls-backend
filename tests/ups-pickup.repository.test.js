const { UpsPickupRepository } = require('../src/infrastructure/repositories/ups-pickup.repository');

function fakeDataSource({ linked = 2, freeRows = [], closed = 1 } = {}) {
  const manager = {
    query: jest.fn(async (sql) => {
      if (sql.startsWith('INSERT INTO')) return { insertId: 9 };
      if (sql.includes('SET `pickup_id` = ?')) return { affectedRows: linked };
      if (sql.includes('SET `status` = ?')) return { affectedRows: closed };
      return { affectedRows: 0 };
    })
  };
  const dataSource = {
    isInitialized: true,
    manager,
    transaction: jest.fn(async (work) => work(manager)),
    query: jest.fn(async (sql) => {
      if (sql.startsWith('SELECT `id`')) return freeRows;
      if (sql.startsWith('SELECT *')) return [{ id: 9, pickup_date: '2026-11-09', ready_time: '14:00', close_time: '18:00', package_count: 2, status: 'pending', shipment_ids: '[1,2]' }];
      return { affectedRows: 1 };
    })
  };
  return { dataSource, manager };
}

const input = { pickupDate: '2026-11-09', readyTime: '14:00', closeTime: '18:00', packageCount: 2, shipmentIds: [1, 2, 2], requestedBy: 'ops@edenbowls.com' };

describe('UpsPickupRepository', () => {
  test('reserves the labels with a conditional update in the same transaction', async () => {
    const { dataSource, manager } = fakeDataSource();
    const { pickup } = await new UpsPickupRepository(dataSource).reserve(input);

    expect(pickup).toMatchObject({ id: 9, pickup_date: '2026-11-09', shipment_ids: [1, 2] });
    const [insertSql, insertParams] = manager.query.mock.calls[0];
    expect(insertSql).toContain("'pending'");
    expect(insertParams).toEqual(['2026-11-09', '14:00', '18:00', 2, '[1,2]', 'ops@edenbowls.com']);
    const [updateSql, updateParams] = manager.query.mock.calls[1];
    expect(updateSql).toContain("`status` = 'created' AND `pickup_id` IS NULL AND `in_transit_at` IS NULL AND `out_for_delivery_at` IS NULL");
    expect(updateParams).toEqual([9, 1, 2]);
  });

  test('a partial reservation is undone and names the labels that could not join', async () => {
    const { dataSource } = fakeDataSource({ linked: 1, freeRows: [{ id: 1 }] });
    const result = await new UpsPickupRepository(dataSource).reserve(input);

    expect(result).toEqual({ pickup: null, ineligibleIds: [2] });
  });

  test('close frees the labels only when the status moved', async () => {
    const moved = fakeDataSource();
    expect(await new UpsPickupRepository(moved.dataSource).close(9, { fromStatus: 'requested', toStatus: 'canceled', closedBy: 'ops' })).toBe(true);
    expect(moved.manager.query.mock.calls[1][0]).toContain('SET `pickup_id` = NULL WHERE `pickup_id` = ?');

    const leftBehind = fakeDataSource();
    const before = new Date('2026-11-09T14:55:00Z');
    await new UpsPickupRepository(leftBehind.dataSource).close(9, { fromStatus: 'unknown', toStatus: 'not_created', pendingBefore: before });
    expect(leftBehind.manager.query.mock.calls[0][0]).toContain("OR (`status` = 'pending' AND `created_at` < ?)");
    expect(leftBehind.manager.query.mock.calls[0][1]).toEqual(['not_created', null, 9, 'unknown', before]);

    const stale = fakeDataSource({ closed: 0 });
    expect(await new UpsPickupRepository(stale.dataSource).close(9, { fromStatus: 'requested', toStatus: 'canceled' })).toBe(false);
    expect(stale.manager.query).toHaveBeenCalledTimes(1);
  });

  test('lists from a date, newest first, reservations in progress included', async () => {
    const { dataSource } = fakeDataSource();
    await new UpsPickupRepository(dataSource).list({ from: '2026-11-02' });
    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).not.toContain("'pending'");
    expect(sql).toContain('ORDER BY `pickup_date` DESC');
    expect(params).toEqual(['2026-11-02']);
  });

  test('active pickups by id read pending, requested and unknown', async () => {
    const { dataSource } = fakeDataSource();
    await new UpsPickupRepository(dataSource).listActiveByIds([9, 9, null]);
    expect(dataSource.query.mock.calls[0][1]).toEqual([9, 'pending', 'requested', 'unknown']);
    expect(await new UpsPickupRepository(dataSource).listActiveByIds([])).toEqual([]);
  });
});
