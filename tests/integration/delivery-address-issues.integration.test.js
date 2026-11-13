const { DataSource } = require('typeorm');
const { CreateDeliveryAddressIssues1700000000066 } = require('../../src/infrastructure/migrations/1700000000066-create-delivery-address-issues');
const { DeliveryAddressIssuesRepository } = require('../../src/infrastructure/repositories/delivery-address-issues.repository');

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

describeIntegration('delivery_address_issues (MySQL)', () => {
  const database = `it_${Date.now()}_mig066`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;
  let repository;
  const issue = (overrides = {}) => ({
    subscriptionId: 5,
    stripeSubscriptionId: 'sub_5',
    userId: 7,
    stripeAccount: 'br',
    codes: ['address_number_missing'],
    source: 'courier_check',
    now: new Date('2026-11-03T12:00:00Z'),
    ...overrides
  });

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database, extra: { connectionLimit: 4 } });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new CreateDeliveryAddressIssues1700000000066().up(runner);
    await new CreateDeliveryAddressIssues1700000000066().up(runner);
    repository = new DeliveryAddressIssuesRepository(dataSource);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('the table uses utf8mb4_unicode_ci', async () => {
    const [table] = await dataSource.query(
      "SELECT TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_address_issues'"
    );
    expect(table.collation).toBe('utf8mb4_unicode_ci');
  });

  test('two concurrent opens keep one open problem, and the loser reads the winner', async () => {
    const results = await Promise.all([repository.insertOpen(issue()), repository.insertOpen(issue({ source: 'payment_check' }))]);
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    const winner = results.find((result) => result.inserted).issue;
    expect(results.find((result) => !result.inserted).issue.id).toBe(winner.id);
    expect(await repository.findOpen(5)).toMatchObject({ id: winner.id, open: true, codes: ['address_number_missing'] });
  });

  test('a closed problem frees the slot, and the latest read prefers the open one', async () => {
    const open = await repository.findOpen(5);
    expect(await repository.close(open.id, { resolvedBy: 'superseded', now: new Date('2026-11-04T12:00:00Z') })).toBe(true);
    expect(await repository.close(open.id, { resolvedBy: 'customer' })).toBe(false);
    const { inserted, issue: next } = await repository.insertOpen(issue({ codes: ['address_neighborhood_missing'], now: new Date('2026-11-04T12:00:00Z') }));
    expect(inserted).toBe(true);

    await repository.updateCodes(next.id, ['fiscal_name_missing']);
    await repository.markEmailSent(next.id, new Date('2026-11-04T13:00:00Z'));
    const latest = await repository.latestForSubscriptions([5, 6, 'x'], { since: new Date('2026-10-01T00:00:00Z') });
    expect([...latest.keys()]).toEqual([5]);
    expect(latest.get(5)).toMatchObject({ id: next.id, open: true, codes: ['fiscal_name_missing'] });
    expect(latest.get(5).emailSentAt).toBeTruthy();

    await repository.close(next.id, { resolvedBy: 'customer', now: new Date('2026-11-05T12:00:00Z') });
    expect((await repository.latestForSubscriptions([5], { since: new Date('2026-10-01T00:00:00Z') })).get(5)).toMatchObject({ id: next.id, resolvedBy: 'customer' });
    expect((await repository.latestForSubscriptions([5], { since: new Date('2026-12-01T00:00:00Z') })).size).toBe(0);
  });

  test('listOpenByUser, listByUser and deleteByUser', async () => {
    await repository.insertOpen(issue({ subscriptionId: 9, stripeSubscriptionId: 'sub_9' }));
    await repository.insertOpen(issue({ subscriptionId: 10, stripeSubscriptionId: 'sub_10', userId: 8 }));
    expect((await repository.listOpenByUser(7)).map((row) => row.subscriptionId)).toEqual([9]);
    expect(await repository.listByUser(7)).toHaveLength(3);
    await repository.deleteByUser(7);
    expect(await repository.listByUser(7)).toHaveLength(0);
    expect(await repository.listByUser(8)).toHaveLength(1);
  });

  // admin-today (admin-flow-fixes-5): open problems per account, stale from 72 hours.
  test('countOpenByAccount counts open problems per account and the stale ones', async () => {
    await repository.deleteByUser(7);
    await repository.deleteByUser(8);
    const now = new Date('2026-11-06T12:00:00Z');
    const hoursAgo = (hours) => new Date(now.getTime() - hours * 3600 * 1000);
    await repository.insertOpen(issue({ subscriptionId: 21, stripeSubscriptionId: 'sub_21', now: hoursAgo(80) }));
    await repository.insertOpen(issue({ subscriptionId: 22, stripeSubscriptionId: 'sub_22', now: hoursAgo(68) }));
    await repository.insertOpen(issue({ subscriptionId: 23, stripeSubscriptionId: 'sub_23', stripeAccount: 'us', now: hoursAgo(1) }));
    const { issue: closed } = await repository.insertOpen(issue({ subscriptionId: 24, stripeSubscriptionId: 'sub_24', now: hoursAgo(100) }));
    await repository.close(closed.id, { resolvedBy: 'customer', now });

    const counts = await repository.countOpenByAccount({ staleBefore: hoursAgo(72) });
    expect(Object.fromEntries(counts)).toEqual({ br: { open: 2, stale: 1 }, us: { open: 1, stale: 0 } });
    expect(Object.fromEntries(await repository.countOpenByAccount({ staleBefore: hoursAgo(72), stripeAccounts: ['us'] }))).toEqual({ us: { open: 1, stale: 0 } });
    expect((await repository.countOpenByAccount({ staleBefore: hoursAgo(72), stripeAccounts: [] })).size).toBe(0);
  });

  test('down drops the table', async () => {
    await new CreateDeliveryAddressIssues1700000000066().down(runner);
    const [row] = await dataSource.query(
      "SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_address_issues'"
    );
    expect(Number(row.total)).toBe(0);
  });
});

