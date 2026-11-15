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
