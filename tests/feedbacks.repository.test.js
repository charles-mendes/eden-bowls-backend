const { FeedbacksRepository } = require('../src/infrastructure/repositories/feedbacks.repository');

function row(overrides = {}) {
  return {
    id: 1,
    name: 'João Silva',
    category: 'tutor',
    country: 'BR',
    place: 'São Paulo',
    photo: '/feedback-photos/photo-1.png',
    comment: 'Excelente.',
    active: 1,
    created_at: new Date('2026-08-20T12:00:00.000Z'),
    updated_at: new Date('2026-08-21T12:00:00.000Z'),
    ...overrides
  };
}

describe('FeedbacksRepository', () => {
  test('lists feedbacks filtered by country, status and name', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([row()])
    };
    const repository = new FeedbacksRepository(dataSource);

    const result = await repository.list({
      country: 'BR',
      active: true,
      search: 'João',
      perPage: 20,
      offset: 0
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: 1,
      name: 'João Silva',
      country: 'BR',
      active: true
    });
    const listSql = dataSource.query.mock.calls[1][0];
    expect(listSql).toContain('`country` = ?');
    expect(listSql).toContain('`active` = ?');
    expect(listSql).toContain('`name` LIKE ?');
    expect(dataSource.query.mock.calls[1][1]).toEqual(['BR', 1, '%João%', 20, 0]);
  });

  test('lists only active public feedbacks for a country', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([row({ active: 1 }), row({ id: 2, name: 'Ana' })])
    };
    const repository = new FeedbacksRepository(dataSource);

    const items = await repository.listPublic({ country: 'US' });

    expect(items).toHaveLength(2);
    expect(dataSource.query.mock.calls[0][0]).toContain('`country` = ? AND `active` = 1');
    expect(dataSource.query.mock.calls[0][0]).toContain('ORDER BY `created_at` ASC, `id` ASC');
    expect(dataSource.query.mock.calls[0][1][0]).toBe('US');
  });

  test('reads insertId from either mysql2 result shape', async () => {
    const created = row({ id: 11 });
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ insertId: 11 }])
        .mockResolvedValueOnce([created])
    };
    const repository = new FeedbacksRepository(dataSource);

    const item = await repository.create({
      name: 'João Silva',
      category: 'tutor',
      country: 'BR',
      place: 'São Paulo',
      comment: 'Excelente.',
      active: true
    });

    expect(item.id).toBe(11);
    expect(dataSource.query.mock.calls[1][1]).toEqual([11]);
  });
});
