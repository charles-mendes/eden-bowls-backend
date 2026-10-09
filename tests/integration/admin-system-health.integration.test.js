const request = require('supertest');
const { createScratchDatabase } = require('./helpers/scratch-database');
const { createApp } = require('../../src/app');
const { issueJwtToken } = require('../../src/core/jwt-token');
const { AuthRepository } = require('../../src/infrastructure/repositories/auth.repository');
const { MarketConflictsRepository } = require('../../src/infrastructure/repositories/market-conflicts.repository');
const { StripeWebhookEventsRepository } = require('../../src/infrastructure/repositories/stripe-webhook-events.repository');
const { AdminIdentityService } = require('../../src/services/admin-identity.service');
const { AdminSystemHealthService } = require('../../src/services/admin-system-health.service');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

const jwt = { secret: 'it-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const ADMIN_ID = 101;
const OPERATOR_ID = 102;
const CUSTOMER_ID = 201;

function tokenFor(userId) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

// HTTP → bearer → admin permission middleware → service → repositories → MySQL, with nothing faked:
// roles come from wp_usermeta like in production.
describeIntegration('admin system health routes (MySQL)', () => {
  const now = new Date();
  const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000);
  let db;
  let app;

  async function addUser(id, email, meta = {}) {
    await db.query(
      'INSERT INTO `wp_users` (`ID`, `user_login`, `user_pass`, `user_nicename`, `user_email`) VALUES (?, ?, ?, ?, ?)',
      [id, email, 'x', email, email]
    );
    for (const [key, value] of Object.entries(meta)) {
      await db.query('INSERT INTO `wp_usermeta` (`user_id`, `meta_key`, `meta_value`) VALUES (?, ?, ?)', [id, key, value]);
    }
  }

  async function addEvent({ id, account, type, createdAt, processedAt = null, failedAt = null }) {
    await db.query(
      'INSERT INTO `stripe_webhook_events` (`event_id`, `stripe_account`, `type`, `created_at`, `processed_at`, `failed_at`, `attempts`) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [id, account, type, createdAt, processedAt, failedAt]
    );
  }

  const get = (path, userId) => {
    const call = request(app).get(path);
    return userId ? call.set('Authorization', `Bearer ${tokenFor(userId)}`) : call;
  };

  beforeAll(async () => {
    db = await createScratchDatabase('health', ['wp_users', 'wp_usermeta', 'stripe_subscriptions', 'stripe_webhook_events']);
    const authRepository = new AuthRepository(db.dataSource);
    app = createApp({
      corsOrigins: ['http://localhost:5174'],
      jwt,
      adminIdentityService: new AdminIdentityService({ authRepository }),
      adminSystemHealthService: new AdminSystemHealthService({
        marketConflictsRepository: new MarketConflictsRepository(db.dataSource),
        webhookEventsRepository: new StripeWebhookEventsRepository(db.dataSource),
        now: () => now
      })
    });
    await addUser(ADMIN_ID, 'admin@edenbowls.com', { _eden_admin_roles: '["admin"]' });
    await addUser(OPERATOR_ID, 'ops@edenbowls.com', { _eden_admin_roles: '["operator"]', _eden_admin_markets: '["BR","US"]' });
  });

  afterAll(async () => {
    await db.drop();
  });

  describe('GET /api/v1/admin/markets/conflicts', () => {
    const path = '/api/v1/admin/markets/conflicts';

    afterEach(async () => {
      await db.query('DELETE FROM `stripe_subscriptions`');
      await db.query('DELETE FROM `wp_usermeta` WHERE `user_id` = ?', [CUSTOMER_ID]);
      await db.query('DELETE FROM `wp_users` WHERE `ID` = ?', [CUSTOMER_ID]);
    });

    test('rejects a request without a token', async () => {
      expect((await get(path)).status).toBe(401);
    });

    test('forbids an operator', async () => {
      const response = await get(path, OPERATOR_ID);
      expect(response.status).toBe(403);
      expect(response.body.items).toBeUndefined();
    });

    test('returns an empty page when nothing conflicts', async () => {
      const response = await get(path, ADMIN_ID);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ total: 0, page: 1, perPage: 20, totalPages: 1, items: [] });
    });

    test('lists a customer whose profile market disagrees with the Stripe account', async () => {
      await addUser(CUSTOMER_ID, 'ana@example.com', { hsr_market_country: 'BR' });
      for (const id of ['sub_it_a', 'sub_it_b']) {
        await db.query(
          'INSERT INTO `stripe_subscriptions` (`user_id`, `stripe_subscription_id`, `stripe_customer_id`, `status`, `stripe_account`) VALUES (?, ?, ?, ?, ?)',
          [CUSTOMER_ID, id, 'cus_it', 'active', 'us']
        );
      }

      const response = await get(path, ADMIN_ID);
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.items).toEqual([
        { userId: String(CUSTOMER_ID), email: 'ana@example.com', profileMarket: 'BR', stripeAccount: 'us' }
      ]);
    });
  });

  describe('GET /api/v1/admin/billing/webhooks/health', () => {
    const path = '/api/v1/admin/billing/webhooks/health';

    afterEach(async () => {
      await db.query('DELETE FROM `stripe_webhook_events`');
    });

    test('rejects a request without a token', async () => {
      expect((await get(path)).status).toBe(401);
    });

    test('forbids an operator', async () => {
      expect((await get(path, OPERATOR_ID)).status).toBe(403);
    });

    test('reports no_events for both accounts on an empty inbox', async () => {
      const response = await get(path, ADMIN_ID);
      expect(response.status).toBe(200);
      expect(response.body.staleAfterHours).toBe(72);
      expect(response.body.accounts.map((entry) => [entry.account, entry.status])).toEqual([['br', 'no_events'], ['us', 'no_events']]);
    });

    test('derives each account status from the stored events', async () => {
      await addEvent({ id: 'evt_br_old_fail', account: 'br', type: 'invoice.payment_failed', createdAt: hoursAgo(31), failedAt: hoursAgo(30) });
      await addEvent({ id: 'evt_br_fail', account: 'br', type: 'invoice.paid', createdAt: hoursAgo(6), failedAt: hoursAgo(5) });
      await addEvent({ id: 'evt_br_new', account: 'br', type: 'customer.subscription.updated', createdAt: hoursAgo(1 / 6), processedAt: hoursAgo(1 / 6) });
      await addEvent({ id: 'evt_us_old', account: 'us', type: 'invoice.created', createdAt: hoursAgo(5), processedAt: hoursAgo(5) });
      await addEvent({ id: 'evt_us_new', account: 'us', type: 'invoice.paid', createdAt: hoursAgo(2), processedAt: hoursAgo(2) });

      const response = await get(path, ADMIN_ID);
      expect(response.status).toBe(200);
      const [br, us] = response.body.accounts;

      expect(br).toMatchObject({ account: 'br', status: 'attention', lastEventType: 'customer.subscription.updated', failedLast24h: 1, pendingOverdue: 0 });
      expect(us).toMatchObject({ account: 'us', status: 'ok', lastEventType: 'invoice.paid', failedLast24h: 0, pendingOverdue: 0 });
      expect(Math.abs(new Date(us.lastEventAt).getTime() - hoursAgo(2).getTime())).toBeLessThan(1000);
    });

    test('flags silence over 72 hours and events stuck for over an hour', async () => {
      await addEvent({ id: 'evt_br_silent', account: 'br', type: 'invoice.paid', createdAt: hoursAgo(80), processedAt: hoursAgo(80) });
      await addEvent({ id: 'evt_us_stuck', account: 'us', type: 'invoice.paid', createdAt: hoursAgo(2) });

      const [br, us] = (await get(path, ADMIN_ID)).body.accounts;

      expect(br).toMatchObject({ status: 'attention', failedLast24h: 0, pendingOverdue: 0 });
      expect(us).toMatchObject({ status: 'attention', pendingOverdue: 1 });
    });
  });
});
