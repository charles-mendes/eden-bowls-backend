const { DataSource } = require('typeorm');
const { CreateDeliveryClosedDays1700000000021 } = require('../../src/infrastructure/migrations/1700000000021-create-delivery-closed-days');
const { SeedUs2027DeliveryClosedDays1700000000026 } = require('../../src/infrastructure/migrations/1700000000026-seed-us-2027-delivery-closed-days');
const { AddDeliveryClosedDayType1700000000027 } = require('../../src/infrastructure/migrations/1700000000027-add-delivery-closed-day-type');

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

const EXPECTED_TYPE = { fixed: 'national', movable: 'national', ups: 'carrier', regional: 'regional', one_off: 'adhoc' };

function insert(dataSource, market, closedOn, origin, type) {
  const columns = type ? ', type' : '';
  const values = type ? ', ?' : '';
  return dataSource.query(
    `INSERT INTO delivery_closed_days
      (market, closed_on, label, origin, active, closes_preparation, closes_pickup, closes_delivery${columns})
     VALUES (?, ?, 'Teste', ?, 1, 1, 1, 1${values})`,
    type ? [market, closedOn, origin, type] : [market, closedOn, origin]
  );
}

// Migration 027 on the calendar as migrations 021 and 026 leave it, plus a regional and a one-off row.
describeIntegration('migration 1700000000027 splits closed days by type (MySQL)', () => {
  const database = `it_${Date.now()}_mig027`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new CreateDeliveryClosedDays1700000000021().up(runner);
    await new SeedUs2027DeliveryClosedDays1700000000026().up(runner);
    await insert(dataSource, 'BR', '2027-03-29', 'regional');
    await insert(dataSource, 'US', '2027-08-10', 'one_off');
    await new AddDeliveryClosedDayType1700000000027().up(runner);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('every row gets the type of its origin', async () => {
    const rows = await dataSource.query('SELECT origin, type, COUNT(*) AS total FROM delivery_closed_days GROUP BY origin, type');
    expect(rows.length).toBe(Object.keys(EXPECTED_TYPE).length);
    for (const row of rows) {
      expect(row.type).toBe(EXPECTED_TYPE[row.origin]);
    }
    const ups = await dataSource.query(
      "SELECT DATE_FORMAT(closed_on, '%Y-%m-%d') AS closedOn FROM delivery_closed_days WHERE market = 'US' AND type = 'carrier'"
    );
    const dates = ups.map((row) => row.closedOn);
    expect(dates).toEqual(expect.arrayContaining(['2026-12-24', '2027-01-01', '2027-07-05', '2027-12-31', '2028-01-01']));
  });

  test('a date holds one row of each type and refuses a second row of the same type', async () => {
    await insert(dataSource, 'US', '2028-01-01', 'one_off', 'adhoc');
    const january = await dataSource.query(
      "SELECT type FROM delivery_closed_days WHERE market = 'US' AND closed_on = '2028-01-01' ORDER BY type"
    );
    expect(january.map((row) => row.type)).toEqual(['adhoc', 'carrier']);

    await expect(insert(dataSource, 'US', '2028-01-01', 'one_off', 'adhoc')).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: 'ER_DUP_ENTRY' })
    });
  });

  test('down refuses while a date holds two types', async () => {
    await expect(new AddDeliveryClosedDayType1700000000027().down(runner)).rejects.toThrow(/more than one type/);
    const columns = await dataSource.query('SHOW COLUMNS FROM delivery_closed_days');
    expect(columns.some((column) => column.Field === 'type')).toBe(true);
  });
});
