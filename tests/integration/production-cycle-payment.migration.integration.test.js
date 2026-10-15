const { DataSource } = require('typeorm');
const { CreateSubscriptionProductionCycles1700000000018 } = require('../../src/infrastructure/migrations/1700000000018-create-subscription-production-cycles');
const { AddProductionCyclePayment1700000000025 } = require('../../src/infrastructure/migrations/1700000000025-add-production-cycle-payment');
const { SubscriptionProductionRepository } = require('../../src/infrastructure/repositories/subscription-production.repository');

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

const NEW_COLUMNS = ['paid_at', 'paid_invoice_id', 'preparation_day', 'delivery_date'];

// Migration 025 on a database shaped like production before it: the ledger as it is today and the production
// cycles table created by migration 018, holding active, trialing, past_due, and canceled subscriptions with
// cycles in every production status.
describeIntegration('migration 1700000000025 adds the cycle payment columns (MySQL, 3.12)', () => {
  const database = `it_${Date.now()}_mig025`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;

  async function columns() {
    const rows = await dataSource.query('SHOW COLUMNS FROM `subscription_production_cycles`');
    return Object.fromEntries(rows.map((row) => [row.Field, row]));
  }

  async function cycles() {
    return dataSource.query(
      'SELECT id, subscription_id, period_end, status, note, updated_by_user_id FROM `subscription_production_cycles` ORDER BY id'
    );
  }

  beforeAll(async () => {
    await admin.initialize();
    const source = process.env.INTEGRATION_DB_NAME || 'eden_bowls';
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    await admin.query(`CREATE TABLE \`${database}\`.\`stripe_subscriptions\` LIKE \`${source}\`.\`stripe_subscriptions\``);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new CreateSubscriptionProductionCycles1700000000018().up(runner);

    await dataSource.query(
      `INSERT INTO stripe_subscriptions
        (id, user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status,
         current_period_start, current_period_end, cancel_at_period_end, subscription_term_months)
       VALUES
        (1, 7, 'ana@example.com', 'sub_active', 'cus_1', 'br', 'active', '2026-09-03 17:00:00', '2026-10-03 17:00:00', 0, 3),
        (2, 8, 'bia@example.com', 'sub_trial', 'cus_2', 'br', 'trialing', '2026-09-20 12:00:00', '2026-10-21 03:00:00', 0, 6),
        (3, 9, 'cris@example.com', 'sub_late', 'cus_3', 'us', 'past_due', '2026-09-28 04:00:00', '2026-10-28 04:00:00', 0, 1),
        (4, 10, 'dani@example.com', 'sub_gone', 'cus_4', 'us', 'canceled', '2026-08-01 04:00:00', '2026-09-01 04:00:00', 1, 3)`
    );
    // Cycles as the queue stored them before this change: one row per status update, keyed by the period end.
    await dataSource.query(
      `INSERT INTO subscription_production_cycles (subscription_id, period_end, status, note, updated_by_user_id)
       VALUES
        (1, '2026-09-03 17:00:00', 'ready', NULL, 1),
        (1, '2026-10-03 17:00:00', 'in_production', NULL, 1),
        (2, '2026-10-21 03:00:00', 'blocked', 'Falta peru', 2),
        (3, '2026-09-28 04:00:00', 'to_prepare', NULL, NULL),
        (4, '2026-09-01 04:00:00', 'ready', 'Entregue', 1)`
    );
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('up adds four nullable columns and leaves every existing cycle as it was, unpaid', async () => {
    const before = await cycles();
    await new AddProductionCyclePayment1700000000025().up(runner);

    const after = await columns();
    expect(after.paid_at).toMatchObject({ Type: 'datetime', Null: 'YES', Default: null });
    expect(after.paid_invoice_id).toMatchObject({ Type: 'varchar(64)', Null: 'YES', Default: null });
    expect(after.preparation_day).toMatchObject({ Type: 'date', Null: 'YES', Default: null });
    expect(after.delivery_date).toMatchObject({ Type: 'date', Null: 'YES', Default: null });
    expect(await cycles()).toEqual(before);
    const added = await dataSource.query(`SELECT ${NEW_COLUMNS.join(', ')} FROM subscription_production_cycles`);
    expect(added).toHaveLength(5);
    for (const row of added) {
      expect(Object.values(row).every((value) => value === null)).toBe(true);
    }
  });

  test('a second up adds nothing, duplicates nothing, and keeps payments recorded after the first', async () => {
    const production = new SubscriptionProductionRepository(dataSource);
    await production.markPaid({
      subscriptionId: 1,
      periodEnd: '2026-10-03 17:00:00',
      paidAt: '2026-10-03 17:01:00',
      invoiceId: 'in_paid',
      preparationDay: '2026-10-05',
      deliveryDate: '2026-10-05'
    });
    const columnCount = Object.keys(await columns()).length;
    const before = await dataSource.query('SELECT * FROM subscription_production_cycles ORDER BY id');

    await new AddProductionCyclePayment1700000000025().up(runner);

    expect(Object.keys(await columns())).toHaveLength(columnCount);
    expect(await dataSource.query('SELECT * FROM subscription_production_cycles ORDER BY id')).toEqual(before);
    const paid = await production.findBySubscriptionAndPeriodEnd(1, '2026-10-03 17:00:00');
    expect(paid).toMatchObject({ status: 'in_production', paidInvoiceId: 'in_paid', preparationDay: '2026-10-05' });
    // Cycles of the other subscriptions stay unpaid.
    const unpaid = await dataSource.query('SELECT COUNT(*) AS total FROM subscription_production_cycles WHERE paid_at IS NULL');
    expect(Number(unpaid[0].total)).toBe(4);
  });

  test('down drops only the four columns; the cycles stay, and only the recorded payments are lost', async () => {
    const before = await cycles();
    await new AddProductionCyclePayment1700000000025().down(runner);
    const after = await columns();
    for (const name of NEW_COLUMNS) expect(after[name]).toBeUndefined();
    expect(await cycles()).toEqual(before);

    // Running up again restores the columns, empty.
    await new AddProductionCyclePayment1700000000025().up(runner);
    const reapplied = await dataSource.query('SELECT COUNT(*) AS total FROM subscription_production_cycles WHERE paid_at IS NOT NULL');
    expect(Number(reapplied[0].total)).toBe(0);
    expect(await cycles()).toEqual(before);
  });
});
