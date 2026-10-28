const { DataSource } = require('typeorm');
const { createAdminPackStockService, createAdminProductionService } = require('../../src/config/production-services');
const { PackStockRepository } = require('../../src/infrastructure/repositories/pack-stock.repository');
const { SubscriptionLedgerRepository } = require('../../src/infrastructure/repositories/subscription-ledger.repository');
const { SubscriptionProductionRepository } = require('../../src/infrastructure/repositories/subscription-production.repository');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('pack stock (MySQL)', () => {
  const suffix = Date.now();
  const tables = {
    items: `it_${suffix}_pack_stock_items`,
    movements: `it_${suffix}_pack_stock_movements`,
    ledger: `it_${suffix}_stock_stripe_subscriptions`,
    cycles: `it_${suffix}_stock_production_cycles`,
    usermeta: `it_${suffix}_stock_usermeta`
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

  const periodEnd = new Date('2026-10-20T08:00:00.000Z');
  let ledger;
  let production;

  function stockRepository(options = {}) {
    return new PackStockRepository(dataSource, {
      itemsTableName: tables.items,
      movementsTableName: tables.movements,
      ...options
    });
  }

  function wire(stock) {
    const now = () => new Date('2026-10-19T15:00:00.000Z');
    const packStockService = createAdminPackStockService({ stockRepository: stock, ledgerRepository: ledger, logger: { warn: jest.fn() }, now });
    return createAdminProductionService({ ledgerRepository: ledger, productionRepository: production, packStockService, now });
  }

  async function balanceAndSum(flavorKey) {
    const [row] = await dataSource.query(
      `SELECT i.on_hand, COALESCE(SUM(m.quantity), 0) AS total FROM \`${tables.items}\` i
        LEFT JOIN \`${tables.movements}\` m ON m.item_id = i.id
        WHERE i.market = 'BR' AND i.flavor_key = ? AND i.pack_size_grams = 300 GROUP BY i.id, i.on_hand`,
      [flavorKey]
    );
    return { onHand: Number(row.on_hand), sum: Number(row.total) };
  }

  async function paidCycle(stripeSubscriptionId, quantity) {
    await dataSource.query(
      `INSERT INTO \`${tables.ledger}\`
        (user_id, customer_email, stripe_subscription_id, stripe_customer_id, stripe_account, status,
         current_period_start, current_period_end, cancel_at_period_end, subscription_term_months, plan_selection)
       VALUES (7, 'ana@example.com', ?, 'cus_1', 'br', 'active', ?, ?, 0, 3, ?)`,
      [
        stripeSubscriptionId,
        new Date(periodEnd.getTime() - 30 * 86400000),
        new Date(periodEnd.getTime() + 30 * 86400000),
        JSON.stringify({ catalog_pricing: { line_items: [{ flavor: 'frango', quantity, pack_size_grams: 300 }] } })
      ]
    );
    const [row] = await dataSource.query(`SELECT id FROM \`${tables.ledger}\` WHERE stripe_subscription_id = ?`, [stripeSubscriptionId]);
    await dataSource.query(
      `INSERT INTO \`${tables.cycles}\` (subscription_id, period_end, status, paid_at) VALUES (?, ?, 'in_production', ?)`,
      [row.id, periodEnd, new Date(periodEnd.getTime() + 60000)]
    );
    return row.id;
  }

  beforeAll(async () => {
    await dataSource.initialize();
    await dataSource.query(`CREATE TABLE \`${tables.items}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT, market varchar(8) NOT NULL, flavor_key varchar(64) NOT NULL,
      pack_size_grams int unsigned NOT NULL, on_hand int NOT NULL DEFAULT 0, min_level int unsigned NULL,
      created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uniq_pack_stock_item (market, flavor_key, pack_size_grams)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dataSource.query(`CREATE TABLE \`${tables.movements}\` (
      id bigint unsigned NOT NULL AUTO_INCREMENT, item_id bigint unsigned NOT NULL, type varchar(32) NOT NULL,
      quantity int NOT NULL, reason varchar(16) NULL, note varchar(255) NULL, production_cycle_id int unsigned NULL,
      subscription_id int unsigned NULL, actor_user_id bigint unsigned NULL, created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_item_created (item_id, created_at), KEY idx_cycle (production_cycle_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dataSource.query(`CREATE TABLE \`${tables.ledger}\` LIKE \`stripe_subscriptions\``);
    await dataSource.query(`CREATE TABLE \`${tables.cycles}\` LIKE \`subscription_production_cycles\``);
    await dataSource.query(`CREATE TABLE \`${tables.usermeta}\` (
      umeta_id bigint unsigned NOT NULL AUTO_INCREMENT, user_id bigint unsigned NOT NULL,
      meta_key varchar(255) NULL, meta_value longtext NULL, PRIMARY KEY (umeta_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    ledger = new SubscriptionLedgerRepository(dataSource, {
      tableName: tables.ledger,
      usermetaTableName: tables.usermeta,
      productionCyclesTableName: tables.cycles
    });
    production = new SubscriptionProductionRepository(dataSource, { tableName: tables.cycles });
  });

  afterAll(async () => {
    if (dataSource.isInitialized) {
      for (const table of Object.values(tables)) {
        await dataSource.query(`DROP TABLE IF EXISTS \`${table}\``);
      }
      await dataSource.destroy();
    }
  });

  test('Balance after mixed movements', async () => {
    const stock = stockRepository();
    const key = { market: 'BR', flavorKey: 'carne', packSizeGrams: 300 };
    await stock.transaction((manager) => stock.applyMovements(manager, [{ ...key, type: 'production', quantity: 40 }]));
    await stock.transaction((manager) => stock.applyMovements(manager, [{ ...key, type: 'separation', quantity: -12, productionCycleId: 999 }]));
    await stock.transaction((manager) => stock.applyMovements(manager, [{ ...key, type: 'adjustment', quantity: -3, reason: 'loss' }]));

    expect(await balanceAndSum('carne')).toEqual({ onHand: 25, sum: 25 });
    const history = await stock.listMovements(key, { perPage: 20, offset: 0 });
    expect(history.total).toBe(3);
    expect(history.items.map((item) => item.type)).toEqual(['adjustment', 'separation', 'production']);
  });

  test('separating, returning and separating again a paid cycle keeps balance and history right', async () => {
    const stock = stockRepository();
    await stock.transaction((manager) => stock.applyMovements(manager, [{ market: 'BR', flavorKey: 'frango', packSizeGrams: 300, type: 'production', quantity: 10 }]));
    const id = await paidCycle('sub_stock_cycle', 4);
    const admin = wire(stock);
    const move = (status) => admin.updateStatus(id, { status, periodEnd: periodEnd.toISOString() }, { userId: 1 });

    expect((await move('ready')).productionStatus).toBe('ready');
    expect((await balanceAndSum('frango')).onHand).toBe(6);
    await move('in_production');
    expect((await balanceAndSum('frango')).onHand).toBe(10);
    await move('ready');

    expect(await balanceAndSum('frango')).toEqual({ onHand: 6, sum: 6 });
    const history = await stock.listMovements({ market: 'BR', flavorKey: 'frango', packSizeGrams: 300 }, { perPage: 20, offset: 0 });
    expect(history.items.map((item) => [item.type, item.quantity])).toEqual([
      ['separation', -4], ['separation_reversal', 4], ['separation', -4], ['production', 10]
    ]);
  });

  test('a failed movement also undoes the status change', async () => {
    const stock = stockRepository();
    const id = await paidCycle('sub_stock_failure', 2);
    stock.applyMovements = jest.fn().mockRejectedValue(new Error('disk full'));

    await expect(wire(stock).updateStatus(id, { status: 'ready', periodEnd: periodEnd.toISOString() }, { userId: 1 }))
      .rejects.toThrow('disk full');

    expect((await production.findBySubscriptionAndPeriodEnd(id, periodEnd)).status).toBe('in_production');
  });

  test('without the stock tables, marking ready still works and the queue shows no coverage', async () => {
    const stock = stockRepository({ itemsTableName: `${tables.items}_dropped`, movementsTableName: `${tables.movements}_dropped` });
    const id = await paidCycle('sub_stock_dropped', 3);
    const admin = wire(stock);

    const result = await admin.updateStatus(id, { status: 'ready', periodEnd: periodEnd.toISOString() }, { userId: 1 });

    expect(result.productionStatus).toBe('ready');
    expect(result.stock).toEqual({ shortages: [], unsized: 0 });
    const queue = await admin.listQueue({ windowDays: 30, includeOverdue: true }, { page: 1, perPage: 50, offset: 0 });
    expect(queue.items.length).toBeGreaterThan(0);
    expect(queue.items.every((item) => item.stockCoverage === null)).toBe(true);
  });
});
