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
  const nfeTable = `it_${suffix}_bling_nfe`;

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
      await dataSource.query(`DROP TABLE IF EXISTS \`${nfeTable}\``);
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

    const upsTable = `it_${suffix}_ups_market`;
    await dataSource.query(`CREATE TABLE \`${upsTable}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      stripe_invoice_id varchar(191) NOT NULL,
      status varchar(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    try {
      const courier = await repository.listPaidCourierCycles({ deliveryFloor: '2027-01-01', limit: 50, courierTableName: courierTable });
      const labels = await repository.listPaidLabelCycles({ deliveryFloor: '2027-01-01', limit: 50, upsTableName: upsTable });
      expect(courier.map((cycle) => cycle.paidInvoiceId)).toEqual(['in_br_br']);
      expect(labels.map((cycle) => cycle.paidInvoiceId)).toEqual(['in_us_us']);
      await expect(repository.countPaidCourierCyclesToDispatch({ deliveryFloor: '2027-01-01', courierTableName: courierTable })).resolves.toBe(1);
    } finally {
      await dataSource.query(`DROP TABLE IF EXISTS \`${upsTable}\``);
    }
  });

  // simplify-brazil-dispatch: with readyOnly only the ready cycle is to dispatch; without it both are.
  test('courier readyOnly lists and counts the ready cycle and leaves the one still in production', async () => {
    await dataSource.query(`CREATE TABLE IF NOT EXISTS \`${courierTable}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      stripe_invoice_id varchar(191) NOT NULL,
      status varchar(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    const result = await dataSource.query(
      `INSERT INTO \`${ledgerTable}\` (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_start, current_period_end, address)
       VALUES (7, 'ana@edenbowls.com', 'sub_ready_br', 'cus_ready', 'br', 'active', '2026-12-01 08:00:00', '2027-01-01 08:00:00', '{"country":"BR"}')`
    );
    for (const [status, invoice, delivery] of [['ready', 'in_ready_ok', '2026-12-04'], ['in_production', 'in_ready_kitchen', '2026-12-05']]) {
      await dataSource.query(
        `INSERT INTO \`${cycleTable}\` (subscription_id, period_end, status, paid_at, paid_invoice_id, delivery_date) VALUES (?, ?, ?, ?, ?, ?)`,
        [result.insertId, `${delivery} 08:00:00`, status, `${delivery} 07:00:00`, invoice, delivery]
      );
    }
    const range = { deliveryFloor: '2026-12-01', deliveryCeiling: '2026-12-10', courierTableName: courierTable };

    const ready = await repository.listPaidCourierCycles({ ...range, limit: 50, readyOnly: true });
    const all = await repository.listPaidCourierCycles({ ...range, limit: 50 });

    expect(ready.map((cycle) => cycle.paidInvoiceId)).toEqual(['in_ready_ok']);
    expect(all.map((cycle) => cycle.paidInvoiceId)).toEqual(['in_ready_ok', 'in_ready_kitchen']);
    await expect(repository.countPaidCourierCyclesToDispatch({ ...range, readyOnly: true })).resolves.toBe(1);
    await expect(repository.countPaidCourierCyclesToDispatch(range)).resolves.toBe(2);
  });

  // admin-flow-fixes-5: the limit counts only what has not left, and a label at work escapes the range.
  test('shipping queues read the range and keep the limit for orders still waiting', async () => {
    const upsTable = `it_${suffix}_ups_range`;
    await dataSource.query(`CREATE TABLE IF NOT EXISTS \`${courierTable}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      stripe_invoice_id varchar(191) NOT NULL,
      status varchar(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    await dataSource.query(`CREATE TABLE \`${upsTable}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      stripe_invoice_id varchar(191) NOT NULL,
      status varchar(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    try {
      const subscription = async (sub, account, country) => (await dataSource.query(
        `INSERT INTO \`${ledgerTable}\` (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_start, current_period_end, address)
         VALUES (7, 'ana@edenbowls.com', ?, 'cus_r', ?, 'active', '2027-02-01 08:00:00', '2027-03-01 08:00:00', ?)`,
        [sub, account, JSON.stringify({ country })]
      )).insertId;
      const cycle = (id, invoice, delivery) => dataSource.query(
        `INSERT INTO \`${cycleTable}\` (subscription_id, period_end, status, paid_at, paid_invoice_id, delivery_date) VALUES (?, ?, 'ready', ?, ?, ?)`,
        [id, `${delivery} 08:00:00`, `${delivery} 07:00:00`, invoice, delivery]
      );
      const br = await subscription('sub_range_br', 'br', 'BR');
      await cycle(br, 'in_r_sent1', '2027-02-02');
      await cycle(br, 'in_r_sent2', '2027-02-03');
      await cycle(br, 'in_r_wait1', '2027-02-04');
      await cycle(br, 'in_r_wait2', '2027-02-05');
      await cycle(br, 'in_r_later', '2027-02-20');
      await dataSource.query(`INSERT INTO \`${courierTable}\` (stripe_invoice_id, status) VALUES ('in_r_sent1', 'delivered'), ('in_r_sent2', 'out_for_delivery')`);

      // Two boxes already left: with a limit of 2 the two still waiting both fit.
      const courier = await repository.listPaidCourierCycles({ deliveryFloor: '2027-02-01', deliveryCeiling: '2027-02-10', limit: 2, courierTableName: courierTable });
      expect(courier.map((row) => row.paidInvoiceId)).toEqual(['in_r_wait1', 'in_r_wait2']);
      await expect(repository.countPaidCourierCyclesToDispatch({ deliveryFloor: '2027-02-11', courierTableName: courierTable })).resolves.toBe(1);

      const us = await subscription('sub_range_us', 'us', 'US');
      await cycle(us, 'in_u_ready1', '2027-02-04');
      await cycle(us, 'in_u_ready2', '2027-02-05');
      await cycle(us, 'in_u_created', '2027-02-15');
      await cycle(us, 'in_u_voided', '2027-02-06');
      await cycle(us, 'in_u_delivered', '2027-02-04');
      await cycle(us, 'in_u_later', '2027-02-25');
      await dataSource.query(`INSERT INTO \`${upsTable}\` (stripe_invoice_id, status) VALUES ('in_u_created', 'created'), ('in_u_voided', 'voided'), ('in_u_delivered', 'delivered')`);

      const ready = await repository.listPaidLabelCycles({ deliveryFloor: '2027-02-01', deliveryCeiling: '2027-02-10', limit: 2, upsTableName: upsTable });
      expect(ready.map((row) => row.paidInvoiceId)).toEqual(['in_u_ready1', 'in_u_ready2']);
      const active = await repository.listLabelCyclesWithActiveShipment({ deliveryFloor: '2027-02-01', upsTableName: upsTable });
      expect(active.map((row) => row.paidInvoiceId)).toEqual(['in_u_created']);
      await expect(repository.countPaidLabelCyclesWithoutShipment({ deliveryFloor: '2027-02-11', upsTableName: upsTable })).resolves.toBe(1);
    } finally {
      await dataSource.query(`DROP TABLE IF EXISTS \`${upsTable}\``);
    }
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
      // admin-today: the same rule, counted per account without the list's limit.
      const counts = await repository.countMarketExceptions();
      expect(counts.get('us')).toBeGreaterThanOrEqual(1);
      expect(counts.get('br')).toBeGreaterThanOrEqual(1);
      expect([...(await repository.countMarketExceptions({ stripeAccounts: ['us'] })).keys()]).toEqual(['us']);
      expect((await repository.countMarketExceptions({ stripeAccounts: [] })).size).toBe(0);
    } finally {
      await dataSource.query(`DROP TABLE IF EXISTS \`${upsTable}\``);
    }
  });

  // admin-flow-fixes-4 (PM-25): Today's cycles to dispatch without an authorized NF-e, across collations.
  test('counts the cycles to dispatch waiting for an authorized NF-e in the same account', async () => {
    await dataSource.query(`CREATE TABLE IF NOT EXISTS \`${courierTable}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      stripe_invoice_id varchar(191) NOT NULL,
      status varchar(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    await dataSource.query(`CREATE TABLE \`${nfeTable}\` (
      id int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      status varchar(32) NOT NULL,
      stripe_account varchar(8) NOT NULL,
      stripe_invoice_id varchar(64) NOT NULL,
      UNIQUE KEY uniq_stripe (stripe_account, stripe_invoice_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    const result = await dataSource.query(
      `INSERT INTO \`${ledgerTable}\` (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_start, current_period_end, address)
       VALUES (7, 'ana@edenbowls.com', 'sub_br_nfe', 'cus_br_nfe', 'br', 'active', '2027-03-01 08:00:00', '2027-04-01 08:00:00', '{"country":"BR"}')`
    );
    for (const invoice of ['in_nfe_ok', 'in_nfe_rejected', 'in_nfe_none', 'in_nfe_other_account']) {
      await dataSource.query(
        `INSERT INTO \`${cycleTable}\` (subscription_id, period_end, status, paid_at, paid_invoice_id, delivery_date) VALUES (?, ?, ?, ?, ?, ?)`,
        [result.insertId, '2027-03-10 08:00:00', 'ready', '2027-03-10 07:00:00', invoice, '2027-03-10']
      );
    }
    await dataSource.query(
      `INSERT INTO \`${nfeTable}\` (status, stripe_account, stripe_invoice_id) VALUES ('authorized', 'br', 'in_nfe_ok'), ('rejected', 'br', 'in_nfe_rejected'), ('authorized', 'us', 'in_nfe_other_account')`
    );

    const range = { deliveryFloor: '2027-03-01', deliveryCeiling: '2027-03-31', courierTableName: courierTable };
    await expect(repository.countPaidCourierCyclesToDispatch(range)).resolves.toBe(4);
    await expect(repository.countPaidCourierCyclesToDispatch({ ...range, nfeTableName: nfeTable })).resolves.toBe(3);
  });
  // keep-ready-orders-dispatchable: June 2026 rows, so no other test's range or window reads them.
  test('keeps a ready Brazil cycle past its day until its box leaves, within the floor', async () => {
    await dataSource.query(`CREATE TABLE IF NOT EXISTS \`${courierTable}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
      stripe_invoice_id varchar(191) NOT NULL,
      status varchar(32) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    const subscription = async (id, account, country) => (await dataSource.query(
      `INSERT INTO \`${ledgerTable}\` (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_start, current_period_end, address)
       VALUES (7, 'keep@edenbowls.com', ?, 'cus_keep', ?, 'active', '2026-06-01 08:00:00', '2026-07-01 08:00:00', ?)`,
      [id, account, JSON.stringify({ country })]
    )).insertId;
    const brazil = await subscription('sub_keep_br', 'br', 'BR');
    const us = await subscription('sub_keep_us', 'us', 'US');
    const cycle = (subscriptionId, status, invoice, day) => dataSource.query(
      `INSERT INTO \`${cycleTable}\` (subscription_id, period_end, status, paid_at, paid_invoice_id, preparation_day, delivery_date) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [subscriptionId, `${day} 08:00:00`, status, `${day} 07:00:00`, invoice, day, day]
    );
    await cycle(brazil, 'ready', 'in_keep_wait', '2026-06-06');
    await cycle(brazil, 'ready', 'in_keep_road', '2026-06-07');
    await cycle(brazil, 'ready', 'in_keep_old', '2026-05-30');
    await cycle(brazil, 'in_production', 'in_keep_kitchen', '2026-05-01');
    await cycle(us, 'ready', 'in_keep_us', '2026-06-08');
    await dataSource.query(`INSERT INTO \`${courierTable}\` (stripe_invoice_id, status) VALUES ('in_keep_road', 'out_for_delivery')`);

    const keeping = new SubscriptionLedgerRepository(dataSource, {
      tableName: ledgerTable,
      usermetaTableName: usermetaTable,
      productionCyclesTableName: cycleTable,
      courierTableName: courierTable
    });
    const result = await keeping.listQueue({
      startOfToday: '2026-06-30 03:00:00',
      windowEndExclusive: '2026-07-07 03:00:00',
      overdueFloor: '2026-05-31 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 200
    });

    const mine = result.items
      // The unpaid renewals of these subscriptions sit in the window; only the paid cycles matter here.
      .filter((item) => ['sub_keep_br', 'sub_keep_us'].includes(item.stripeSubscriptionId) && item.paidInvoiceId)
      .map((item) => item.paidInvoiceId)
      .sort();
    // Waiting ready stays; on the road, past the floor and US leave; the paid one still in the kitchen stays.
    expect(mine).toEqual(['in_keep_kitchen', 'in_keep_wait']);

    // queue-overdue-filter-matches-metric: due=overdue lists the late kitchen work, ready only when asked for.
    const keptBounds = {
      startOfToday: '2026-06-30 03:00:00',
      windowEndExclusive: '2026-07-07 03:00:00',
      overdueFloor: '2026-05-31 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 200
    };
    const paidOf = (items) => items
      .filter((item) => ['sub_keep_br', 'sub_keep_us'].includes(item.stripeSubscriptionId) && item.paidInvoiceId)
      .map((item) => item.paidInvoiceId)
      .sort();
    const overdueOnly = await keeping.listQueue({ ...keptBounds, due: 'overdue' });
    expect(paidOf(overdueOnly.items)).toEqual(['in_keep_kitchen']);
    expect(overdueOnly.items.every((item) => item.productionStatus !== 'ready')).toBe(true);
    const overdueReady = await keeping.listQueue({ ...keptBounds, due: 'overdue', productionStatus: 'ready' });
    expect(paidOf(overdueReady.items)).toEqual(['in_keep_wait']);

    await dataSource.query(`INSERT INTO \`${courierTable}\` (stripe_invoice_id, status) VALUES ('in_keep_wait', 'delivered')`);
    const after = await keeping.listQueue({
      startOfToday: '2026-06-30 03:00:00',
      windowEndExclusive: '2026-07-07 03:00:00',
      overdueFloor: '2026-05-31 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 200
    });
    expect(after.items.map((item) => item.paidInvoiceId)).not.toContain('in_keep_wait');
  });
});
