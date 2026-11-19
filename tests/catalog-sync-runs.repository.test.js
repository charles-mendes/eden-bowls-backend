const { CatalogSyncRunsRepository } = require('../src/infrastructure/repositories/catalog-sync-runs.repository');

function repositoryWith(rows = []) {
  const dataSource = {
    isInitialized: true,
    query: jest.fn(async (sql) => (String(sql).startsWith('SELECT') ? rows : { insertId: 7 }))
  };
  return { repository: new CatalogSyncRunsRepository(dataSource), dataSource };
}

function run(overrides = {}) {
  return {
    market: 'US',
    currency: 'usd',
    scope: 'market',
    status: 'completed',
    summary: { created: 1 },
    startedAt: '2026-11-18T10:00:00.000Z',
    finishedAt: '2026-11-18T10:01:00.000Z',
    ...overrides
  };
}

describe('CatalogSyncRunsRepository stripe account', () => {
  test('writes the Stripe account id of a completed run', async () => {
    const { repository, dataSource } = repositoryWith();
    await repository.insert(run({ stripeAccountId: 'acct_LOCALUS' }));

    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).toContain('`stripe_account_id`');
    expect(params[7]).toBe('acct_LOCALUS');
  });

  test('never writes an account id on a failed run', async () => {
    const { repository, dataSource } = repositoryWith();
    await repository.insert(run({ status: 'failed', error: 'boom', stripeAccountId: 'acct_LOCALUS' }));

    expect(dataSource.query.mock.calls[0][1][7]).toBeNull();
  });

  test('reads the account id back as stripeAccountId, null for older runs', async () => {
    const { repository } = repositoryWith([
      { id: 3, market: 'US', status: 'completed', scope: 'market', stripe_account_id: 'acct_LOCALUS', finished_at: '2026-11-18T10:01:00.000Z' },
      { id: 2, market: 'BR', status: 'completed', scope: 'market', stripe_account_id: null, finished_at: '2026-11-18T10:01:00.000Z' }
    ]);

    const byMarket = await repository.latestCompletedByMarket(['US', 'BR']);

    expect(byMarket.US.stripeAccountId).toBe('acct_LOCALUS');
    expect(byMarket.BR.stripeAccountId).toBeNull();
  });

  test('latestCompletedByMarket ignores failed runs and keeps product scope', async () => {
    const { repository, dataSource } = repositoryWith([]);
    await repository.latestCompletedByMarket(['us']);

    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).toContain("AND `status` IN ('completed', 'completed_with_skips')");
    expect(sql).not.toContain('`scope`');
    expect(params).toEqual(['US']);
  });

  test('latestByMarket still returns the newest run, failed ones included', async () => {
    const { repository, dataSource } = repositoryWith([]);
    await repository.latestByMarket(['US']);

    expect(dataSource.query.mock.calls[0][0]).not.toContain('`status` IN');
  });
});
