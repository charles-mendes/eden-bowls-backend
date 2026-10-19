const { DataSource } = require('typeorm');
const { CreateLifeStageLimits1700000000035 } = require('../../src/infrastructure/migrations/1700000000035-create-life-stage-limits');
const { LifeStageLimitsRepository } = require('../../src/infrastructure/repositories/life-stage-limits.repository');
const { LifeStageService } = require('../../src/services/life-stage.service');

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

describeIntegration('LifeStageService with stored limits (MySQL)', () => {
  const database = `it_${Date.now()}_life_stage`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateLifeStageLimits1700000000035().up(runner);
    await runner.release();
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  function serviceAt(now) {
    return new LifeStageService({ repository: new LifeStageLimitsRepository(dataSource, { ttlMs: 0 }), now: () => now });
  }

  test('a giant breed stored for the market is read as giant by either name', async () => {
    const service = serviceAt(new Date('2026-10-18T12:00:00Z'));
    const pt = await service.resolve({ breed: 'dogue alemão', size: 'large', age_months: 17, age_recorded_at: '2026-10-18 09:00:00' }, 'BR');
    const en = await service.resolve({ breed: 'Great Dane', size: 'large', age_months: 17, age_recorded_at: '2026-10-18 09:00:00' }, 'US');
    expect(pt).toMatchObject({ sizeClass: 'giant', lifeStage: 'puppy' });
    expect(en).toMatchObject({ sizeClass: 'giant', lifeStage: 'puppy' });
  });

  test('changing the BR medium senior limit to 9 years does not change the US', async () => {
    await dataSource.query("UPDATE life_stage_size_classes SET senior_from_months = 108 WHERE market = 'BR' AND size_class = 'medium'");
    const service = serviceAt(new Date('2026-10-18T12:00:00Z'));
    const dog = { size: 'medium', age_years: 8, age_months: 6, age_recorded_at: '2026-10-18 09:00:00' };
    expect((await service.resolve(dog, 'BR')).lifeStage).toBe('adult');
    expect((await service.resolve(dog, 'US')).lifeStage).toBe('senior');
  });

  test('a breed added later is giant without a deploy', async () => {
    await dataSource.query(
      "INSERT INTO life_stage_breeds (market, name_pt, name_en, name_pt_normalized, name_en_normalized, size_class) VALUES ('US', 'Cão Teste', 'Test Hound', 'cao teste', 'test hound', 'giant')"
    );
    const service = serviceAt(new Date('2026-10-18T12:00:00Z'));
    expect((await service.resolve({ breed: 'Test Hound', size: 'large', age_years: 2 }, 'US')).sizeClass).toBe('giant');
  });
});
