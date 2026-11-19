const { createScratchDatabase } = require('./helpers/scratch-database');
const { CreateCustomerPurchaseTrail1700000000090 } = require('../../src/infrastructure/migrations/1700000000090-create-customer-purchase-trail');
const { CustomerPurchaseTrailRepository } = require('../../src/infrastructure/repositories/customer-purchase-trail.repository');
const { CustomerPurchaseTrailService } = require('../../src/services/customer-purchase-trail.service');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

const NOW = new Date('2026-11-19T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * 60 * 60 * 1000);

// purchase-error-monitor
describeIntegration('purchase trail failures (MySQL)', () => {
  let db;
  let service;
  let nextCorrelation = 1;

  async function attempt({ userId = 5, market = 'br', area = 'checkout', status = 'in_progress', startedAt, finishedAt = null, errorCode = null, email = 'c@example.com' }) {
    const correlation = `00000000-0000-4000-8000-${String(nextCorrelation++).padStart(12, '0')}`;
    const result = await db.query(
      'INSERT INTO `customer_purchase_attempts` (`user_id`, `market`, `email`, `correlation_id`, `area`, `status`, `error_code`, `started_at`, `finished_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, market, email, correlation, area, status, errorCode, startedAt, finishedAt]
    );
    return result.insertId;
  }

  async function event({ attemptRowId = null, userId = 5, market = 'br', area = 'checkout', step, outcome = 'failed', errorCode = null, createdAt, stripeEventId = null }) {
    const result = await db.query(
      'INSERT INTO `customer_purchase_events` (`attempt_row_id`, `user_id`, `market`, `area`, `step`, `outcome`, `error_code`, `stripe_event_id`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [attemptRowId, userId, market, area, step, outcome, errorCode, stripeEventId, createdAt]
    );
    return result.insertId;
  }

  beforeAll(async () => {
    db = await createScratchDatabase('purchase_failures', []);
    const runner = db.dataSource.createQueryRunner();
    await new CreateCustomerPurchaseTrail1700000000090().up(runner);
    await runner.release();
    service = new CustomerPurchaseTrailService({ repository: new CustomerPurchaseTrailRepository(db.dataSource), now: () => NOW });
  });

  afterAll(async () => {
    await db.drop();
  });

  beforeEach(async () => {
    await db.query('DELETE FROM `customer_purchase_events`');
    await db.query('DELETE FROM `customer_purchase_attempts`');
  });

  test('a zipcode error that later paid shows as paid with the zipcode step; a clean attempt stays out', async () => {
    const paid = await attempt({ status: 'paid', startedAt: ago(1, 2), finishedAt: ago(1) });
    await event({ attemptRowId: paid, step: 'zipcode_lookup', errorCode: 'invalid_zipcode', createdAt: ago(1, 1) });
    await event({ attemptRowId: paid, step: 'payment_intent_ack', outcome: 'ok', createdAt: ago(1) });
    const clean = await attempt({ status: 'paid', startedAt: ago(1, 3), finishedAt: ago(1, 3) });
    await event({ attemptRowId: clean, step: 'address', outcome: 'ok', createdAt: ago(1, 3) });

    const result = await service.listFailures({ market: 'br' });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ kind: 'attempt', attempt_status: 'paid', step: 'zipcode_lookup', error_code: 'invalid_zipcode', email: 'c@example.com' });
    expect(result.rows[0].events).toHaveLength(2);
  });

  test('an attempt started 8 days ago, still in progress, with an ack failed yesterday is in the default 7 days', async () => {
    const open = await attempt({ startedAt: ago(8) });
    await event({ attemptRowId: open, step: 'payment_intent_ack', errorCode: 'payment_intent_mismatch', createdAt: ago(1) });
    const result = await service.listFailures({ market: 'br' });
    expect(result.rows.map((row) => [row.step, row.attempt_status])).toEqual([['payment_intent_ack', 'in_progress']]);
    expect(result.rows[0].occurred_at).toBe(ago(1).toISOString());
  });

  test('a failed attempt with no failed step is dated by finished_at', async () => {
    await attempt({ status: 'failed', errorCode: 'stripe_subscription_failed', startedAt: ago(10), finishedAt: ago(2) });
    const result = await service.listFailures({ market: 'br' });
    expect(result.rows[0]).toMatchObject({ attempt_status: 'failed', error_code: 'stripe_subscription_failed', occurred_at: ago(2).toISOString() });
  });

  test('US failures never show in BR; an unclaimed US webhook shows without customer', async () => {
    const us = await attempt({ market: 'us', startedAt: ago(1) });
    await event({ attemptRowId: us, market: 'us', step: 'shipping', errorCode: 'shipping_unavailable', createdAt: ago(1) });
    await event({ market: 'us', userId: null, area: 'webhook', step: 'customer_not_resolved', errorCode: 'customer_not_resolved', createdAt: ago(0, 5), stripeEventId: 'evt_1' });
    expect((await service.listFailures({ market: 'br' })).rows).toHaveLength(0);
    const usRows = (await service.listFailures({ market: 'us' })).rows;
    expect(usRows.map((row) => row.kind)).toEqual(['webhook', 'attempt']);
    expect(usRows[0]).toMatchObject({ user_id: null, email: null, attempt_status: null, area: 'webhook' });
  });

  test('area=webhook keeps only unclaimed webhook events, not a checkout attempt with a failed webhook step', async () => {
    const checkout = await attempt({ startedAt: ago(1) });
    await event({ attemptRowId: checkout, area: 'webhook', step: 'payment_failed', errorCode: 'invoice_payment_failed', createdAt: ago(1), stripeEventId: 'evt_2' });
    await event({ area: 'webhook', step: 'webhook_failed', errorCode: 'dispatch_failed', createdAt: ago(1), stripeEventId: 'evt_3' });
    const webhook = await service.listFailures({ market: 'br', area: 'webhook' });
    expect(webhook.rows.map((row) => [row.kind, row.step])).toEqual([['webhook', 'webhook_failed']]);
    const checkoutRows = await service.listFailures({ market: 'br', area: 'checkout' });
    expect(checkoutRows.rows.map((row) => [row.kind, row.area])).toEqual([['attempt', 'checkout']]);
  });

  test('an error code filter shows that code, even with a later different failure', async () => {
    const row = await attempt({ status: 'failed', errorCode: 'card_declined', startedAt: ago(1, 3), finishedAt: ago(1) });
    await event({ attemptRowId: row, step: 'zipcode_lookup', errorCode: 'invalid_zipcode', createdAt: ago(1, 2) });
    await event({ attemptRowId: row, step: 'confirm_card_payment', errorCode: 'card_declined', createdAt: ago(1) });
    const filtered = await service.listFailures({ market: 'br', errorCode: 'invalid_zipcode' });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]).toMatchObject({ step: 'zipcode_lookup', error_code: 'invalid_zipcode', attempt_status: 'failed' });
    const unfiltered = await service.listFailures({ market: 'br' });
    expect(unfiltered.rows[0]).toMatchObject({ step: 'confirm_card_payment', error_code: 'card_declined' });
  });

  test('rows on the same instant across a page boundary appear once each', async () => {
    const instant = ago(1);
    const ids = [];
    for (let index = 0; index < 3; index += 1) {
      const id = await attempt({ startedAt: instant });
      ids.push(id);
      await event({ attemptRowId: id, step: 'shipping', errorCode: 'x', createdAt: instant });
    }
    await event({ area: 'webhook', step: 'webhook_failed', errorCode: 'y', createdAt: instant, stripeEventId: 'evt_9' });
    const first = await service.listFailures({ market: 'br', limit: 2 });
    expect(first.next_before).toBeTruthy();
    const second = await service.listFailures({ market: 'br', limit: 2, before: first.next_before });
    const seen = [...first.rows, ...second.rows].map((row) => `${row.kind}:${row.kind === 'attempt' ? row.attempt.id : row.occurred_at}`);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(second.next_before).toBeNull();
  });

  test('config events: outcome=failed in the period finds a failure behind 50 newer successes; no filter answers as before', async () => {
    await db.query('DELETE FROM `customer_purchase_config_events`');
    await db.query('INSERT INTO `customer_purchase_config_events` (`market`, `action`, `outcome`, `error_code`, `created_at`) VALUES (?, ?, ?, ?, ?)', ['br', 'shipping_settings.update', 'failed', 'invalid_fee', ago(3)]);
    for (let index = 0; index < 50; index += 1) {
      await db.query('INSERT INTO `customer_purchase_config_events` (`market`, `action`, `outcome`, `created_at`) VALUES (?, ?, ?, ?)', ['br', 'catalog.sync', 'ok', ago(2)]);
    }
    const plain = await service.listConfigEvents({ market: 'br', limit: 50 });
    expect(plain.events.every((item) => item.outcome === 'ok')).toBe(true);
    const failed = await service.listConfigEvents({ market: 'br', limit: 50, outcome: 'failed', from: ago(7).toISOString(), to: NOW.toISOString() });
    expect(failed.events.map((item) => item.error_code)).toEqual(['invalid_fee']);
  });
});
