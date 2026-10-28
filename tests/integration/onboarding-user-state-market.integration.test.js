const { DataSource } = require('typeorm');
const { OnboardingZipcodeRepository } = require('../../src/infrastructure/repositories/onboarding-zipcode.repository');
const { OnboardingRecurrenceRepository } = require('../../src/infrastructure/repositories/onboarding-recurrence.repository');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('onboarding user state market (MySQL)', () => {
  const table = `it_${Date.now()}_onboarding_user_state`;
  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.INTEGRATION_DB_HOST || '127.0.0.1',
    port: Number(process.env.INTEGRATION_DB_PORT || 3310),
    username: process.env.INTEGRATION_DB_USER || 'root',
    password: process.env.INTEGRATION_DB_PASSWORD || 'root',
    database: process.env.INTEGRATION_DB_NAME || 'eden_bowls',
    charset: 'utf8mb4',
    timezone: 'Z',
    entities: [],
    migrations: [],
    synchronize: false,
    logging: false
  });

  const marketOf = async (userId) => {
    const [row] = await dataSource.query(`SELECT market FROM \`${table}\` WHERE user_id = ?`, [userId]);
    return row.market;
  };

  beforeAll(async () => {
    await dataSource.initialize();
    // LIKE copies the columns without the foreign key to the users table.
    await dataSource.query(`CREATE TABLE \`${table}\` LIKE \`onboarding_user_state\``);
  });

  afterAll(async () => {
    if (dataSource.isInitialized) {
      await dataSource.query(`DROP TABLE IF EXISTS \`${table}\``);
      await dataSource.destroy();
    }
  });

  test('a row created by another step gets its market from the first address and keeps it', async () => {
    await new OnboardingRecurrenceRepository(dataSource, { tableName: table }).setRecurrence(9001, { frequency: 'monthly', periodDays: 30 });
    expect(await marketOf(9001)).toBeNull();

    const zipcode = new OnboardingZipcodeRepository(dataSource, { tableName: table });
    await zipcode.saveZipcode(9001, { zipcode: '01310100', country: 'BR' });
    expect(await marketOf(9001)).toBe('BR');

    await zipcode.saveZipcode(9001, { zipcode: '94105', country: 'US' });
    expect(await marketOf(9001)).toBe('BR');
  });
});
