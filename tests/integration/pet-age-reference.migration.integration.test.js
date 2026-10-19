const { DataSource } = require('typeorm');
const { CreateAuthUserTables1700000000003 } = require('../../src/infrastructure/migrations/1700000000003-create-auth-user-tables');
const { CreateUserOwnedOnboardingTables1700000000004 } = require('../../src/infrastructure/migrations/1700000000004-create-user-owned-onboarding-tables');
const { AddPetAgeReference1700000000036 } = require('../../src/infrastructure/migrations/1700000000036-add-pet-age-reference');

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

// Migration 036 on a pet created in March and edited in September.
describeIntegration('migration 1700000000036 takes the age reference from created_at (MySQL)', () => {
  const database = `it_${Date.now()}_mig036`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new CreateAuthUserTables1700000000003().up(runner);
    await new CreateUserOwnedOnboardingTables1700000000004().up(runner);
    await dataSource.query(
      "INSERT INTO wp_users (ID, user_login, user_pass, user_nicename, user_email, display_name) VALUES (4242, 'tutor-life-stage', 'x', 'tutor-life-stage', 'tutor-life-stage@example.com', 'Tutor')"
    );
    await dataSource.query(
      `INSERT INTO onboarding_pets (id, user_id, name, age_years, age_months, weight_unit, created_at, updated_at)
       VALUES ('pet-1', 4242, 'Luna', 0, 5, 'kg', '2026-03-01 10:00:00', '2026-09-01 10:00:00')`
    );
    await new AddPetAgeReference1700000000036().up(runner);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('an existing pet gets its creation date, not its last update', async () => {
    const [pet] = await dataSource.query("SELECT age_recorded_at, birth_date, life_stage_announced_at, life_stage_announced_stage FROM onboarding_pets WHERE id = 'pet-1'");
    expect(pet.age_recorded_at).toBe('2026-03-01 10:00:00');
    expect(pet.birth_date).toBeNull();
    expect(pet.life_stage_announced_at).toBeNull();
    expect(pet.life_stage_announced_stage).toBeNull();
  });

  test('a pet inserted the current way gets the insert time', async () => {
    await dataSource.query(
      "INSERT INTO onboarding_pets (id, user_id, name, age_years, age_months, weight_unit) VALUES ('pet-2', 4242, 'Thor', 2, 0, 'kg')"
    );
    const [pet] = await dataSource.query("SELECT age_recorded_at = created_at AS same FROM onboarding_pets WHERE id = 'pet-2'");
    expect(Number(pet.same)).toBe(1);
  });
});
