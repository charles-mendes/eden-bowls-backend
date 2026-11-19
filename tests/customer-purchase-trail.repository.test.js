const { CustomerPurchaseTrailRepository } = require('../src/infrastructure/repositories/customer-purchase-trail.repository');
const { CreateCustomerPurchaseTrail1700000000090 } = require('../src/infrastructure/migrations/1700000000090-create-customer-purchase-trail');

const squash = (sql) => sql.replace(/\s+/g, ' ').trim();

function dataSource(results = []) {
  const queue = [...results];
  return {
    isInitialized: true,
    query: jest.fn(async () => (queue.length ? queue.shift() : []))
  };
}

// customer-purchase-trail
describe('CustomerPurchaseTrailRepository', () => {
  test('opens one attempt per user, market and correlation, filling later columns without erasing them', async () => {
    const ds = dataSource([{ insertId: 7 }]);
    const id = await new CustomerPurchaseTrailRepository(ds).openAttempt({
      user_id: 5, market: 'br', correlation_id: 'c', area: 'plan', term_months: 3
    });
    expect(id).toBe(7);
    const [sql, params] = ds.query.mock.calls[0];
    expect(squash(sql)).toContain('ON DUPLICATE KEY UPDATE `id` = LAST_INSERT_ID(`id`)');
    expect(squash(sql)).toContain('`term_months` = COALESCE(VALUES(`term_months`), `term_months`)');
    expect(params.slice(0, 4)).toEqual([5, 'br', 'c', 'plan']);
  });

  test('a transition never replaces paid, and paid clears the error columns', async () => {
    const ds = dataSource([{ affectedRows: 1 }, { affectedRows: 0 }]);
    const repository = new CustomerPurchaseTrailRepository(ds);
    await repository.transitionAttempt(3, 'paid', { final_step: 'payment_intent_ack' });
    await repository.transitionAttempt(3, 'failed', { final_step: 'x', error_code: 'card_declined' });
    expect(squash(ds.query.mock.calls[0][0])).toContain("WHERE `id` = ? AND `status` <> 'paid'");
    expect(squash(ds.query.mock.calls[0][0])).toContain('`error_code` = NULL');
    expect(ds.query.mock.calls[0][1]).toEqual(['paid', 'payment_intent_ack', 3]);
    expect(ds.query.mock.calls[1][1]).toContain('card_declined');
  });

  test('events are INSERT IGNORE so a redelivered webhook writes once', async () => {
    const ds = dataSource([{ affectedRows: 0 }]);
    const inserted = await new CustomerPurchaseTrailRepository(ds).insertEvent({ market: 'us', area: 'webhook', step: 's', outcome: 'failed' });
    expect(inserted).toBe(0);
    expect(ds.query.mock.calls[0][0]).toMatch(/^INSERT IGNORE INTO `customer_purchase_events`/);
  });

  test('lists one market of one customer, with at most 50 events per attempt', async () => {
    const ds = dataSource([
      [{ id: 9, user_id: 5, market: 'us', correlation_id: 'c', area: 'checkout', status: 'failed', started_at: new Date('2026-11-01T00:00:00Z') }],
      [{ id: 1, attempt_row_id: 9, user_id: 5, market: 'us', area: 'checkout', step: 'shipping', outcome: 'failed', error_code: 'x' }],
      []
    ]);
    const result = await new CustomerPurchaseTrailRepository(ds).listForCustomer({ userId: 5, market: 'us', limit: 20 });
    expect(ds.query.mock.calls[0][1]).toEqual([5, 'us', 20]);
    expect(squash(ds.query.mock.calls[0][0])).toContain('WHERE `user_id` = ? AND `market` = ?');
    expect(ds.query.mock.calls[1][1]).toEqual([9, 'us', 50]);
    expect(result.attempts[0].events[0].error_code).toBe('x');
    expect(result.attempts[0].started_at).toBe('2026-11-01T00:00:00.000Z');
  });

  test('retention deletes in bounded batches from the three tables with one cutoff', async () => {
    const ds = dataSource([{ affectedRows: 2 }, { affectedRows: 1 }, { affectedRows: 0 }]);
    const cutoff = new Date('2026-05-22T00:00:00Z');
    const result = await new CustomerPurchaseTrailRepository(ds).deleteOlderThan(cutoff, 1000);
    expect(result).toEqual({ attempts: 2, events: 1, config_events: 0 });
    for (const [sql, params] of ds.query.mock.calls) {
      expect(sql).toMatch(/^DELETE FROM `customer_purchase_/);
      expect(sql).toContain('LIMIT ?');
      expect(params).toEqual([cutoff, 1000]);
    }
    expect(ds.query.mock.calls.some(([sql]) => /market/.test(sql))).toBe(false);
  });
});

describe('CreateCustomerPurchaseTrail1700000000090', () => {
  function runner(exists = false) {
    return { hasTable: jest.fn(async () => exists), query: jest.fn(async () => undefined) };
  }

  test('creates the three tables with market not null and the customer and market indexes', async () => {
    const queryRunner = runner(false);
    await new CreateCustomerPurchaseTrail1700000000090().up(queryRunner);
    const sql = queryRunner.query.mock.calls.map(([statement]) => squash(statement));
    expect(sql).toHaveLength(3);
    expect(sql[0]).toContain("`market` ENUM('br','us') NOT NULL");
    expect(sql[0]).toContain('`user_id` BIGINT UNSIGNED NOT NULL');
    expect(sql[0]).toContain('UNIQUE KEY `uniq_cpa_user_market_correlation` (`user_id`, `market`, `correlation_id`)');
    expect(sql[0]).toContain('KEY `idx_cpa_user_market_started` (`user_id`, `market`, `started_at`)');
    expect(sql[0]).toContain('KEY `idx_cpa_market_status_started` (`market`, `status`, `started_at`)');
    expect(sql[0]).toContain('`attempt_id` VARCHAR(128) NULL');
    expect(sql[0]).toContain('`stripe_account` VARCHAR(8) NULL');
    expect(sql[1]).toContain('ON DELETE CASCADE');
    expect(sql[1]).toContain('UNIQUE KEY `uniq_cpe_stripe_event_step` (`stripe_event_id`, `step`)');
    expect(sql[2]).not.toContain('user_id');
  });

  test('is idempotent and down drops the tables', async () => {
    const existing = runner(true);
    await new CreateCustomerPurchaseTrail1700000000090().up(existing);
    expect(existing.query).not.toHaveBeenCalled();
    await new CreateCustomerPurchaseTrail1700000000090().down(existing);
    expect(existing.query.mock.calls.map(([sql]) => sql)).toEqual([
      'DROP TABLE `customer_purchase_events`',
      'DROP TABLE `customer_purchase_config_events`',
      'DROP TABLE `customer_purchase_attempts`'
    ]);
  });
});
