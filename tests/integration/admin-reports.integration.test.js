const { DataSource } = require('typeorm');
const { AdminReportsRepository } = require('../../src/infrastructure/repositories/admin-reports.repository');
const { AdminReportsService } = require('../../src/services/admin-reports.service');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('admin reports (MySQL)', () => {
  const suffix = Date.now();
  const tables = {
    ledger: `it_${suffix}_rep_stripe_subscriptions`,
    invoices: `it_${suffix}_rep_customer_invoices`,
    onboarding: `it_${suffix}_rep_onboarding_user_state`,
    cycles: `it_${suffix}_rep_production_cycles`,
    shipments: `it_${suffix}_rep_ups_shipments`,
    items: `it_${suffix}_rep_pack_stock_items`,
    movements: `it_${suffix}_rep_pack_stock_movements`
  };

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

  // 2026-10-28 15:00 in Sao Paulo; the default window is 2026-09-28..2026-10-27 local (03:00 UTC bounds).
  const now = new Date('2026-10-28T18:00:00Z');
  let service;

  async function subscription(values) {
    const row = {
      user_id: 7, customer_email: 'ana@example.com', stripe_customer_id: 'cus_1', stripe_account: 'br',
      status: 'active', cancel_at_period_end: 0, plan_selection: null, current_period_start: null, current_period_end: null,
      activated_at: null, canceled_at: null, activated_at_approximate: 0, canceled_at_approximate: 0, ...values
    };
    const columns = Object.keys(row);
    await dataSource.query(
      `INSERT INTO \`${tables.ledger}\` (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      Object.values(row)
    );
    const [inserted] = await dataSource.query(`SELECT id FROM \`${tables.ledger}\` WHERE stripe_subscription_id = ?`, [row.stripe_subscription_id]);
    return inserted.id;
  }

  async function invoice(id, values) {
    await dataSource.query(
      `INSERT INTO \`${tables.invoices}\` (invoice_number, stripe_account, stripe_invoice_id, stripe_subscription_id, user_id, locale,
        currency, total_minor, amount_paid_minor, invoice_status, billing_reason, issued_at)
       VALUES (?, ?, ?, 'sub_x', 7, 'pt-BR', ?, ?, ?, ?, ?, ?)`,
      [`EB-2026-${id}`, values.account || 'br', `in_${id}`, values.currency || 'brl', values.amount, values.amount,
        values.status || 'paid', values.reason || 'subscription_cycle', values.issuedAt]
    );
  }

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.query(`CREATE TABLE \`${tables.ledger}\` LIKE \`stripe_subscriptions\``);
    await dataSource.query(`CREATE TABLE \`${tables.invoices}\` LIKE \`customer_invoices\``);
    await dataSource.query(`CREATE TABLE \`${tables.onboarding}\` (
      user_id bigint unsigned NOT NULL, market varchar(8) NULL, created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dataSource.query(`CREATE TABLE \`${tables.cycles}\` LIKE \`subscription_production_cycles\``);
    await dataSource.query(`CREATE TABLE \`${tables.shipments}\` LIKE \`ups_shipments\``);
    await dataSource.query(`CREATE TABLE \`${tables.items}\` LIKE \`pack_stock_items\``);
    await dataSource.query(`CREATE TABLE \`${tables.movements}\` LIKE \`pack_stock_movements\``);

    const repository = new AdminReportsRepository(dataSource, {
      ledgerTableName: tables.ledger,
      invoicesTableName: tables.invoices,
      onboardingTableName: tables.onboarding,
      cyclesTableName: tables.cycles,
      shipmentsTableName: tables.shipments,
      stockItemsTableName: tables.items,
      stockMovementsTableName: tables.movements
    });
    service = new AdminReportsService({ repository, now: () => now, logger: { warn: jest.fn() } });

    const plan = (subtotal, items) => JSON.stringify({ catalog_pricing: { subtotal, line_items: items } });
    // Active at the start of the window, still active.
    const kept = await subscription({
      stripe_subscription_id: 'sub_kept', activated_at: '2026-08-01 12:00:00',
      plan_selection: plan(150, [{ flavor: 'frango', quantity: 4, pack_size_grams: 300 }]),
      current_period_start: '2026-10-01 12:00:00', current_period_end: '2026-10-31 12:00:00'
    });
    // Active at the start, ended inside the window: churn.
    await subscription({ stripe_subscription_id: 'sub_churned', status: 'canceled', activated_at: '2026-07-01 12:00:00', canceled_at: '2026-10-10 14:00:00' });
    // Started and ended inside the window: canceled but not churn.
    await subscription({ stripe_subscription_id: 'sub_in_out', status: 'canceled', activated_at: '2026-10-02 12:00:00', canceled_at: '2026-10-05 12:00:00', user_id: 8 });
    // Never paid (incomplete_expired stored as canceled): counts nowhere.
    await subscription({ stripe_subscription_id: 'sub_never', status: 'canceled', canceled_at: '2026-10-06 12:00:00', user_id: 9 });
    // New in the window, trialing.
    await subscription({ stripe_subscription_id: 'sub_trial', status: 'trialing', activated_at: '2026-10-20 12:00:00', plan_selection: plan(99, [{ flavor: 'carne', quantity: 2, pack_size_grams: 300 }]) });
    // US row must not leak into Brazil.
    await subscription({ stripe_subscription_id: 'sub_us', stripe_account: 'us', activated_at: '2026-10-03 12:00:00', plan_selection: plan(200, [{ flavor: 'turkey', quantity: 9, pack_size_grams: 454 }]) });

    await invoice(1, { amount: 15000, issuedAt: '2026-10-05 15:00:00', reason: 'subscription_create' });
    await invoice(2, { amount: 15000, issuedAt: '2026-10-12 15:00:00' });
    await invoice(3, { amount: 20000, issuedAt: '2026-10-13 15:00:00', status: 'open' });
    await invoice(4, { amount: 5000, issuedAt: '2026-10-14 15:00:00', currency: 'usd' });
    await invoice(5, { amount: 99999, issuedAt: '2026-10-14 15:00:00', account: 'us', currency: 'usd' });
    // 2026-09-28 02:00 UTC is still 2026-09-27 in Sao Paulo: outside the window.
    await invoice(6, { amount: 7000, issuedAt: '2026-09-28 02:00:00' });

    await dataSource.query(`INSERT INTO \`${tables.onboarding}\` (user_id, market, created_at) VALUES
      (7, 'BR', '2026-10-01 12:00:00'), (8, 'BR', '2026-10-02 12:00:00'), (9, 'BR', '2026-10-03 12:00:00'), (10, 'BR', '2026-10-04 12:00:00'), (11, 'US', '2026-10-04 12:00:00'), (12, NULL, '2026-10-04 12:00:00')`);

    await dataSource.query(
      `INSERT INTO \`${tables.cycles}\` (subscription_id, period_end, status, paid_at, preparation_day, delivery_date) VALUES
        (?, '2026-09-30 12:00:00', 'in_production', '2026-09-30 12:00:00', '2026-10-20', '2026-10-22'),
        (?, '2026-08-31 12:00:00', 'ready', '2026-08-31 12:00:00', '2026-10-01', '2026-10-03')`,
      [kept, kept]
    );

    await dataSource.query(`INSERT INTO \`${tables.items}\` (market, flavor_key, pack_size_grams, on_hand, min_level) VALUES ('BR', 'frango', 300, 20, 5)`);
    const [item] = await dataSource.query(`SELECT id FROM \`${tables.items}\` WHERE flavor_key = 'frango'`);
    await dataSource.query(
      `INSERT INTO \`${tables.movements}\` (item_id, type, quantity, created_at) VALUES
        (?, 'production', 60, '2026-10-02 12:00:00'), (?, 'separation', -40, '2026-10-03 12:00:00'),
        (?, 'separation_reversal', 5, '2026-10-04 12:00:00'), (?, 'adjustment', -3, '2026-10-05 12:00:00')`,
      [item.id, item.id, item.id, item.id]
    );
  });

  afterAll(async () => {
    if (dataSource.isInitialized) {
      for (const table of Object.values(tables)) {
        await dataSource.query(`DROP TABLE IF EXISTS \`${table}\``);
      }
      await dataSource.destroy();
    }
  });

  test('revenue sums only paid BRL invoices of Brazil inside the local window', async () => {
    const report = await service.report('revenue', {}, { markets: ['BR'] });
    expect(report.kpis.grossRevenue.value).toBe(30000);
    expect(report.kpis.paidInvoices.value).toBe(2);
    expect(report.kpis.firstPurchaseRevenue.value).toBe(15000);
    expect(report.excludedInvoices).toBe(1);
    expect(report.estimatedMrr).toMatchObject({ value: 15000, trialingSubscriptions: 1, unpricedSubscriptions: 0 });
    expect(report.series.find((bucket) => bucket.key === '2026-10-05').revenue).toBe(15000);
  });

  test('subscriptions count new, canceled and churn from the lifecycle dates', async () => {
    const report = await service.report('subscriptions', {}, { markets: ['BR'] });
    expect(report.kpis.new.value).toBe(2);
    expect(report.kpis.canceled.value).toBe(2);
    expect(report.kpis.activeAtStart.value).toBe(2);
    expect(report.kpis.churn.value).toBe(0.5);
    expect(report.current.active.value).toBe(1);
    expect(report.current.trialing.value).toBe(1);
  });

  test('acquisition stage 3 counts activations, even of canceled subscriptions', async () => {
    const report = await service.report('acquisition', {}, { markets: ['BR'] });
    expect(report.stages.started.value).toBe(4);
    expect(report.stages.linked.value).toBe(3);
    expect(report.stages.activated.value).toBe(2);
    expect(report).not.toHaveProperty('unassignedCheckouts');

    const forAdmin = await service.report('acquisition', { market: 'BR' }, { markets: ['BR'] }, { roles: ['admin'] });
    expect(forAdmin.unassignedCheckouts).toBe(1);
    expect(forAdmin.stages.started.value).toBe(4);
  });

  test('mix reads the line items with JSON_TABLE', async () => {
    const report = await service.report('mix', {}, { markets: ['BR'] });
    expect(report.recipes.map((row) => [row.key, row.packs])).toEqual([['frango', 4], ['carne', 2]]);
    expect(report.packSizes).toEqual([{ grams: 300, label: '300 g', packs: 6, subscriptions: 2, share: 1 }]);
  });

  test('operations count paid cycles by delivery date and flag late ones; unpaid renewals are never late', async () => {
    const report = await service.report('operations', {}, { markets: ['BR'] });
    expect(report.cycles.in_production.value).toBe(1);
    expect(report.cycles.ready.value).toBe(1);
    // The kept subscription's 2026-10-31 renewal is not paid yet: it waits for payment and is not late.
    expect(report.awaitingPayment).toEqual({ value: 1, previous: null });
    expect(report.late.value).toBe(1);
    expect(report.shipments).toBeNull();
  });

  test('stock nets separation reversals in the window', async () => {
    const report = await service.report('stock', {}, { markets: ['BR'] });
    expect(report.rows[0]).toMatchObject({ key: 'frango', produced: 60, separated: 35, adjusted: -3, onHand: 20 });
  });

  test('the admin summary has both markets in their own currency', async () => {
    const report = await service.report('summary', {}, { markets: ['BR', 'US'] });
    expect(report.markets.map((block) => [block.market, block.currency, block.kpis.grossRevenue.value])).toEqual([
      ['BR', 'BRL', 30000],
      ['US', 'USD', 99999]
    ]);
  });
});
