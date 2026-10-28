const { DataSource } = require('typeorm');
const { CreateAuthUserTables1700000000003 } = require('../../src/infrastructure/migrations/1700000000003-create-auth-user-tables');
const { CreateUserOwnedOnboardingTables1700000000004 } = require('../../src/infrastructure/migrations/1700000000004-create-user-owned-onboarding-tables');
const { AddPetAgeReference1700000000036 } = require('../../src/infrastructure/migrations/1700000000036-add-pet-age-reference');
const { CreatePetLifeStageTracking1700000000037 } = require('../../src/infrastructure/migrations/1700000000037-create-pet-life-stage-tracking');
const { OnboardingPetCreateRepository } = require('../../src/infrastructure/repositories/onboarding-pets-create.repository');
const { OnboardingPetUpdateRepository } = require('../../src/infrastructure/repositories/onboarding-pets-update.repository');
const { PetAgeChangesRepository } = require('../../src/infrastructure/repositories/pet-age-changes.repository');
const { OnboardingPetUpdateService } = require('../../src/services/onboarding-pets-update.service');
const { MARKETS } = require('../../src/core/market');

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

describeIntegration('pet age through sync and PATCH (MySQL)', () => {
  const database = `it_${Date.now()}_pet_age`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateAuthUserTables1700000000003().up(runner);
    await new CreateUserOwnedOnboardingTables1700000000004().up(runner);
    await new AddPetAgeReference1700000000036().up(runner);
    await new CreatePetLifeStageTracking1700000000037().up(runner);
    await runner.release();
    await dataSource.query(
      "INSERT INTO wp_users (ID, user_login, user_pass, user_nicename, user_email, display_name) VALUES (4243, 'tutor-age', 'x', 'tutor-age', 'tutor-age@example.com', 'Tutor')"
    );
    await dataSource.query(
      `INSERT INTO onboarding_pets (id, user_id, local_id, name, age_years, age_months, weight_unit, age_recorded_at)
       VALUES ('pet-1', 4243, 'local-1', 'Luna', 0, 9, 'kg', '2026-03-01 10:00:00')`
    );
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('sync of an existing pet with another age keeps its age and reference date, and creates a new pet with its age', async () => {
    await new OnboardingPetCreateRepository(dataSource).syncPets(4243, [
      { pet_id: 'pet-1', local_id: 'local-1', name: 'Luna Rename', age_years: 0, age_months: 5, birth_date: '2026-05-01' },
      { pet_id: 'pet-2', local_id: 'local-2', name: 'Thor', age_years: 2, age_months: 0 }
    ]);
    const rows = await dataSource.query('SELECT id, name, age_years, age_months, birth_date, age_recorded_at FROM onboarding_pets ORDER BY id');
    expect(rows[0]).toMatchObject({ id: 'pet-1', name: 'Luna Rename', age_years: 0, age_months: 9, birth_date: null, age_recorded_at: '2026-03-01 10:00:00' });
    expect(rows[1]).toMatchObject({ id: 'pet-2', age_years: 2, age_months: 0 });
    expect(rows[1].age_recorded_at).not.toBeNull();
  });

  test('PATCH of the age moves the reference date and writes one history row', async () => {
    const service = new OnboardingPetUpdateService(new OnboardingPetUpdateRepository(dataSource), {
      ageChangesRepository: new PetAgeChangesRepository(dataSource),
      now: () => new Date('2026-11-02T15:00:00Z')
    });

    await service.updatePet({ userId: 4243, petId: 'pet-1', payload: { age_years: 1, age_months: 0, change_source: 'dashboard' }, market: MARKETS.BR });

    const [pet] = await dataSource.query("SELECT age_years, age_months, age_recorded_at FROM onboarding_pets WHERE id = 'pet-1'");
    expect(pet).toEqual({ age_years: 1, age_months: 0, age_recorded_at: '2026-11-02 15:00:00' });
    const history = await dataSource.query('SELECT pet_id, old_age_years, old_age_months, new_age_years, new_age_months, source FROM pet_age_changes');
    expect(history).toEqual([{ pet_id: 'pet-1', old_age_years: 0, old_age_months: 9, new_age_years: 1, new_age_months: 0, source: 'dashboard' }]);
  });
});
