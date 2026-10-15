const { DataSource } = require('typeorm');
const { CreateDeliveryCalendarStripeSyncs1700000000028 } = require('../../src/infrastructure/migrations/1700000000028-create-delivery-calendar-stripe-syncs');

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

describeIntegration('migration 1700000000028 creates the Stripe sync outbox (MySQL)', () => {
  const database = `it_${Date.now()}_mig028`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('up creates the table and indexes; a second up and down behave', async () => {
    await new CreateDeliveryCalendarStripeSyncs1700000000028().up(runner);
    await new CreateDeliveryCalendarStripeSyncs1700000000028().up(runner);
    const indexes = await dataSource.query('SHOW INDEX FROM delivery_calendar_stripe_syncs');
    const byName = {};
    for (const row of indexes) {
      byName[row.Key_name] = byName[row.Key_name] || [];
      byName[row.Key_name][row.Seq_in_index - 1] = row.Column_name;
    }
    expect(byName.idx_delivery_calendar_syncs_status_due).toEqual(['status', 'next_attempt_at']);
    expect(byName.idx_delivery_calendar_syncs_subscription).toEqual(['stripe_subscription_id', 'status']);

    await dataSource.query(
      "INSERT INTO delivery_calendar_stripe_syncs (stripe_subscription_id, market, target_trial_end) VALUES ('sub_1', 'US', '2027-12-27 05:00:00')"
    );
    const [row] = await dataSource.query('SELECT status, attempts FROM delivery_calendar_stripe_syncs');
    expect(row).toMatchObject({ status: 'pending', attempts: 0 });

    await new CreateDeliveryCalendarStripeSyncs1700000000028().down(runner);
    const tables = await dataSource.query("SHOW TABLES LIKE 'delivery_calendar_stripe_syncs'");
    expect(tables).toHaveLength(0);
  });
});
