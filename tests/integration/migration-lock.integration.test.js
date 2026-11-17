const { DataSource } = require('typeorm');
const { runMigrationsExclusively } = require('../../src/infrastructure/migration-lock');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

const connection = {
  type: 'mysql',
  host: process.env.INTEGRATION_DB_HOST || '127.0.0.1',
  port: Number(process.env.INTEGRATION_DB_PORT || 3310),
  username: process.env.INTEGRATION_DB_USER || 'root',
  password: process.env.INTEGRATION_DB_PASSWORD || 'root',
  charset: 'utf8mb4',
  timezone: 'Z',
  entities: [],
  synchronize: false,
  logging: false
};

// Like the 2026-11-16 QA deploy: a column that fails when added twice, and a published row each run inserts.
class CreateLockProbe1700000900001 {
  name = 'CreateLockProbe1700000900001';

  async up(queryRunner) {
    await queryRunner.query('CREATE TABLE lock_probe (id INT AUTO_INCREMENT PRIMARY KEY, status VARCHAR(16) NOT NULL)');
  }

  async down(queryRunner) {
    await queryRunner.query('DROP TABLE lock_probe');
  }
}

class SlowNonIdempotent1700000900002 {
  name = 'SlowNonIdempotent1700000900002';

  async up(queryRunner) {
    await queryRunner.query('SELECT SLEEP(1)');
    await queryRunner.query('ALTER TABLE lock_probe ADD COLUMN note VARCHAR(16) NULL');
    await queryRunner.query("UPDATE lock_probe SET status = 'retired' WHERE status = 'published'");
    await queryRunner.query("INSERT INTO lock_probe (status) VALUES ('published')");
  }

  async down(queryRunner) {
    await queryRunner.query('ALTER TABLE lock_probe DROP COLUMN note');
  }
}

describeIntegration('the API and the cron start together and the migrations run once (MySQL)', () => {
  const database = `it_${Date.now()}_miglock`;
  const admin = new DataSource({ ...connection, migrations: [], database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  const sources = [];

  function processDataSource() {
    const dataSource = new DataSource({
      ...connection,
      database,
      migrations: [CreateLockProbe1700000900001, SlowNonIdempotent1700000900002],
      migrationsTransactionMode: 'each'
    });
    sources.push(dataSource);
    return dataSource;
  }

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
  });

  afterAll(async () => {
    for (const dataSource of sources) {
      if (dataSource.isInitialized) await dataSource.destroy();
    }
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.destroy();
  });

  test('two boots at the same time apply each migration once and both start', async () => {
    const api = processDataSource();
    const cron = processDataSource();
    await Promise.all([api.initialize(), cron.initialize()]);

    const [first, second] = await Promise.all([
      runMigrationsExclusively(api, { waitSeconds: 30, lockName: database }),
      runMigrationsExclusively(cron, { waitSeconds: 30, lockName: database })
    ]);

    expect([first.length, second.length].sort()).toEqual([0, 2]);
    const recorded = await api.query('SELECT name, COUNT(*) AS times FROM migrations GROUP BY name ORDER BY name');
    expect(recorded.map((row) => [row.name, Number(row.times)])).toEqual([
      ['CreateLockProbe1700000900001', 1],
      ['SlowNonIdempotent1700000900002', 1]
    ]);
    const published = await api.query("SELECT COUNT(*) AS n FROM lock_probe WHERE status = 'published'");
    expect(Number(published[0].n)).toBe(1);
  });

  test('a boot that finds the lock taken for too long runs nothing', async () => {
    const holder = processDataSource();
    const late = processDataSource();
    await Promise.all([holder.initialize(), late.initialize()]);
    const runner = holder.createQueryRunner();
    await runner.connect();
    await runner.query('SELECT GET_LOCK(?, 0)', [`${database}_held`]);
    try {
      await expect(runMigrationsExclusively(late, { waitSeconds: 1, lockName: `${database}_held` }))
        .rejects.toThrow(/more than 1s/);
    } finally {
      await runner.query('SELECT RELEASE_LOCK(?)', [`${database}_held`]);
      await runner.release();
    }
  });
});
