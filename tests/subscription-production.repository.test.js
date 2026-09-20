const { SubscriptionProductionRepository } = require('../src/infrastructure/repositories/subscription-production.repository');

describe('SubscriptionProductionRepository', () => {
  test('inserts a cycle when the unique key is missing', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 1, insertId: 9 })
      .mockResolvedValueOnce([{
        id: 9,
        subscription_id: 42,
        period_end: '2026-09-20 08:00:00',
        status: 'in_production',
        note: null,
        updated_by_user_id: 7
      }]);
    const repository = new SubscriptionProductionRepository({ isInitialized: true, query });

    const row = await repository.upsert({
      subscriptionId: 42,
      periodEnd: '2026-09-20T08:00:00.000Z',
      status: 'in_production',
      note: null,
      updatedByUserId: 7
    });

    expect(row.status).toBe('in_production');
    expect(query.mock.calls[1][0]).toContain('INSERT INTO');
    expect(query.mock.calls[1][0]).toContain('subscription_id');
    expect(query.mock.calls[1][0]).toContain('period_end');
    expect(query.mock.calls[1][1]).toEqual([42, '2026-09-20 08:00:00', 'in_production', null, 7]);
  });

  test('updates a cycle when the unique key already exists', async () => {
    const existing = {
      id: 9,
      subscription_id: 42,
      period_end: '2026-09-20 08:00:00',
      status: 'in_production',
      note: null,
      updated_by_user_id: 7
    };
    const query = jest.fn()
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{
        ...existing,
        status: 'blocked',
        note: 'Falta estoque de peru'
      }]);
    const repository = new SubscriptionProductionRepository({ isInitialized: true, query });

    const row = await repository.upsert({
      subscriptionId: 42,
      periodEnd: '2026-09-20T08:00:00.000Z',
      status: 'blocked',
      note: 'Falta estoque de peru',
      updatedByUserId: 7
    });

    expect(row.status).toBe('blocked');
    expect(query.mock.calls[1][0]).toContain('UPDATE');
    expect(query.mock.calls[1][0]).toContain('WHERE `subscription_id` = ? AND `period_end` = ?');
    expect(query.mock.calls[1][1]).toEqual([
      'blocked',
      'Falta estoque de peru',
      7,
      42,
      '2026-09-20 08:00:00'
    ]);
  });
});