// close-address-issues-when-subscription-ends: the "ended" rule against the real tables and their collations
// (courier_deliveries is utf8mb4_0900_ai_ci, the others utf8mb4_unicode_ci).
describeIntegration('delivery_address_issues closeEnded (MySQL)', () => {
  const database = `it_${Date.now()}_ended`;
  const source = process.env.INTEGRATION_DB_NAME || 'eden_bowls';
  const admin = new DataSource({ ...connection, database: source });
  const now = new Date('2026-11-11T12:00:00Z');
  let dataSource;
  let repository;
  let invoiceSeq = 0;

  async function subscription(id, status) {
    await dataSource.query(
      'INSERT INTO stripe_subscriptions (id, user_id, stripe_subscription_id, stripe_customer_id, stripe_account, status) VALUES (?, 7, ?, ?, ?, ?)',
      [id, `sub_${id}`, `cus_${id}`, 'br', status]
    );
    await repository.insertOpen({
      subscriptionId: id, stripeSubscriptionId: `sub_${id}`, userId: 7, stripeAccount: 'br',
      codes: ['recipient_name_missing'], source: 'courier_check', now: new Date('2026-11-08T08:00:00Z')
    });
  }

  async function cycle(subscriptionId, { paid = true } = {}) {
    invoiceSeq += 1;
    const invoice = `in_${subscriptionId}_${invoiceSeq}`;
    await dataSource.query(
      'INSERT INTO subscription_production_cycles (subscription_id, period_end, status, paid_at, paid_invoice_id) VALUES (?, ?, ?, ?, ?)',
      [subscriptionId, `2026-10-${String(invoiceSeq).padStart(2, '0')} 12:00:00`, 'ready', paid ? '2026-10-01 12:00:00' : null, paid ? invoice : null]
    );
    return invoice;
  }

  async function courier(subscriptionId, invoice, status) {
    await dataSource.query(
      'INSERT INTO courier_deliveries (subscription_id, stripe_account, stripe_invoice_id, method, status, out_for_delivery_at) VALUES (?, ?, ?, ?, ?, ?)',
      [String(subscriptionId), 'br', invoice, 'uber', status, '2026-11-08 08:16:57']
    );
  }

  const state = async (id) => {
    const [row] = await dataSource.query('SELECT open_key, resolved_by FROM delivery_address_issues WHERE subscription_id = ?', [id]);
    return row.open_key === null ? row.resolved_by : 'open';
  };

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    for (const table of ['stripe_subscriptions', 'subscription_production_cycles', 'courier_deliveries', 'ups_shipments']) {
      await admin.query(`CREATE TABLE \`${database}\`.\`${table}\` LIKE \`${source}\`.\`${table}\``);
    }
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateDeliveryAddressIssues1700000000066().up(runner);
    await runner.release();
    repository = new DeliveryAddressIssuesRepository(dataSource);

    // Ledger rows use `canceled`, as mapStripeStatus stores Stripe's canceled and incomplete_expired.
    await subscription(1, 'canceled');
    await courier(1, await cycle(1), 'delivered');
    await subscription(2, 'canceled');
    await cycle(2);
    await subscription(3, 'canceled');
    await courier(3, await cycle(3), 'failed');
    await subscription(4, 'canceled');
    await dataSource.query(
      "INSERT INTO ups_shipments (subscription_id, stripe_invoice_id, status) VALUES ('4', ?, 'created')",
      [await cycle(4)]
    );
    await subscription(5, 'canceled');
    await courier(5, await cycle(5), 'delivered');
    await cycle(5, { paid: false });
    await subscription(6, 'active');
    await courier(6, await cycle(6), 'delivered');
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('one subscription: closes only that one', async () => {
    expect(await repository.closeEnded({ subscriptionId: 1, now })).toBe(1);
    expect(await state(1)).toBe('ended');
    expect(await state(4)).toBe('open');
    expect(await repository.closeEnded({ subscriptionId: 1, now })).toBe(0);
  });

  test('all: closes canceled with every paid box gone, keeps the others open', async () => {
    expect(await repository.closeEnded({ now })).toBe(2);
    expect(await state(2)).toBe('open'); // canceled, paid cycle never left
    expect(await state(3)).toBe('open'); // canceled, only a failed delivery
    expect(await state(4)).toBe('ended'); // canceled, UPS label created
    expect(await state(5)).toBe('ended'); // canceled, delivered + a cycle not paid
    expect(await state(6)).toBe('open'); // active
  });
});
