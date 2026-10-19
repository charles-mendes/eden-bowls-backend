const { DataSource } = require('typeorm');
const { CreatePetLifeStageTracking1700000000037 } = require('../../src/infrastructure/migrations/1700000000037-create-pet-life-stage-tracking');
const { PetLifeStageNoticesRepository } = require('../../src/infrastructure/repositories/pet-life-stage-notices.repository');

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
  dateStrings: true,
  entities: [],
  migrations: [],
  synchronize: false,
  logging: false
};

describeIntegration('PetLifeStageNoticesRepository.upsertNotified (MySQL)', () => {
  const database = `it_${Date.now()}_notices`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let repository;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreatePetLifeStageTracking1700000000037().up(runner);
    await runner.release();
    repository = new PetLifeStageNoticesRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('opens a notified notice and keeps the first notification on a repeat', async () => {
    const first = { subscriptionId: 11, petId: 'pet-1', fromLine: 'adult', toLine: 'senior', via: 'manual_correction', at: new Date('2026-11-02T15:00:00Z') };
    await repository.upsertNotified(first);
    await repository.upsertNotified({ ...first, via: 'announcement', at: new Date('2026-12-01T10:00:00Z') });

    const rows = await dataSource.query('SELECT subscription_id, pet_id, from_line, to_line, notified_at, notified_via, dismissed_at, resolved_at FROM pet_life_stage_notices');
    expect(rows).toEqual([{
      subscription_id: 11,
      pet_id: 'pet-1',
      from_line: 'adult',
      to_line: 'senior',
      notified_at: '2026-11-02 15:00:00',
      notified_via: 'manual_correction',
      dismissed_at: null,
      resolved_at: null
    }]);
  });
});
