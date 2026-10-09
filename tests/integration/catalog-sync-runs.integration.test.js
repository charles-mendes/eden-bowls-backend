const { createScratchDatabase } = require('./helpers/scratch-database');
const { CreateCatalogSyncRuns1700000000032 } = require('../../src/infrastructure/migrations/1700000000032-create-catalog-sync-runs');
const { CatalogSyncRunsRepository } = require('../../src/infrastructure/repositories/catalog-sync-runs.repository');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

function run(market, overrides = {}) {
  return {
    market,
    currency: market === 'US' ? 'USD' : 'BRL',
    scope: 'market',
    status: 'completed',
    summary: { created: 1, updated: 0, skipped: [] },
    startedAt: new Date('2026-10-08T10:00:00Z'),
    finishedAt: new Date('2026-10-08T10:01:00Z'),
    ...overrides
  };
}

describeIntegration('catalog sync runs (MySQL)', () => {
  let db;
  let repository;

  beforeAll(async () => {
    db = await createScratchDatabase('sync_runs', []);
    const runner = db.dataSource.createQueryRunner();
    await new CreateCatalogSyncRuns1700000000032().up(runner);
    await runner.release();
    repository = new CatalogSyncRunsRepository(db.dataSource);
  });

  afterAll(async () => {
    await db.drop();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM `catalog_sync_runs`');
  });

  test('stores a failed run with its error and reads it back from a new repository', async () => {
    await repository.insert(run('US', { status: 'failed', summary: null, error: 'No such product' }));

    const latest = await new CatalogSyncRunsRepository(db.dataSource).latestByMarket(['US']);

    expect(latest.US).toMatchObject({
      status: 'failed',
      market: 'US',
      currency: 'USD',
      scope: 'market',
      error: 'No such product',
      createdAt: '2026-10-08T10:00:00.000Z',
      updatedAt: '2026-10-08T10:01:00.000Z'
    });
  });

  test('returns the newest run of each requested market only', async () => {
    await repository.insert(run('BR', { summary: { created: 1 } }));
    await repository.insert(run('BR', { summary: { created: 2 } }));
    await repository.insert(run('US', { summary: { created: 3 } }));

    expect(Object.keys(await repository.latestByMarket(['US']))).toEqual(['US']);
    const both = await repository.latestByMarket(['BR', 'US']);
    expect(both.BR.summary).toEqual({ created: 2 });
    expect(both.US.summary).toEqual({ created: 3 });
    await expect(repository.latestByMarket([])).resolves.toEqual({});
  });

  test('keeps the newest 50 runs per market without touching the other market', async () => {
    for (let index = 1; index <= 50; index += 1) {
      await repository.insert(run('BR', { summary: { created: index } }));
    }
    await repository.insert(run('US'));

    await repository.insert(run('BR', { summary: { created: 51 } }));

    expect(await repository.countByMarket('BR')).toBe(50);
    expect(await repository.countByMarket('US')).toBe(1);
    const oldest = await db.query("SELECT JSON_EXTRACT(`summary`, '$.created') AS created FROM `catalog_sync_runs` WHERE `market` = 'BR' ORDER BY `id` ASC LIMIT 1");
    expect(Number(oldest[0].created)).toBe(2);
  });

  test('down drops the table', async () => {
    const runner = db.dataSource.createQueryRunner();
    await new CreateCatalogSyncRuns1700000000032().down(runner);
    expect(await runner.hasTable('catalog_sync_runs')).toBe(false);
    await new CreateCatalogSyncRuns1700000000032().up(runner);
    await runner.release();
  });
});
