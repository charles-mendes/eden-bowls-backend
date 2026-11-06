const { DataSource } = require('typeorm');
const { SubscriptionLedgerRepository } = require('../../src/infrastructure/repositories/subscription-ledger.repository');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('SubscriptionLedgerRepository production queue integration (MySQL)', () => {
  const suffix = Date.now();
  const ledgerTable = `it_${suffix}_stripe_subscriptions`;
  const cycleTable = `it_${suffix}_subscription_production_cycles`;
  const usersTable = `it_${suffix}_wp_users`;
  const usermetaTable = `it_${suffix}_usermeta`;
  const courierTable = `it_${suffix}_courier_deliveries`;

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

  let repository;

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.query(`CREATE TABLE \`${usersTable}\` (
      ID bigint unsigned NOT NULL,
      display_name varchar(250) NOT NULL DEFAULT '',
      PRIMARY KEY (ID)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dataSource.query(`CREATE TABLE \`${usermetaTable}\` (
      umeta_id bigint unsigned NOT NULL AUTO_INCREMENT,
      user_id bigint unsigned NOT NULL,
      meta_key varchar(255) NULL,
      meta_value longtext NULL,
      PRIMARY KEY (umeta_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dataSource.query(`CREATE TABLE \`${ledgerTable}\` (
      id int unsigned NOT NULL AUTO_INCREMENT,
      user_id bigint unsigned NOT NULL,
      customer_email varchar(255) NULL,
      stripe_subscription_id varchar(64) NOT NULL,
      stripe_customer_id varchar(64) NOT NULL,
      stripe_account varchar(8) NOT NULL DEFAULT 'us',
      status varchar(32) NOT NULL,
      plan_label varchar(128) NULL,
      stripe_price_id varchar(64) NULL,
      current_period_start datetime NULL,
      current_period_end datetime NULL,
      cancel_at_period_end tinyint(1) NOT NULL DEFAULT 0,
      pets_snapshot json NULL,
      plan_selection json NULL,
      shipping json NULL,
      address json NULL,
      subscription_term_months tinyint unsigned NULL,
      edit_payment_pending tinyint(1) NOT NULL DEFAULT 0,
      edit_pending json NULL,
      created_at datetime NULL,
      updated_at datetime NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dataSource.query(`CREATE TABLE \`${cycleTable}\` (
      id int unsigned NOT NULL AUTO_INCREMENT,
      subscription_id int unsigned NOT NULL,
      period_end datetime NOT NULL,
      status varchar(32) NOT NULL,
      note varchar(255) NULL,
      paid_at datetime NULL,
      paid_invoice_id varchar(64) NULL,
      preparation_day date NULL,
      delivery_date date NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    repository = new SubscriptionLedgerRepository(dataSource, {
      tableName: ledgerTable,
      usermetaTableName: usermetaTable,
      productionCyclesTableName: cycleTable
    });
  });

  afterAll(async () => {
    if (dataSource.isInitialized) {
      await dataSource.query(`DROP TABLE IF EXISTS \`${cycleTable}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${courierTable}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${ledgerTable}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${usersTable}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${usermetaTable}\``);
      await dataSource.destroy();
    }
  });

  test('includes the civil window, caps overdue, and excludes cancel-at-period-end', async () => {
    await dataSource.query(
      `INSERT INTO \`${usersTable}\` (ID, display_name) VALUES (7, 'Ana Costa')`
    );
    await dataSource.query(
      `INSERT INTO \`${ledgerTable}\`
        (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_start, current_period_end, cancel_at_period_end)
       VALUES
        (7, 'ana@edenbowls.com', 'sub_today', 'cus_1', 'br', 'active', '2026-08-20 08:00:00', '2026-09-20 08:00:00', 0),
        (7, 'ana@edenbowls.com', 'sub_overdue', 'cus_2', 'br', 'past_due', '2026-09-17 08:00:00', '2026-10-17 08:00:00', 0),
        (7, 'ana@edenbowls.com', 'sub_old', 'cus_3', 'br', 'active', '2026-08-01 08:00:00', '2026-09-01 08:00:00', 0),
        (7, 'ana@edenbowls.com', 'sub_cape', 'cus_4', 'br', 'active', '2026-08-21 08:00:00', '2026-09-21 08:00:00', 1)`
    );

    const result = await repository.listQueue({
      startOfToday: '2026-09-20 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-09-13 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 20
    });

    const ids = result.items.map((item) => item.stripeSubscriptionId).sort();
    expect(ids).toEqual(['sub_overdue', 'sub_today']);
    // A past_due cycle is the renewal that failed (the period start) and waits for payment.
    const overdue = result.items.find((item) => item.stripeSubscriptionId === 'sub_overdue');
    expect(overdue.paymentState).toBe('past_due');
    expect(new Date(overdue.cyclePeriodEnd).toISOString()).toBe('2026-09-17T08:00:00.000Z');
    expect(result.items.find((item) => item.stripeSubscriptionId === 'sub_today').paymentState).toBe('awaiting_payment');
  });

  test('demand rows are every row of every queue page for the same window', async () => {
    const window = {
      startOfToday: '2026-09-20 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-09-13 03:00:00',
      includeOverdue: true
    };
    const pages = [];
    for (let offset = 0; ; offset += 1) {
      const page = await repository.listQueue({ ...window, offset, perPage: 1 });
      if (!page.items.length) break;
      pages.push(...page.items);
    }

    const demand = await repository.listQueueDemandRows(window);

    const key = (item) => `${item.id}|${new Date(item.cyclePeriodEnd).toISOString()}`;
    expect(pages.length).toBeGreaterThan(1);
    expect(demand.map(key)).toEqual(pages.map(key));
  });

  test('search matches the name the queue shows, whatever address key holds it', async () => {
    await dataSource.query(
      `INSERT INTO \`${ledgerTable}\`
        (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_start, current_period_end, cancel_at_period_end, address)
       VALUES
        (8, 'x1@example.com', 'sub_recipient', 'cus_5', 'br', 'active', '2026-08-22 08:00:00', '2026-09-22 08:00:00', 0, '{"country":"BR","recipient_name":"Carla Souza"}'),
        (8, 'x2@example.com', 'sub_full_name', 'cus_6', 'br', 'active', '2026-08-22 08:00:00', '2026-09-22 08:00:00', 0, '{"country":"BR","full_name":"Bruno Lima"}')`
    );
    const window = {
      startOfToday: '2026-09-20 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-09-13 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 20
    };

    const bySurname = await repository.listQueue({ ...window, q: 'souza' });
    expect(bySurname.items.map((item) => item.stripeSubscriptionId)).toEqual(['sub_recipient']);
    const byLegacyKey = await repository.listQueue({ ...window, q: 'BRUNO' });
    expect(byLegacyKey.items.map((item) => item.stripeSubscriptionId)).toEqual(['sub_full_name']);
  });

  test('lists the paid cycles of one subscription, a cycle without delivery date in its place', async () => {
    const [ledger] = await dataSource.query(
      `INSERT INTO \`${ledgerTable}\` (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_start, current_period_end)
       VALUES (7, 'ana@edenbowls.com', 'sub_cycles', 'cus_c', 'us', 'active', '2026-09-01 08:00:00', '2026-10-01 08:00:00')`
    ).then((result) => [result]);
    const subscriptionId = ledger.insertId;
    await dataSource.query(
      `INSERT INTO \`${cycleTable}\` (subscription_id, period_end, status, paid_at, paid_invoice_id, preparation_day, delivery_date) VALUES
        (?, '2026-07-01 08:00:00', 'ready', '2026-06-01 08:00:00', 'in_jul', '2026-06-28', '2026-07-01'),
        (?, '2026-08-01 08:00:00', 'ready', '2026-07-01 08:00:00', 'in_aug', NULL, NULL),
        (?, '2026-09-01 08:00:00', 'in_production', '2026-08-01 08:00:00', 'in_sep', '2026-08-29', '2026-09-01'),
        (?, '2026-10-01 08:00:00', 'to_prepare', NULL, NULL, NULL, NULL)`,
      [subscriptionId, subscriptionId, subscriptionId, subscriptionId]
    );

    const cycles = await repository.listPaidCyclesBySubscription(subscriptionId, 2);
    expect(cycles.map((cycle) => cycle.paidInvoiceId)).toEqual(['in_sep', 'in_aug']);

    const all = await repository.listPaidCyclesBySubscription(subscriptionId);
    expect(all.map((cycle) => cycle.paidInvoiceId)).toEqual(['in_sep', 'in_aug', 'in_jul']);
  });

  test('counts Brazil cycles to dispatch by the courier queue rule', async () => {
    await dataSource.query(`CREATE TABLE \`${courierTable}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      stripe_invoice_id varchar(191) NOT NULL,
      status varchar(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    const result = await dataSource.query(
      `INSERT INTO \`${ledgerTable}\` (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_start, current_period_end, address)
       VALUES (7, 'ana@edenbowls.com', 'sub_br_count', 'cus_br', 'br', 'active', '2026-10-01 08:00:00', '2026-11-01 08:00:00', '{"country":"BR"}')`
    );
    const id = result.insertId;
    const cycle = (invoice, delivery) => [id, `${delivery} 08:00:00`, 'ready', `${delivery} 07:00:00`, invoice, delivery];
    const values = [
      cycle('in_wait', '2026-11-05'),
      cycle('in_road', '2026-11-05'),
      cycle('in_failed', '2026-11-04'),
      cycle('in_canceled', '2026-11-03'),
      cycle('in_old', '2026-09-01')
    ];
    for (const value of values) {
      await dataSource.query(
        `INSERT INTO \`${cycleTable}\` (subscription_id, period_end, status, paid_at, paid_invoice_id, delivery_date) VALUES (?, ?, ?, ?, ?, ?)`,
        value
      );
    }
    await dataSource.query(
      `INSERT INTO \`${courierTable}\` (stripe_invoice_id, status) VALUES ('in_road', 'out_for_delivery'), ('in_failed', 'failed'), ('in_canceled', 'canceled')`
    );

    const count = (stripeAccounts) => repository.countPaidCourierCyclesToDispatch({ deliveryFloor: '2026-10-05', courierTableName: courierTable, stripeAccounts });
    await expect(count(null)).resolves.toBe(2);
    await expect(count(['br'])).resolves.toBe(2);
    await expect(count(['us'])).resolves.toBe(0);
    await expect(count([])).resolves.toBe(0);
  });

  test('the courier and label queues take only their shipping market', async () => {
    await dataSource.query(`CREATE TABLE IF NOT EXISTS \`${courierTable}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      stripe_invoice_id varchar(191) NOT NULL,
      status varchar(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    const pairs = [
      ['sub_br_br', 'br', '{"country":"BR"}', 'in_br_br'],
      ['sub_us_us', 'us', '{"country":"US"}', 'in_us_us'],
      ['sub_us_br', 'us', '{"country":"BR"}', 'in_us_br'],
      ['sub_br_us', 'br', '{"country":"US"}', 'in_br_us'],
      ['sub_us_none', 'us', '{"city":"Austin"}', 'in_us_none']
    ];
    for (const [sub, account, address, invoice] of pairs) {
      const result = await dataSource.query(
        `INSERT INTO \`${ledgerTable}\` (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_start, current_period_end, address)
         VALUES (7, 'ana@edenbowls.com', ?, 'cus_m', ?, 'active', '2026-10-01 08:00:00', '2026-11-01 08:00:00', ?)`,
        [sub, account, address]
      );
      await dataSource.query(
        `INSERT INTO \`${cycleTable}\` (subscription_id, period_end, status, paid_at, paid_invoice_id, delivery_date) VALUES (?, '2027-01-05 08:00:00', 'ready', '2027-01-01 07:00:00', ?, '2027-01-05')`,
        [result.insertId, invoice]
      );
    }

    const courier = await repository.listPaidCourierCycles({ deliveryFloor: '2027-01-01', limit: 50 });
    const labels = await repository.listPaidLabelCycles({ deliveryFloor: '2027-01-01', limit: 50 });
    expect(courier.map((cycle) => cycle.paidInvoiceId)).toEqual(['in_br_br']);
    expect(labels.map((cycle) => cycle.paidInvoiceId)).toEqual(['in_us_us']);
    await expect(repository.countPaidCourierCyclesToDispatch({ deliveryFloor: '2027-01-01', courierTableName: courierTable })).resolves.toBe(1);
  });

  test('lists the subscriptions that ship from no market, with their open paid cycles', async () => {
    const upsTable = `it_${suffix}_ups_shipments`;
    await dataSource.query(`CREATE TABLE \`${upsTable}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      stripe_invoice_id varchar(191) NOT NULL,
      status varchar(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    try {
      const insert = async (sub, account, status, address) => (await dataSource.query(
        `INSERT INTO \`${ledgerTable}\` (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_start, current_period_end, address)
         VALUES (8, 'x@example.com', ?, 'cus_x', ?, ?, '2027-02-01 08:00:00', '2027-03-01 08:00:00', ?)`,
        [sub, account, status, address]
      )).insertId;
      const crossed = await insert('sub_exc_us_br', 'us', 'active', '{"country":"BR"}');
      await insert('sub_exc_canceled', 'br', 'canceled', '{"country":"US"}');
      await insert('sub_exc_none', 'br', 'active', '{"city":"Curitiba"}');
      const cycle = (invoice, delivery) => dataSource.query(
        `INSERT INTO \`${cycleTable}\` (subscription_id, period_end, status, paid_at, paid_invoice_id, delivery_date) VALUES (?, ?, 'ready', ?, ?, ?)`,
        [crossed, `${delivery} 08:00:00`, `${delivery} 07:00:00`, invoice, delivery]
      );
      await cycle('in_exc_open', '2027-02-05');
      await cycle('in_exc_labeled', '2027-02-06');
      await cycle('in_exc_old', '2026-12-01');
      await dataSource.query(`INSERT INTO \`${upsTable}\` (stripe_invoice_id, status) VALUES ('in_exc_labeled', 'created')`);

      const listed = await repository.listMarketExceptions({ deliveryFloor: '2027-01-15', courierTableName: courierTable, upsTableName: upsTable });
      const ours = listed.filter((row) => row.stripeSubscriptionId.startsWith('sub_exc_'));
      expect(ours.map((row) => [row.stripeSubscriptionId, row.openPaidCycles])).toEqual([
        ['sub_exc_us_br', 1],
        ['sub_exc_none', 0]
      ]);
      const usOnly = await repository.listMarketExceptions({ deliveryFloor: '2027-01-15', stripeAccounts: ['us'], courierTableName: courierTable, upsTableName: upsTable });
      expect(usOnly.filter((row) => row.stripeSubscriptionId.startsWith('sub_exc_')).map((row) => row.stripeSubscriptionId)).toEqual(['sub_exc_us_br']);
    } finally {
      await dataSource.query(`DROP TABLE IF EXISTS \`${upsTable}\``);
    }
  });
});
