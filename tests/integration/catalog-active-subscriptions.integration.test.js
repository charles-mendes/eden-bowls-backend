const { DataSource } = require('typeorm');
const { CreateStripeSubscriptionLedgerTables1700000000009 } = require('../../src/infrastructure/migrations/1700000000009-create-stripe-subscription-ledger-tables');
const { SubscriptionLedgerRepository } = require('../../src/infrastructure/repositories/subscription-ledger.repository');

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

function selection(lineItems) {
  return JSON.stringify({ catalog_pricing: { line_items: lineItems } });
}

// The deactivation guard counts subscriptions still delivering that use a variation.
describeIntegration('SubscriptionLedgerRepository.countActiveSubscriptionsForCatalog (MySQL)', () => {
  const database = `it_${Date.now()}_catalog_active`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let repository;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateStripeSubscriptionLedgerTables1700000000009().up(runner);
    await runner.release();
    repository = new SubscriptionLedgerRepository(dataSource);

    const rows = [
      ['sub_active', 'active', null, selection([{ variation_id: 1001, stripe_price_id: 'price_beef_300' }, { variation_id: 1003 }])],
      ['sub_trialing', 'trialing', null, selection([{ variation_id: '1001' }])],
      ['sub_past_due', 'past_due', 'price_beef_300', null],
      ['sub_cancelled', 'canceled', null, selection([{ variation_id: 1001 }, { variation_id: 1002 }])],
      ['sub_other', 'active', null, selection([{ variation_id: 1004 }])]
    ];
    for (const [id, status, price, plan] of rows) {
      await dataSource.query(
        'INSERT INTO stripe_subscriptions (user_id, stripe_subscription_id, stripe_customer_id, status, stripe_price_id, plan_selection) VALUES (1, ?, ?, ?, ?, ?)',
        [id, `cus_${id}`, status, price, plan]
      );
    }
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('counts active, trialing and past_due subscriptions once each, by variation or price', async () => {
    await expect(repository.countActiveSubscriptionsForCatalog({ variationIds: ['1001'], priceIds: ['price_beef_300'] })).resolves.toBe(3);
  });

  test('ignores cancelled subscriptions', async () => {
    await expect(repository.countActiveSubscriptionsForCatalog({ variationIds: ['1002'] })).resolves.toBe(0);
  });

  test('a variation used by one active subscription counts one', async () => {
    await expect(repository.countActiveSubscriptionsForCatalog({ variationIds: ['1003'] })).resolves.toBe(1);
  });

  test('nothing to look up counts zero', async () => {
    await expect(repository.countActiveSubscriptionsForCatalog({ variationIds: [], priceIds: ['not_a_price'] })).resolves.toBe(0);
  });
});
