const { DataSource } = require('typeorm');
const { CreatePetLifeStageTracking1700000000037 } = require('../../src/infrastructure/migrations/1700000000037-create-pet-life-stage-tracking');

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

describeIntegration('migration 1700000000037 tracks stage notices once per transition (MySQL)', () => {
  const database = `it_${Date.now()}_mig037`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new CreatePetLifeStageTracking1700000000037().up(runner);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('a second row for the same subscription, pet and transition is refused', async () => {
    const insert = (subscriptionId, toLine) => dataSource.query(
      "INSERT INTO pet_life_stage_notices (subscription_id, pet_id, from_line, to_line) VALUES (?, 'pet-1', 'adult', ?)",
      [subscriptionId, toLine]
    );
    await insert(7, 'senior');
    await expect(insert(7, 'senior')).rejects.toThrow(/Duplicate entry/);
    await insert(8, 'senior');
    await insert(7, 'puppy');
    const [{ total }] = await dataSource.query('SELECT COUNT(*) AS total FROM pet_life_stage_notices');
    expect(Number(total)).toBe(3);
  });

  test('history and announcement rows take their defaults', async () => {
    await dataSource.query(
      "INSERT INTO pet_age_changes (pet_id, user_id, new_age_years, new_age_months, new_life_stage, source) VALUES ('pet-1', 1, 8, 0, 'senior', 'dashboard')"
    );
    await dataSource.query("INSERT INTO life_stage_announcements (market) VALUES ('BR')");
    const [change] = await dataSource.query('SELECT changed_at, old_age_years FROM pet_age_changes');
    const [announcement] = await dataSource.query('SELECT sent_at FROM life_stage_announcements');
    expect(change.changed_at).not.toBeNull();
    expect(change.old_age_years).toBeNull();
    expect(announcement.sent_at).toBeNull();
  });
});
