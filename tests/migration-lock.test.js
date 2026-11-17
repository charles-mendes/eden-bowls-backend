const { MigrationLockError, LOCK_NAME, runMigrationsExclusively } = require('../src/infrastructure/migration-lock');

function fakeDataSource({ got = 1, runMigrations = async () => [{ name: 'A1' }] } = {}) {
  const calls = [];
  const runner = {
    connect: jest.fn(async () => calls.push('connect')),
    release: jest.fn(async () => calls.push('release')),
    query: jest.fn(async (sql, params) => {
      calls.push(`${sql.match(/(GET_LOCK|RELEASE_LOCK)/)[1]}:${params.join(',')}`);
      return sql.includes('GET_LOCK') ? [{ got }] : [{ released: 1 }];
    })
  };
  const dataSource = {
    createQueryRunner: () => runner,
    runMigrations: jest.fn(async () => {
      calls.push('run');
      return runMigrations();
    })
  };
  return { dataSource, runner, calls };
}

describe('runMigrationsExclusively', () => {
  test('runs the migrations between taking and releasing the lock, on one connection', async () => {
    const { dataSource, calls } = fakeDataSource();
    const logger = { info: jest.fn() };

    const result = await runMigrationsExclusively(dataSource, { logger, waitSeconds: 30 });

    expect(result).toEqual([{ name: 'A1' }]);
    expect(calls).toEqual(['connect', `GET_LOCK:${LOCK_NAME},30`, 'run', `RELEASE_LOCK:${LOCK_NAME}`, 'release']);
    expect(logger.info).toHaveBeenCalledWith({ executed: ['A1'] }, 'Migrations checked under the lock.');
  });

  test('releases the lock and the connection when a migration fails', async () => {
    const { dataSource, calls } = fakeDataSource({ runMigrations: async () => { throw new Error('boom'); } });

    await expect(runMigrationsExclusively(dataSource)).rejects.toThrow('boom');
    expect(calls.slice(-2)).toEqual([`RELEASE_LOCK:${LOCK_NAME}`, 'release']);
  });

  test('runs nothing when the wait for the lock times out', async () => {
    const { dataSource, calls } = fakeDataSource({ got: 0 });

    await expect(runMigrationsExclusively(dataSource, { waitSeconds: 5 })).rejects.toThrow(MigrationLockError);
    await expect(runMigrationsExclusively(dataSource, { waitSeconds: 5 })).rejects.toThrow(/more than 5s/);
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
    expect(calls).not.toContain(`RELEASE_LOCK:${LOCK_NAME}`);
    expect(calls.filter((call) => call === 'release')).toHaveLength(2);
  });

  test('runs nothing when MySQL cannot take the lock', async () => {
    const { dataSource } = fakeDataSource({ got: null });

    await expect(runMigrationsExclusively(dataSource)).rejects.toThrow(/could not be taken/);
    expect(dataSource.runMigrations).not.toHaveBeenCalled();
  });
});
