const { DataSource } = require('typeorm');
const { AdminReportsRepository } = require('../../src/infrastructure/repositories/admin-reports.repository');
const { AdminReportsService } = require('../../src/services/admin-reports.service');
const { resolveReportPeriod } = require('../../src/core/report-period');
const { AdminReportDetailsService } = require('../../src/services/admin-report-details.service');

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
  let repository;

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

    repository = new AdminReportsRepository(dataSource, {
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

  describe('details: the records behind each figure add up to the aggregate', () => {
    const window = () => resolveReportPeriod({}, { market: 'BR', now });
    const page = { limit: 50, offset: 0 };
    const totals = (name, args, measures) => repository.detailTotals(name, args, measures);

    test('invoices: paid in the market currency, grouped by billing reason, other currency apart', async () => {
      const { range } = window();
      const args = { account: 'br', currency: 'brl', range, variant: 'paid' };
      const { totals: sum, groups } = await totals('invoices', args, { contribution: 'amount' });
      expect(sum).toEqual({ count: 2, contribution: 30000 });
      expect(groups).toEqual([
        { key: 'subscription_create', count: 1, contribution: 15000 },
        { key: 'subscription_cycle', count: 1, contribution: 15000 }
      ]);

      const records = await repository.detailRecords('invoices', args, { contribution: 'amount' }, page);
      expect(records.map((row) => row.invoiceNumber)).toEqual(['EB-2026-1', 'EB-2026-2']);
      expect(records[0]).toMatchObject({ date: '2026-10-05T15:00:00Z', groupKey: 'subscription_create' });
      expect(Number(records[0].userId)).toBe(7);
      expect(Number(records[0].contribution)).toBe(15000);

      const second = await repository.detailRecords('invoices', args, { contribution: 'amount' }, { limit: 1, offset: 1 });
      expect(second.map((row) => row.invoiceNumber)).toEqual(['EB-2026-2']);

      const other = await totals('invoices', { ...args, variant: 'otherCurrency' }, { contribution: 'one' });
      expect(other.totals).toEqual({ count: 1, contribution: 1 });
      const first = await totals('invoices', { ...args, variant: 'firstPurchase' }, { contribution: 'amount' });
      const renewal = await totals('invoices', { ...args, variant: 'renewal' }, { contribution: 'amount' });
      expect(first.totals.contribution + renewal.totals.contribution).toBe(30000);
    });

    test('subscriptions: new, canceled and the churn base with its numerator', async () => {
      const { range } = window();
      const base = { account: 'br', range };
      expect((await totals('subscriptions', { ...base, variant: 'new' }, { contribution: 'one' })).totals.contribution).toBe(2);
      expect((await totals('subscriptions', { ...base, variant: 'canceled' }, { contribution: 'one' })).totals.contribution).toBe(2);
      const churn = await totals('subscriptions', { ...base, variant: 'activeAtStart' }, { numerator: 'churned', denominator: 'one' });
      expect(churn.totals).toEqual({ count: 2, numerator: 1, denominator: 2 });
      expect((await totals('subscriptions', { account: 'br', variant: 'active' }, { contribution: 'one' })).totals.count).toBe(1);
      expect((await totals('subscriptions', { account: 'br', variant: 'activeOrTrialing' }, { contribution: 'one' })).totals.count).toBe(2);
    });

    test('checkouts: each stage and the highest stage reached', async () => {
      const { range } = window();
      const base = { market: 'BR', account: 'br', range };
      const started = await totals('checkouts', { ...base, variant: 'started' }, { numerator: 'activated', denominator: 'one' });
      expect(started.totals).toEqual({ count: 4, numerator: 2, denominator: 4 });
      expect(started.groups).toEqual([
        { key: 'activated', count: 2, numerator: 2, denominator: 2 },
        { key: 'linked', count: 1, numerator: 0, denominator: 1 },
        { key: 'started', count: 1, numerator: 0, denominator: 1 }
      ]);
      expect((await totals('checkouts', { ...base, variant: 'linked' }, { contribution: 'one' })).totals.count).toBe(3);
      expect((await totals('checkouts', { ...base, variant: 'activated' }, { contribution: 'one' })).totals.count).toBe(2);
      expect((await totals('checkouts', { range, variant: 'unassigned' }, { contribution: 'one' })).totals.count).toBe(1);
    });

    test('mix: one record per subscription, packs of the recipe and the share of all packs', async () => {
      const records = await repository.detailRecords('lineItems', { account: 'br', flavor: 'frango' }, { contribution: 'packs' }, page);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ items: 'frango · 300 g × 4' });
      const share = await totals('lineItems', { account: 'br', match: { flavor: 'frango' } }, { numerator: 'matchPacks', denominator: 'packs' });
      expect(share.totals).toEqual({ count: 2, numerator: 4, denominator: 6 });
    });

    test('operations: cycles by status, late and awaiting payment', async () => {
      const period = window();
      const base = { account: 'br', from: period.from, to: period.to, today: period.today };
      expect((await totals('cycles', { ...base, status: 'in_production' }, { contribution: 'one' })).totals.count).toBe(1);
      const late = await repository.detailRecords('cycles', { ...base, late: true }, { contribution: 'one' }, page);
      expect(late).toHaveLength(1);
      expect(late[0]).toMatchObject({ groupKey: 'in_production', preparationDay: '2026-10-20', deliveryDate: '2026-10-22' });
      expect((await totals('awaiting', { account: 'br' }, { contribution: 'one' })).totals.count).toBe(1);
    });

    test('shipments: the total leaves voided ones out and lists them apart', async () => {
      const [us] = await dataSource.query(`SELECT id FROM \`${tables.ledger}\` WHERE stripe_subscription_id = 'sub_us'`);
      await dataSource.query(
        `INSERT INTO \`${tables.shipments}\` (subscription_id, stripe_invoice_id, status, tracking_number, created_at) VALUES
          (?, 'in_a', 'delivered', '1Z1', '2026-10-05 12:00:00'), (?, 'in_b', 'voided', '1Z2', '2026-10-06 12:00:00')`,
        [us.id, us.id]
      );
      const { range } = resolveReportPeriod({}, { market: 'US', now });
      const total = await repository.detailRecords('shipments', { account: 'us', range, variant: 'total' }, { contribution: 'one' }, page);
      expect(total.map((row) => [row.groupKey, row.trackingNumber])).toEqual([['delivered', '1Z1']]);
      expect((await totals('shipments', { account: 'us', range, variant: 'voided' }, { contribution: 'one' })).totals.count).toBe(1);
      expect((await totals('shipments', { account: 'us', range, variant: 'status', status: 'delivered' }, { contribution: 'one' })).totals.count).toBe(1);
      const report = await service.report('operations', {}, { markets: ['US'] });
      expect(report.shipments.total.value).toBe(1);
    });

    test('stock: separation nets its reversal; the balance check sums every movement', async () => {
      const { range } = window();
      const separated = await totals('movements', { market: 'BR', range, flavor: 'frango', grams: 300, kind: 'separated' }, { contribution: 'effect' });
      expect(separated.totals).toEqual({ count: 2, contribution: 35 });
      const balance = await totals('movements', { market: 'BR', flavor: 'frango', grams: 300, kind: 'balance' }, { contribution: 'effect' });
      // 60 - 40 + 5 - 3 = 22, while the stored on_hand is 20: the details show the gap.
      expect(balance.totals).toEqual({ count: 4, contribution: 22 });
    });

    test('customer names come in a separate query by user id', async () => {
      const users = `it_${suffix}_rep_users`;
      await dataSource.query(`CREATE TABLE \`${users}\` (ID bigint unsigned NOT NULL, display_name varchar(250) NOT NULL, PRIMARY KEY (ID))`);
      try {
        await dataSource.query(`INSERT INTO \`${users}\` (ID, display_name) VALUES (7, 'Ana'), (8, 'Bia')`);
        repository.usersTable = users;
        expect(await repository.customerNames([7, 7, 99])).toEqual({ 7: 'Ana' });
      } finally {
        await dataSource.query(`DROP TABLE IF EXISTS \`${users}\``);
      }
    });
  });

  describe('details of every figure on the screen', () => {
    const NOT_A_FIGURE = new Set(['market', 'currency', 'period', 'period.previous', 'period.timezone', 'period.granularity', 'generatedAt', 'markets', 'recipes', 'packSizes', 'rows', 'shipments.byStatus']);
    // The stored stock balance is not rebuilt from movements; a gap there is information, not a report bug.
    const BALANCE = /(^rows\..+\.onHand$|^totals\.onHand$)/;
    const admin = { roles: ['admin'], permissions: ['reports.read', 'reports.export', 'billing.subscribers.read'] };

    test.each([
      ['revenue', 'BR'], ['subscriptions', 'BR'], ['acquisition', 'BR'], ['mix', 'BR'], ['operations', 'BR'], ['operations', 'US'], ['stock', 'BR'], ['summary', 'BR']
    ])('%s %s: the records of each figure add up to the card, now and in the previous period', async (report, market) => {
      const details = new AdminReportDetailsService({ reportsService: service, repository, logger: { error: jest.fn() } });
      const scope = { markets: [market] };
      const { csv } = await service.exportCsv({ report, market, formato: 'csv' }, scope, admin);
      const keys = [...new Set(csv.trim().split('\r\n').slice(1)
        .map((line) => line.slice(line.lastIndexOf(',"') + 2, -1))
        .filter((key) => !NOT_A_FIGURE.has(key)))];
      expect(keys.length).toBeGreaterThan(0);

      for (const key of keys) {
        const query = { report, indicator: key, market };
        const result = await details.details(query, scope, admin);
        if (BALANCE.test(key)) continue;
        expect([key, result.reconciliation.matches, result.reconciliation.recordsValue]).toEqual([key, true, result.value]);
        if (result.hasPrevious) {
          const previous = await details.details({ ...query, period: 'previous' }, scope, admin);
          expect([key, 'previous', previous.reconciliation.matches]).toEqual([key, 'previous', true]);
        }
      }
    });

    test('a bar of the revenue series adds up to its bucket', async () => {
      const details = new AdminReportDetailsService({ reportsService: service, repository });
      const result = await details.details({ report: 'revenue', indicator: 'series.revenue', market: 'BR', bucket: '2026-10-05' }, { markets: ['BR'] }, admin);
      expect(result.records.items.map((record) => record.reference)).toEqual(['EB-2026-1']);
      expect(result.reconciliation).toEqual({ reportValue: 15000, recordsValue: 15000, matches: true });
    });

    test('the stored balance that differs from the movements is shown as a gap', async () => {
      const logger = { error: jest.fn() };
      const details = new AdminReportDetailsService({ reportsService: service, repository, logger });
      const result = await details.details({ report: 'stock', indicator: 'rows.frango.300.onHand', market: 'BR' }, { markets: ['BR'] }, admin);
      expect(result.reconciliation).toEqual({ reportValue: 20, recordsValue: 22, matches: false });
      expect(result.records.total).toBe(4);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
