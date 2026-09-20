const { DataSource } = require('typeorm');
const { SubscriptionLedgerRepository } = require('../../src/infrastructure/repositories/subscription-ledger.repository');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('SubscriptionLedgerRepository production queue integration (MySQL)', () => {
  const suffix = Date.now();
  const ledgerTable = `it_${suffix}_stripe_subscriptions`;
  const cycleTable = `it_${suffix}_subscription_production_cycles`;
  const usersTable = `it_${suffix}_wp_users`;

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
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    repository = new SubscriptionLedgerRepository(dataSource, {
      tableName: ledgerTable
    });
    repository.queueJoinSql = function queueJoinSql() {
      return [
        `FROM \`${ledgerTable}\` s`,
        `LEFT JOIN \`${cycleTable}\` c ON c.subscription_id = s.id AND c.period_end = s.current_period_end`,
        `LEFT JOIN \`${usersTable}\` u ON u.ID = s.user_id`
      ].join(' ');
    };
  });

  afterAll(async () => {
    if (dataSource.isInitialized) {
      await dataSource.query(`DROP TABLE IF EXISTS \`${cycleTable}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${ledgerTable}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${usersTable}\``);
      await dataSource.destroy();
    }
  });

  test('includes the civil window, caps overdue, and excludes cancel-at-period-end', async () => {
    await dataSource.query(
      `INSERT INTO \`${usersTable}\` (ID, display_name) VALUES (7, 'Ana Costa')`
    );
    await dataSource.query(
      `INSERT INTO \`${ledgerTable}\`
        (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status, current_period_end, cancel_at_period_end)
       VALUES
        (7, 'ana@edenbowls.com', 'sub_today', 'cus_1', 'br', 'active', '2026-09-20 08:00:00', 0),
        (7, 'ana@edenbowls.com', 'sub_overdue', 'cus_2', 'br', 'past_due', '2026-09-17 08:00:00', 0),
        (7, 'ana@edenbowls.com', 'sub_old', 'cus_3', 'br', 'active', '2026-09-01 08:00:00', 0),
        (7, 'ana@edenbowls.com', 'sub_cape', 'cus_4', 'br', 'active', '2026-09-21 08:00:00', 1)`
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
  });
});
