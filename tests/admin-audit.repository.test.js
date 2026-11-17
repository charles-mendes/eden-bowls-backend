const { AdminAuditRepository } = require('../src/infrastructure/repositories/admin-audit.repository');

function repositoryWith(rows) {
  const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue(rows) };
  return { repository: new AdminAuditRepository(dataSource), dataSource };
}

describe('AdminAuditRepository.listByActionPrefix', () => {
  test('lists the events of one market by action prefix, the underscore matched literally', async () => {
    const { repository, dataSource } = repositoryWith([{
      id: '3', actor_user_id: '9', actor_email: 'op.br@edenbowls.com', action: 'life_stage.breed.update',
      metadata: '{"market":"BR","breed_id":4}', created_at: new Date('2026-11-12T13:20:00.000Z')
    }]);

    const events = await repository.listByActionPrefix({ actionPrefix: 'life_stage.', market: 'BR', limit: 50 });

    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).toContain("JSON_EXTRACT(metadata, '$.market')) = ?");
    expect(params).toEqual(['life\\_stage.%', 'BR', 50]);
    expect(events).toEqual([{
      id: 3, actorUserId: 9, actorEmail: 'op.br@edenbowls.com', action: 'life_stage.breed.update',
      metadata: { market: 'BR', breed_id: 4 }, createdAt: '2026-11-12T13:20:00.000Z'
    }]);
  });

  test('without a market it filters by action only', async () => {
    const { repository, dataSource } = repositoryWith([]);
    await repository.listByActionPrefix({ actionPrefix: 'nutrition.parameters.' });
    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).not.toContain('$.market');
    expect(params).toEqual(['nutrition.parameters.%', 50]);
  });
});

describe('AdminAuditRepository.listDeliveryCalendar', () => {
  test('History after closing Saturday: week changes are listed by the year they were made', async () => {
    const weekEvent = {
      id: '12', actor_user_id: '7', actor_email: 'op@edenbowls.com', action: 'delivery_calendar.week_update',
      metadata: JSON.stringify({
        market: 'BR',
        before: [{ weekday: 6, open: true, opensAt: '09:00', closesAt: '20:00' }],
        after: [{ weekday: 6, open: false, opensAt: '09:00', closesAt: '20:00' }],
        impact: [{ stripeSubscriptionId: 'sub_1', deliveryId: 'current', previousPreparationDay: '2026-11-21', newPreparationDay: '2026-11-23', outcome: 'moved', move: 'stripe_sync' }],
        syncIds: [501]
      }),
      created_at: new Date('2026-11-17T15:00:00.000Z')
    };
    const { repository, dataSource } = repositoryWith([weekEvent]);

    const events = await repository.listDeliveryCalendar({ market: 'BR', year: 2026 });

    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).toContain("$.closedOn')) LIKE ?");
    expect(sql).toContain("action = 'delivery_calendar.week_update' AND YEAR(created_at) = ?");
    expect(sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(params).toEqual(['BR', '2026-%', 2026, 200]);
    expect(events[0]).toMatchObject({
      actorEmail: 'op@edenbowls.com',
      action: 'delivery_calendar.week_update',
      metadata: { market: 'BR', after: [{ weekday: 6, open: false }], impact: [{ newPreparationDay: '2026-11-23', outcome: 'moved' }] }
    });
  });
});
