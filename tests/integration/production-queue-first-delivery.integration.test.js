const { DataSource } = require('typeorm');
const { SubscriptionLedgerRepository } = require('../../src/infrastructure/repositories/subscription-ledger.repository');
const { SubscriptionProductionRepository } = require('../../src/infrastructure/repositories/subscription-production.repository');
const { SubscriptionDeliveriesRepository } = require('../../src/infrastructure/repositories/subscription-deliveries.repository');
const { StripeWebhookService } = require('../../src/services/stripe-webhook.service');
const { PaidCyclesService } = require('../../src/services/paid-cycles.service');
const { buildSeedRows, wallTimeToUtc, TIMEZONE_BR } = require('../../src/core/delivery-closed-days');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

// The first delivery is produced from the queue: the invoice.paid of subscription_create records a paid cycle.
// The operations email stays a notice. Checkout is paid on Wednesday 7 October 2026 at 15:00 in Sao Paulo,
// after Wednesday's midnight, so preparation and delivery are Thursday 8 October.
describeIntegration('the first delivery enters the production queue (MySQL, 3.12)', () => {
  const suffix = Date.now();
  const ledgerTable = `it_${suffix}_first_stripe_subscriptions`;
  const cycleTable = `it_${suffix}_first_production_cycles`;
  const invoicesTable = `it_${suffix}_first_charged_invoices`;
  const usermetaTable = `it_${suffix}_first_usermeta`;
  const previousRuntime = process.env.EDEN_RUNTIME;

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

  const PAID = wallTimeToUtc(2026, 10, 7, 15, 0, 0, TIMEZONE_BR);
  const START = Math.floor(PAID.getTime() / 1000) - 30;
  const NEXT = Math.floor(wallTimeToUtc(2026, 11, 7, 15, 0, 0, TIMEZONE_BR).getTime() / 1000);
  let ledger;
  let production;

  beforeAll(async () => {
    process.env.EDEN_RUNTIME = 'qa';
    await dataSource.initialize();
    await dataSource.query(`CREATE TABLE \`${ledgerTable}\` LIKE \`stripe_subscriptions\``);
    await dataSource.query(`CREATE TABLE \`${cycleTable}\` LIKE \`subscription_production_cycles\``);
    await dataSource.query(`CREATE TABLE \`${invoicesTable}\` LIKE \`subscription_charged_invoices\``);
    await dataSource.query(`CREATE TABLE \`${usermetaTable}\` (
      umeta_id bigint unsigned NOT NULL AUTO_INCREMENT, user_id bigint unsigned NOT NULL,
      meta_key varchar(255) NULL, meta_value longtext NULL, PRIMARY KEY (umeta_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    ledger = new SubscriptionLedgerRepository(dataSource, {
      tableName: ledgerTable,
      usermetaTableName: usermetaTable,
      chargedInvoicesTableName: invoicesTable,
      productionCyclesTableName: cycleTable
    });
    ledger.updateCheckoutReference = async () => ({});
    production = new SubscriptionProductionRepository(dataSource, { tableName: cycleTable });
  });

  afterAll(async () => {
    if (previousRuntime === undefined) delete process.env.EDEN_RUNTIME;
    else process.env.EDEN_RUNTIME = previousRuntime;
    if (dataSource.isInitialized) {
      for (const table of [cycleTable, invoicesTable, ledgerTable, usermetaTable]) {
        await dataSource.query(`DROP TABLE IF EXISTS \`${table}\``);
      }
      await dataSource.destroy();
    }
  });

  test('the subscription_create invoice.paid puts the first delivery in the queue, and the notice still goes out', async () => {
    // Checkout writes the ledger in the request, before the webhook: the next period already ends a month out.
    await dataSource.query(
      `INSERT INTO \`${ledgerTable}\`
        (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status,
         current_period_start, current_period_end, cancel_at_period_end, subscription_term_months, address, shipping)
       VALUES (7, 'ana@example.com', 'sub_first', 'cus_1', 'br', 'active', FROM_UNIXTIME(?), FROM_UNIXTIME(?), 0, 3, ?, ?)`,
      [START, NEXT, JSON.stringify({ country: 'BR' }), JSON.stringify({ distance: 10 })]
    );
    const stripeBilling = {
      retrieveSubscription: jest.fn().mockResolvedValue({
        id: 'sub_first',
        status: 'active',
        customer: 'cus_1',
        cancel_at_period_end: false,
        current_period_start: START,
        current_period_end: NEXT,
        metadata: { eden_env: 'qa', wp_user_id: '7' },
        items: { data: [{ price: { id: 'price_1' }, current_period_start: START, current_period_end: NEXT }] }
      }),
      listPaidInvoicesForSubscription: jest.fn().mockResolvedValue([])
    };
    const transactionalMailer = {
      notifyOrderConfirmed: jest.fn().mockResolvedValue({}),
      notifyAdminNewSubscription: jest.fn().mockResolvedValue({})
    };
    const webhook = new StripeWebhookService({
      ledgerRepository: ledger,
      stripeBilling,
      transactionalMailer,
      paidCycles: new PaidCyclesService({
        productionRepository: production,
        calendar: { listActive: async () => buildSeedRows() }
      })
    });
    await webhook.handleInvoicePaid({
      id: 'in_first',
      customer: 'cus_1',
      subscription: 'sub_first',
      billing_reason: 'subscription_create',
      subtotal: 18990,
      amount_paid: 18990,
      status: 'paid',
      status_transitions: { paid_at: Math.floor(PAID.getTime() / 1000) }
    }, { stripeBilling, account: 'br' });

    expect(transactionalMailer.notifyAdminNewSubscription).toHaveBeenCalledTimes(1);
    expect((await ledger.findByStripeSubscriptionId('sub_first')).chargedDeliveries).toBe(1);

    const queue = await ledger.listQueue({
      startOfToday: '2026-10-07 03:00:00',
      windowEndExclusive: '2026-10-14 03:00:00',
      overdueFloor: '2026-09-30 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 20
    });
    const first = queue.items.filter((item) => item.stripeSubscriptionId === 'sub_first');
    // Only the paid first delivery: the next renewal is a month out, outside the window.
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ paymentState: 'paid', productionStatus: 'to_prepare', preparationDay: '2026-10-08', deliveryDate: '2026-10-08' });
    expect(new Date(first[0].cyclePeriodEnd).getTime()).toBe(START * 1000);

    // Meu Plano reads the same cycle, so the customer sees the date the queue works to.
    const deliveries = new SubscriptionDeliveriesRepository({
      ledgerRepository: ledger,
      productionRepository: production,
      now: () => PAID
    });
    const subscription = await deliveries.findForUser('sub_first', 7);
    expect(subscription.paidCycle).toMatchObject({ preparationDay: '2026-10-08', deliveryDate: '2026-10-08' });
  });
});
