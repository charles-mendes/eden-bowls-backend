const { DataSource } = require('typeorm');
const { parseEnv } = require('../../src/config/env');
const { createShippingQuoteServices } = require('../../src/config/shipping-quote-services');
const { createAdminProductionService } = require('../../src/config/production-services');
const { SubscriptionLedgerRepository } = require('../../src/infrastructure/repositories/subscription-ledger.repository');
const { SubscriptionProductionRepository } = require('../../src/infrastructure/repositories/subscription-production.repository');
const { buildSeedRows, wallTimeToUtc, TIMEZONE_BR, TIMEZONE_US } = require('../../src/core/delivery-closed-days');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

// 1.5 wired as in index.js: blocking an unpaid cycle before preparation moves trial_end in Stripe to 00:00 of
// the next valid preparation day of the following delivery, and returning it restores the original day.
describeIntegration('production block moves trial_end, wired like index.js (MySQL, 1.5)', () => {
  const suffix = Date.now();
  const ledgerTable = `it_${suffix}_block_stripe_subscriptions`;
  const cycleTable = `it_${suffix}_block_production_cycles`;
  const usermetaTable = `it_${suffix}_block_usermeta`;

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

  const unix = (date) => Math.floor(date.getTime() / 1000);
  let ledger;
  let production;
  let admin;
  let stripe;

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.query(`CREATE TABLE \`${ledgerTable}\` LIKE \`stripe_subscriptions\``);
    await dataSource.query(`CREATE TABLE \`${cycleTable}\` LIKE \`subscription_production_cycles\``);
    await dataSource.query(`CREATE TABLE \`${usermetaTable}\` (
      umeta_id bigint unsigned NOT NULL AUTO_INCREMENT, user_id bigint unsigned NOT NULL,
      meta_key varchar(255) NULL, meta_value longtext NULL, PRIMARY KEY (umeta_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    ledger = new SubscriptionLedgerRepository(dataSource, {
      tableName: ledgerTable,
      usermetaTableName: usermetaTable,
      productionCyclesTableName: cycleTable
    });
    production = new SubscriptionProductionRepository(dataSource, { tableName: cycleTable });
    // Stripe answers a trial_end update like the API does: the subscription trials until that moment.
    stripe = {
      setTrialEnd: jest.fn(async ({ subscriptionId, trial_end }) => ({
        id: subscriptionId,
        status: 'trialing',
        trial_end,
        current_period_start: unix(new Date()),
        current_period_end: trial_end
      }))
    };
    const { customerDeliveriesService } = createShippingQuoteServices({
      env: parseEnv({ NODE_ENV: 'development', EDEN_RUNTIME: 'local', SHIPPING_QUOTE_SECRET: 'wiring-secret' }),
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
      shippingSettings: { us: { enabled: true, quote_mode: 'fixed', cost: 12.9 }, br: { enabled: false, rule: {} } },
      deliveryCalendar: { listActive: async () => buildSeedRows() },
      stripeAccounts: { get: () => stripe },
      ledgerRepository: ledger,
      productionRepository: production
    });
    admin = createAdminProductionService({
      ledgerRepository: ledger,
      productionRepository: production,
      customerDeliveriesService
    });
  });

  afterAll(async () => {
    if (dataSource.isInitialized) {
      for (const table of [cycleTable, ledgerTable, usermetaTable]) {
        await dataSource.query(`DROP TABLE IF EXISTS \`${table}\``);
      }
      await dataSource.destroy();
    }
  });

  async function subscription(subscriptionId, account, chargeAt, address) {
    await dataSource.query(
      `INSERT INTO \`${ledgerTable}\`
        (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status,
         current_period_start, current_period_end, cancel_at_period_end, subscription_term_months, address)
       VALUES (7, 'ana@example.com', ?, 'cus_1', ?, 'active', ?, ?, 0, 3, ?)`,
      [subscriptionId, account, new Date(chargeAt.getTime() - 30 * 86400000), chargeAt, JSON.stringify(address)]
    );
    const [row] = await dataSource.query(`SELECT id FROM \`${ledgerTable}\` WHERE stripe_subscription_id = ?`, [subscriptionId]);
    return row.id;
  }

  test('Brazil: a block before preparation moves trial_end to the following preparation day, and a return restores it', async () => {
    // Current charge Saturday 5 December 2026 at 14:00 (prepared Monday 7). The following charge is Tuesday
    // 5 January 2027 at 14:00, so its first valid preparation day is Wednesday 6 January.
    const chargeAt = wallTimeToUtc(2026, 12, 5, 14, 0, 0, TIMEZONE_BR);
    const id = await subscription('sub_block_br', 'br', chargeAt, { country: 'BR' });

    const blocked = await admin.updateStatus(id, { status: 'blocked', note: 'Falta peru', periodEnd: chargeAt.toISOString() }, { userId: 1 });
    const blockedTrialEnd = unix(wallTimeToUtc(2027, 1, 6, 0, 0, 0, TIMEZONE_BR));
    expect(stripe.setTrialEnd).toHaveBeenLastCalledWith({ subscriptionId: 'sub_block_br', trial_end: blockedTrialEnd, proration_behavior: 'none' });
    expect(blocked.productionStatus).toBe('blocked');

    // The ledger and the cycle follow the moved charge, so the queue still shows the block.
    const row = await ledger.findByStripeSubscriptionId('sub_block_br');
    expect(new Date(row.currentPeriodEnd).getTime()).toBe(blockedTrialEnd * 1000);
    const cycle = await production.findBySubscriptionAndPeriodEnd(id, new Date(blockedTrialEnd * 1000));
    expect(cycle).toMatchObject({ status: 'blocked', preparationDay: '2026-12-07' });
    expect(await production.findBySubscriptionAndPeriodEnd(id, chargeAt)).toBeNull();

    // The operator returns it from the queue, with the key the queue now shows.
    await admin.updateStatus(id, { status: 'to_prepare', periodEnd: new Date(blockedTrialEnd * 1000).toISOString() }, { userId: 1 });
    const restored = unix(wallTimeToUtc(2026, 12, 7, 0, 0, 0, TIMEZONE_BR));
    expect(stripe.setTrialEnd).toHaveBeenLastCalledWith({ subscriptionId: 'sub_block_br', trial_end: restored, proration_behavior: 'none' });
    expect(await production.findBySubscriptionAndPeriodEnd(id, new Date(restored * 1000))).toMatchObject({ status: 'to_prepare', preparationDay: null });
  });

  test('United States: a block whose following preparation would be a Thursday moves to the next valid Monday', async () => {
    // Current charge Monday 14 December 2026 at 00:00. The following charge, Thursday 14 January 2027, cannot ship
    // with 1 transit day (Thursday delivers Saturday, Friday picks up Saturday), so Monday 18 January.
    const chargeAt = wallTimeToUtc(2026, 12, 14, 0, 0, 0, TIMEZONE_US);
    const id = await subscription('sub_block_us', 'us', chargeAt, { country: 'US', business_days_in_transit: 1 });

    await admin.updateStatus(id, { status: 'blocked', note: 'Sem caixa', periodEnd: chargeAt.toISOString() }, { userId: 1 });
    expect(stripe.setTrialEnd).toHaveBeenLastCalledWith({
      subscriptionId: 'sub_block_us',
      trial_end: unix(wallTimeToUtc(2027, 1, 18, 0, 0, 0, TIMEZONE_US)),
      proration_behavior: 'none'
    });
  });
});
