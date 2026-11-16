const { PlanSettingsRepository } = require('../src/infrastructure/repositories/plan-settings.repository');

describe('PlanSettingsRepository', () => {
  test('reads a market once per cache window and clears it on save', async () => {
    const query = jest.fn(async (sql) => (sql.startsWith('SELECT')
      ? [{ market: 'BR', plan_days: 28, large_pack_limit: 6, updated_by: 3, updated_at: '2026-11-12T10:00:00Z' }]
      : {}));
    const repository = new PlanSettingsRepository({ isInitialized: true, query });

    expect(await repository.read('br')).toEqual({
      market: 'BR', planDays: 28, largePackLimit: 6, stored: true, updatedBy: 3, updatedAt: '2026-11-12T10:00:00.000Z'
    });
    await repository.read('BR');
    expect(query).toHaveBeenCalledTimes(1);

    await repository.save('BR', { planDays: 30, largePackLimit: 8 }, 1);
    expect(query.mock.calls[1][0]).toContain('ON DUPLICATE KEY UPDATE');
    expect(query.mock.calls[1][1]).toEqual(['BR', 30, 8, 1]);
    await repository.read('BR');
    expect(query).toHaveBeenCalledTimes(3);
  });

  test('without the table or a row the recommendation fallbacks apply', async () => {
    const missing = new PlanSettingsRepository({
      isInitialized: true,
      query: jest.fn().mockRejectedValue(new Error("ER_NO_SUCH_TABLE: Table 'x.plan_settings' doesn't exist"))
    });
    expect(await missing.read('US')).toMatchObject({ market: 'US', planDays: 30, largePackLimit: 8, stored: false });

    const empty = new PlanSettingsRepository({ isInitialized: true, query: jest.fn().mockResolvedValue([]) });
    expect(await empty.read('BR')).toMatchObject({ planDays: 30, largePackLimit: 8, stored: false });
  });

  test('other database errors are not hidden', async () => {
    const repository = new PlanSettingsRepository({ isInitialized: true, query: jest.fn().mockRejectedValue(new Error('boom')) });
    await expect(repository.read('BR')).rejects.toThrow('boom');
  });

  test('save needs a database', async () => {
    const repository = new PlanSettingsRepository(null);
    await expect(repository.save('BR', { planDays: 30, largePackLimit: 8 })).rejects.toMatchObject({ statusCode: 503 });
  });
});
