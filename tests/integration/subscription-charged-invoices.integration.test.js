const { DataSource } = require('typeorm');
const { SubscriptionLedgerRepository } = require('../../src/infrastructure/repositories/subscription-ledger.repository');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('charged deliveries counted from subscription_charged_invoices (MySQL, 3.10)', () => {
  const suffix = Date.now();
  const ledgerTable = `it_${suffix}_charged_stripe_subscriptions`;
  const invoicesTable = `it_${suffix}_subscription_charged_invoices`;

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
    logging: false,
    extra: { connectionLimit: 10 }
  });

  let repository;

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.query(`CREATE TABLE \`${ledgerTable}\` (
      id int unsigned NOT NULL AUTO_INCREMENT,
      user_id bigint unsigned NOT NULL,
      stripe_subscription_id varchar(64) NOT NULL,
      stripe_customer_id varchar(64) NOT NULL,
      stripe_account varchar(8) NOT NULL DEFAULT 'us',
      status varchar(32) NOT NULL,
      cancel_at_period_end tinyint(1) NOT NULL DEFAULT 0,
      edit_payment_pending tinyint(1) NOT NULL DEFAULT 0,
      charged_deliveries int unsigned NULL,
      last_charged_invoice_id varchar(64) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_sub (stripe_subscription_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Same shape as migration 1700000000024.
    await dataSource.query(`CREATE TABLE \`${invoicesTable}\` (
      id int unsigned NOT NULL AUTO_INCREMENT,
      stripe_subscription_id varchar(64) NOT NULL,
      invoice_id varchar(64) NOT NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_subscription_charged_invoice (stripe_subscription_id, invoice_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    repository = new SubscriptionLedgerRepository(dataSource, {
      tableName: ledgerTable,
      chargedInvoicesTableName: invoicesTable
    });
  });

  afterAll(async () => {
    if (dataSource.isInitialized) {
      await dataSource.query(`DROP TABLE IF EXISTS \`${invoicesTable}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${ledgerTable}\``);
      await dataSource.destroy();
    }
  });

  async function ledgerRow(subscriptionId, chargedDeliveries) {
    await dataSource.query(
      `INSERT INTO \`${ledgerTable}\` (user_id, stripe_subscription_id, stripe_customer_id, status, charged_deliveries)
        VALUES (7, ?, 'cus_1', 'active', ?)`,
      [subscriptionId, chargedDeliveries]
    );
  }

  test('two simultaneous events for one invoice count once', async () => {
    await ledgerRow('sub_race', 1);
    await Promise.all([
      repository.incrementChargedDeliveries('sub_race', 'in_2'),
      repository.incrementChargedDeliveries('sub_race', 'in_2')
    ]);
    expect((await repository.findByStripeSubscriptionId('sub_race')).chargedDeliveries).toBe(2);

    await Promise.all(Array.from({ length: 5 }, () => repository.incrementChargedDeliveries('sub_race', 'in_3')));
    expect((await repository.findByStripeSubscriptionId('sub_race')).chargedDeliveries).toBe(3);
  });

  test('a late repeat of an older invoice does not count', async () => {
    await ledgerRow('sub_late', 0);
    await repository.incrementChargedDeliveries('sub_late', 'in_1');
    await repository.incrementChargedDeliveries('sub_late', 'in_2');
    await repository.incrementChargedDeliveries('sub_late', 'in_1');
    const row = await repository.findByStripeSubscriptionId('sub_late');
    expect(row.chargedDeliveries).toBe(2);
    expect(row.lastChargedInvoiceId).toBe('in_2');
  });

  test('the first count seeds from the earlier invoices, then the current one counts once even when raced', async () => {
    await ledgerRow('sub_seed', null);
    await Promise.all([1, 2].map(async () => {
      await repository.seedChargedDeliveries('sub_seed', ['in_1', 'in_2']);
      await repository.incrementChargedDeliveries('sub_seed', 'in_3');
    }));
    expect((await repository.findByStripeSubscriptionId('sub_seed')).chargedDeliveries).toBe(3);
    const recorded = await dataSource.query(`SELECT invoice_id FROM \`${invoicesTable}\` WHERE stripe_subscription_id = 'sub_seed' ORDER BY invoice_id`);
    expect(recorded.map((item) => item.invoice_id)).toEqual(['in_1', 'in_2', 'in_3']);
  });
});
