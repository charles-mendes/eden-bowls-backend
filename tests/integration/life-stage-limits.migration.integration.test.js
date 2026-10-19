const { DataSource } = require('typeorm');
const { CreateLifeStageLimits1700000000035 } = require('../../src/infrastructure/migrations/1700000000035-create-life-stage-limits');

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
  migrations: [],
  synchronize: false,
  logging: false
};

describeIntegration('migration 1700000000035 stores stage limits per market (MySQL)', () => {
  const database = `it_${Date.now()}_mig035`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new CreateLifeStageLimits1700000000035().up(runner);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('eight limit rows with the approved values', async () => {
    const rows = await dataSource.query(
      'SELECT market, size_class, adult_from_months, senior_from_months FROM life_stage_size_classes ORDER BY market, adult_from_months'
    );
    const values = rows.map((row) => [row.market, row.size_class, Number(row.adult_from_months), Number(row.senior_from_months)]);
    expect(values).toEqual(['BR', 'US'].flatMap((market) => [
      [market, 'small', 10, 120],
      [market, 'medium', 12, 96],
      [market, 'large', 15, 84],
      [market, 'giant', 18, 72]
    ]));
  });

  test('Great Dane and Dogue Alemão are giant in both markets', async () => {
    for (const market of ['BR', 'US']) {
      const byEn = await dataSource.query(
        'SELECT size_class FROM life_stage_breeds WHERE market = ? AND name_en_normalized = ? AND active = 1', [market, 'great dane']
      );
      const byPt = await dataSource.query(
        'SELECT size_class FROM life_stage_breeds WHERE market = ? AND name_pt_normalized = ? AND active = 1', [market, 'dogue alemao']
      );
      expect(byEn.map((row) => row.size_class)).toEqual(['giant']);
      expect(byPt.map((row) => row.size_class)).toEqual(['giant']);
    }
  });

  test('duplicate CSV rows collapse and both Portuguese spellings of one breed stay', async () => {
    const [{ total }] = await dataSource.query("SELECT COUNT(*) AS total FROM life_stage_breeds WHERE market = 'BR'");
    expect(Number(total)).toBe(47);
    const leonberger = await dataSource.query(
      "SELECT id FROM life_stage_breeds WHERE market = 'BR' AND name_en_normalized = 'leonberger'"
    );
    expect(leonberger).toHaveLength(1);
    const bucovina = await dataSource.query(
      "SELECT name_pt FROM life_stage_breeds WHERE market = 'BR' AND name_en_normalized = 'bucovina shepherd' ORDER BY name_pt"
    );
    expect(bucovina.map((row) => row.name_pt)).toEqual(['Pastor da Bucovina', 'Pastor de Bucovina']);
  });

  test('a second run adds no row', async () => {
    await new CreateLifeStageLimits1700000000035().up(runner);
    const [{ limits }] = await dataSource.query('SELECT COUNT(*) AS limits FROM life_stage_size_classes');
    const [{ breeds }] = await dataSource.query('SELECT COUNT(*) AS breeds FROM life_stage_breeds');
    expect(Number(limits)).toBe(8);
    expect(Number(breeds)).toBe(94);
  });
});
