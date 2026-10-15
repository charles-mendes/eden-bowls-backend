const { DataSource } = require('typeorm');
const { SubscriptionLedgerRepository } = require('../../src/infrastructure/repositories/subscription-ledger.repository');
const { SubscriptionProductionRepository } = require('../../src/infrastructure/repositories/subscription-production.repository');
const { StripeWebhookService } = require('../../src/services/stripe-webhook.service');
const { PaidCyclesService } = require('../../src/services/paid-cycles.service');
const { buildSeedRows } = require('../../src/core/delivery-closed-days');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

// 3.13: renewal is off and the last contracted delivery is charged today at 14:00 in Sao Paulo (17:00 UTC).
// Its invoice.paid sets cancel_at_period_end. That delivery is paid and still has to be prepared and shipped.
describeIntegration('the last contracted delivery stays in the production queue (MySQL, 3.13)', () => {
  const suffix = Date.now();
  const ledgerTable = `it_${suffix}_lastq_stripe_subscriptions`;
  const cycleTable = `it_${suffix}_lastq_production_cycles`;
  const invoicesTable = `it_${suffix}_lastq_charged_invoices`;
  const usermetaTable = `it_${suffix}_lastq_usermeta`;
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

  const CHARGE = Date.UTC(2026, 8, 20, 17, 0, 0) / 1000;
  const NEXT = Date.UTC(2026, 9, 20, 17, 0, 0) / 1000;
  const TODAY = {
    startOfToday: '2026-09-20 03:00:00',
    windowEndExclusive: '2026-09-27 03:00:00',
    overdueFloor: '2026-09-13 03:00:00',
    includeOverdue: true,
    offset: 0,
    perPage: 20
  };
  let repository;

  beforeAll(async () => {
    process.env.EDEN_RUNTIME = 'qa';
    await dataSource.initialize();
    await dataSource.query(`CREATE TABLE \`${ledgerTable}\` LIKE \`stripe_subscriptions\``);
    await dataSource.query(`CREATE TABLE \`${cycleTable}\` LIKE \`subscription_production_cycles\``);
    await dataSource.query(`CREATE TABLE \`${invoicesTable}\` LIKE \`subscription_charged_invoices\``);
    await dataSource.query(`CREATE TABLE \`${usermetaTable}\` (
      umeta_id bigint unsigned NOT NULL AUTO_INCREMENT,
      user_id bigint unsigned NOT NULL,
      meta_key varchar(255) NULL,
      meta_value longtext NULL,
      PRIMARY KEY (umeta_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    repository = new SubscriptionLedgerRepository(dataSource, {
      tableName: ledgerTable,
      usermetaTableName: usermetaTable,
      chargedInvoicesTableName: invoicesTable,
      productionCyclesTableName: cycleTable
    });
    // The webhook must not touch a real onboarding checkout record.
    repository.updateCheckoutReference = async () => ({});
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

  test('the paid last delivery is still in the queue after invoice.paid sets cancel_at_period_end', async () => {
    await dataSource.query(
      `INSERT INTO \`${ledgerTable}\`
        (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status,
         current_period_start, current_period_end, cancel_at_period_end, subscription_term_months,
         charged_deliveries, auto_renew)
       VALUES (7, 'ana@example.com', 'sub_last', 'cus_1', 'br', 'active',
         '2026-08-20 17:00:00', '2026-09-20 17:00:00', 0, 3, 2, 0)`
    );
    const before = await repository.listQueue(TODAY);
    expect(before.items.map((item) => item.stripeSubscriptionId)).toEqual(['sub_last']);

    const stripeBilling = {
      retrieveSubscription: jest.fn().mockResolvedValue({
        id: 'sub_last',
        status: 'active',
        customer: 'cus_1',
        cancel_at_period_end: false,
        current_period_start: CHARGE,
        current_period_end: NEXT,
        metadata: { eden_env: 'qa', wp_user_id: '7' },
        items: { data: [{ price: { id: 'price_1' }, current_period_start: CHARGE, current_period_end: NEXT }] }
      }),
      // Stripe confirms through customer.subscription.updated; the ledger then carries the flag.
      setCancelAtPeriodEnd: jest.fn(async () => {
        await dataSource.query(`UPDATE \`${ledgerTable}\` SET cancel_at_period_end = 1 WHERE stripe_subscription_id = 'sub_last'`);
      })
    };
    // Wired like index.js: the paid cycle enters production on its invoice.paid.
    const webhook = new StripeWebhookService({
      ledgerRepository: repository,
      stripeBilling,
      paidCycles: new PaidCyclesService({
        productionRepository: new SubscriptionProductionRepository(dataSource, { tableName: cycleTable }),
        calendar: { listActive: async () => buildSeedRows() }
      })
    });
    await webhook.handleInvoicePaid({
      id: 'in_last',
      customer: 'cus_1',
      subscription: 'sub_last',
      billing_reason: 'subscription_cycle',
      subtotal: 18990,
      amount_paid: 18990,
      status: 'paid',
      status_transitions: { paid_at: CHARGE + 60 }
    }, { stripeBilling, account: 'br' });

    const row = await repository.findByStripeSubscriptionId('sub_last');
    expect(row.chargedDeliveries).toBe(3);
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(stripeBilling.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_last', true);

    const after = await repository.listQueue(TODAY);
    const item = after.items.find((entry) => entry.stripeSubscriptionId === 'sub_last');
    expect(item).toBeTruthy();
    expect(new Date(item.cyclePeriodEnd).toISOString()).toBe('2026-09-20T17:00:00.000Z');
    expect(item.paymentState).toBe('paid');
    // Charged Sunday 20 September at 14:00: Monday 21 is the first valid preparation day in Brazil.
    expect(item.preparationDay).toBe('2026-09-21');
    // No renewal follows the last contracted delivery, so only the paid cycle is listed.
    expect(after.items.filter((entry) => entry.stripeSubscriptionId === 'sub_last')).toHaveLength(1);
  });

  test('the paid cycle leaves the queue once it is marked ready and its day has passed', async () => {
    const later = await repository.listQueue({ ...TODAY, startOfToday: '2026-09-23 03:00:00', windowEndExclusive: '2026-09-30 03:00:00', overdueFloor: '2026-09-16 03:00:00' });
    expect(later.items.map((entry) => entry.stripeSubscriptionId)).toEqual(['sub_last']);
    await dataSource.query(`UPDATE \`${cycleTable}\` SET status = 'ready'`);
    const done = await repository.listQueue({ ...TODAY, startOfToday: '2026-09-23 03:00:00', windowEndExclusive: '2026-09-30 03:00:00', overdueFloor: '2026-09-16 03:00:00' });
    expect(done.items).toHaveLength(0);
  });

  test('a repeated payment keeps the first one, and the open paid cycle lasts through its delivery day', async () => {
    const production = new SubscriptionProductionRepository(dataSource, { tableName: cycleTable });
    const [row] = await dataSource.query(`SELECT id FROM \`${ledgerTable}\` WHERE stripe_subscription_id = 'sub_last'`);
    const first = await production.findBySubscriptionAndPeriodEnd(row.id, new Date(CHARGE * 1000));
    const again = await production.markPaid({
      subscriptionId: row.id,
      periodEnd: new Date(CHARGE * 1000),
      paidAt: new Date((CHARGE + 86400) * 1000),
      invoiceId: 'in_replayed',
      preparationDay: '2026-09-22',
      deliveryDate: '2026-09-22'
    });
    expect(new Date(again.paidAt).toISOString()).toBe(new Date(first.paidAt).toISOString());
    expect(again.paidInvoiceId).toBe('in_last');
    expect(again.preparationDay).toBe('2026-09-21');
    expect(again.status).toBe('ready');

    expect((await production.findOpenPaidCycle(row.id, '2026-09-21')).deliveryDate).toBe('2026-09-21');
    expect(await production.findOpenPaidCycle(row.id, '2026-09-22')).toBeNull();
  });
});
