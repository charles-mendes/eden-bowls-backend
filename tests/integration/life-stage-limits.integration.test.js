const { DataSource } = require('typeorm');
const { CreateLifeStageLimits1700000000035 } = require('../../src/infrastructure/migrations/1700000000035-create-life-stage-limits');
const { LifeStageLimitsRepository } = require('../../src/infrastructure/repositories/life-stage-limits.repository');
const { LifeStageService } = require('../../src/services/life-stage.service');
const { LifeStageSettingsService } = require('../../src/services/life-stage-settings.service');

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

  test('Preview before lowering the senior age: counts the BR pets that would become senior and leaves the tables as they were', async () => {
    await dataSource.query('CREATE TABLE stripe_subscriptions (id INT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT, stripe_account VARCHAR(8), status VARCHAR(32))');
    await dataSource.query(`CREATE TABLE onboarding_pets (id INT AUTO_INCREMENT PRIMARY KEY, user_id BIGINT, breed VARCHAR(191), size VARCHAR(16),
      age_years INT, age_months INT, age_recorded_at DATETIME NULL, birth_date DATE NULL, deleted_at DATETIME NULL)`);
    await dataSource.query("UPDATE life_stage_size_classes SET senior_from_months = 96 WHERE market = 'BR' AND size_class = 'medium'");
    await dataSource.query(
      "INSERT INTO stripe_subscriptions (user_id, stripe_account, status) VALUES (1, 'br', 'active'), (2, 'br', 'canceled'), (3, 'us', 'active')"
    );
    // 90 months: adult today, senior at 84. The canceled plan and the US plan do not count.
    await dataSource.query(`INSERT INTO onboarding_pets (user_id, breed, size, age_years, age_months, age_recorded_at) VALUES
      (1, '', 'medium', 7, 6, '2026-10-27 09:00:00'),
      (1, '', 'medium', 5, 0, '2026-10-27 09:00:00'),
      (2, '', 'medium', 7, 6, '2026-10-27 09:00:00'),
      (3, '', 'medium', 7, 6, '2026-10-27 09:00:00')`);
    const snapshot = async () => ({
      limits: await dataSource.query('SELECT * FROM life_stage_size_classes ORDER BY id'),
      breeds: await dataSource.query('SELECT * FROM life_stage_breeds ORDER BY id')
    });
    const before = await snapshot();
    const service = new LifeStageSettingsService({
      repository: new LifeStageLimitsRepository(dataSource, { ttlMs: 0 }),
      dataSource,
      now: () => new Date('2026-10-27T12:00:00Z')
    });

    const result = await service.preview('BR', 'br', { limits: { medium: { adult_from_months: 12, senior_from_months: 84 } } });

    expect(result).toEqual({ market: 'BR', pets_evaluated: 2, pets_changing: 1, transitions: [{ from: 'adult', to: 'senior', count: 1 }] });
    expect(await snapshot()).toEqual(before);
  });

  test('saved limits and a deactivated breed apply to the next evaluation', async () => {
    const repository = new LifeStageLimitsRepository(dataSource);
    const evaluator = new LifeStageService({ repository, now: () => new Date('2026-10-27T12:00:00Z') });
    const service = new LifeStageSettingsService({ repository, dataSource });
    const dane = { breed: 'Great Dane', size: 'large', age_years: 6 };
    expect(await evaluator.resolve(dane, 'US')).toMatchObject({ sizeClass: 'giant', lifeStage: 'senior' });

    const [breed] = await dataSource.query("SELECT id FROM life_stage_breeds WHERE market = 'US' AND name_en_normalized = 'great dane'");
    await service.updateBreed('US', Number(breed.id), { active: false }, { userId: 5 });
    await service.updateLimits('US', { large: { adult_from_months: 15, senior_from_months: 90 } }, { userId: 5 });

    expect(await evaluator.resolve(dane, 'US')).toMatchObject({ sizeClass: 'large', lifeStage: 'adult' });
    const [row] = await dataSource.query("SELECT senior_from_months, updated_by FROM life_stage_size_classes WHERE market = 'US' AND size_class = 'large'");
    expect(row).toMatchObject({ senior_from_months: 90 });
    expect(Number(row.updated_by)).toBe(5);
  });
});
