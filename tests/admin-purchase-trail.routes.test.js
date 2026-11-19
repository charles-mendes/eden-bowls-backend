const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { HttpError } = require('../src/core/http-error');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { CustomerPurchaseTrailService } = require('../src/services/customer-purchase-trail.service');
const { StripeCouponService } = require('../src/services/stripe-coupon.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

function trailRepository() {
  const repository = {
    configEvents: [],
    insertConfigEvent: jest.fn(async (row) => { repository.configEvents.push(row); }),
    listForCustomer: jest.fn(async ({ market }) => ({
      attempts: [
        { id: 1, user_id: 5, market: 'br', status: 'failed', events: [] },
        { id: 2, user_id: 5, market: 'us', status: 'failed', events: [] }
      ].filter((row) => row.market === market),
      unlinked_events: [],
      next_before: null
    })),
    listConfigEvents: jest.fn(async ({ market }) => ({ events: [{ id: 3, market, action: 'shipping_settings.update' }], next_before: null })),
    listFailures: jest.fn(async ({ market, limit }) => ({
      rows: [
        { kind: 'attempt', id: 1, occurred_at: '2026-11-18T12:00:00.000Z', attempt: { id: 1, user_id: 5, market: 'br', email: 'c@example.com', area: 'checkout', status: 'paid', final_step: 'payment_intent_ack', error_code: null }, events: [{ id: 9, step: 'zipcode_lookup', outcome: 'failed', error_code: 'invalid_zipcode', http_status: 422, created_at: '2026-11-18T12:00:00.000Z' }] },
        { kind: 'webhook', id: 2, occurred_at: '2026-11-18T11:00:00.000Z', event: { id: 2, market: 'us', user_id: null, step: 'customer_not_resolved', outcome: 'failed', error_code: 'customer_not_resolved' } }
      ].filter((row) => (row.attempt || row.event).market === market),
      next: limit === 1 ? { t: '2026-11-18T12:00:00.000Z', k: 'attempt', id: 1 } : null
    }))
  };
  return repository;
}

function app({ roles = ['admin'], identity = null, repository = trailRepository(), adminIdentityService = null, ...services } = {}) {
  const customerPurchaseTrailService = new CustomerPurchaseTrailService({ repository });
  return {
    repository,
    app: createApp({
      corsOrigins: [],
      jwt,
      customerPurchaseTrailService,
      adminIdentityService: adminIdentityService || {
        requireOperational: jest.fn().mockResolvedValue(identity || {
          userId: '7',
          email: 'admin@edenbowls.com',
          roles,
          permissions: roles.flatMap((role) => ROLE_PERMISSIONS[role] || [])
        })
      },
      ...services
    })
  };
}

// customer-purchase-trail
describe('admin purchase trail', () => {
  test('a US attempt does not show in the BR list of the same customer', async () => {
    const { app: server, repository } = app();
    const br = await request(server).get('/api/v1/admin/users/5/purchase-trail?market=br').set('Authorization', `Bearer ${tokenFor()}`);
    expect(br.status).toBe(200);
    expect(br.body.data.market).toBe('br');
    expect(br.body.data.attempts.map((row) => row.id)).toEqual([1]);
    expect(repository.listForCustomer).toHaveBeenCalledWith({ userId: 5, market: 'br', limit: 20, before: null });
    const us = await request(server).get('/api/v1/admin/users/5/purchase-trail?market=us').set('Authorization', `Bearer ${tokenFor()}`);
    expect(us.body.data.attempts.map((row) => row.id)).toEqual([2]);
  });

  test('a missing or unknown market is 400, never every market of the staff', async () => {
    const { app: server, repository } = app();
    for (const query of ['', '?market=both', '?market=BR,US']) {
      const response = await request(server).get(`/api/v1/admin/users/5/purchase-trail${query}`).set('Authorization', `Bearer ${tokenFor()}`);
      expect([400, 403]).toContain(response.status);
    }
    const missing = await request(server).get('/api/v1/admin/purchase-trail/config-events').set('Authorization', `Bearer ${tokenFor()}`);
    expect(missing.status).toBe(400);
    expect(missing.body.details.code).toBe('market_required');
    expect(repository.listForCustomer).not.toHaveBeenCalled();
  });

  test('a market outside the staff scope is 403 market_forbidden', async () => {
    const { app: server } = app({
      identity: { userId: '8', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['US'] }
    });
    const response = await request(server).get('/api/v1/admin/users/5/purchase-trail?market=br').set('Authorization', `Bearer ${tokenFor(8)}`);
    expect(response.status).toBe(403);
  });

  test('readonly reads, a veterinarian does not', async () => {
    expect((await request(app({ roles: ['readonly'] }).app).get('/api/v1/admin/purchase-trail/config-events?market=us').set('Authorization', `Bearer ${tokenFor()}`)).status).toBe(200);
    expect((await request(app({ roles: ['veterinarian'] }).app).get('/api/v1/admin/purchase-trail/config-events?market=us').set('Authorization', `Bearer ${tokenFor()}`)).status).toBe(403);
  });

  test('a customer token does not read the admin list', async () => {
    const adminIdentityService = { requireOperational: jest.fn().mockRejectedValue(new HttpError(403, 'Forbidden.')) };
    const { app: server, repository } = app({ adminIdentityService });
    const withToken = await request(server).get('/api/v1/admin/users/5/purchase-trail?market=br').set('Authorization', `Bearer ${tokenFor(5)}`);
    const withoutToken = await request(server).get('/api/v1/admin/users/5/purchase-trail?market=br');
    expect(withToken.status).toBe(403);
    expect(withoutToken.status).toBe(401);
    expect(withToken.body.data).toBeUndefined();
    expect(repository.listForCustomer).not.toHaveBeenCalled();
  });
});

describe('purchase trail config events', () => {
  test('creating a coupon writes a config event of the market with no customer user id', async () => {
    const stripeCouponService = { createFirstPurchaseCoupon: jest.fn().mockResolvedValue({ success: true, data: { created: true } }) };
    const { app: server, repository } = app({ stripeCouponService });
    const response = await request(server)
      .post('/api/v1/admin/stripe/first-purchase-coupons?account=us')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ term_months: 3, code: 'FIRST3M30', percent_off: 30 });
    expect(response.status).toBe(200);
    await flush();
    expect(repository.configEvents).toEqual([{
      market: 'us', stripe_account: 'us', actor_admin_id: 7, action: 'first_purchase_coupon.create', target_ref: 'term_3', outcome: 'ok', error_code: null
    }]);
  });

  test('a refused change is written failed with its code', async () => {
    const adminShippingService = { saveSettings: jest.fn().mockRejectedValue(new HttpError(422, 'Bad fee.', { code: 'invalid_fee' })) };
    const { app: server, repository } = app({ adminShippingService });
    await request(server).put('/api/v1/admin/shipping/settings?market=br').set('Authorization', `Bearer ${tokenFor()}`).send({});
    await flush();
    expect(repository.configEvents).toHaveLength(1);
    expect(repository.configEvents[0]).toMatchObject({ market: 'br', action: 'shipping_settings.update', outcome: 'failed' });
  });

  test('the percent of a term keeps the operator audit and adds a config event', async () => {
    const repository = trailRepository();
    const auditRepository = { createIn: jest.fn().mockResolvedValue(undefined) };
    const termDiscounts = { savePercent: jest.fn().mockResolvedValue(undefined) };
    const service = new StripeCouponService({}, {
      termDiscounts,
      auditRepository,
      purchaseTrail: new CustomerPurchaseTrailService({ repository })
    });
    await service.saveTermPercent({ account: 'br', termMonths: 6, from: 30, to: 40, actor: { userId: '7', email: 'a@b.c' } });
    expect(auditRepository.createIn).toHaveBeenCalledWith(null, expect.objectContaining({ action: 'billing.first_purchase.percent.update' }));
    expect(repository.configEvents[0]).toMatchObject({ market: 'br', action: 'first_purchase_percent.update', target_ref: 'term_6' });
    expect(repository.configEvents[0]).not.toHaveProperty('user_id');
  });
});

// purchase-error-monitor
describe('purchase trail errors', () => {
  const NOW = new Date('2026-11-19T12:00:00Z');
  const errorsApp = app;
  const get = (server, query, user = 7) => request(server).get(`/api/v1/admin/purchase-trail/errors${query}`).set('Authorization', `Bearer ${tokenFor(user)}`);

  beforeEach(() => { jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] }); });
  afterEach(() => { jest.useRealTimers(); });

  test('lists one market; a US failure never shows in BR; the shown step is the failed one', async () => {
    const { app: server, repository } = errorsApp();
    const br = await get(server, '?market=br');
    expect(br.status).toBe(200);
    expect(br.body.data.rows).toHaveLength(1);
    expect(br.body.data.rows[0]).toMatchObject({ kind: 'attempt', market: 'br', attempt_status: 'paid', step: 'zipcode_lookup', error_code: 'invalid_zipcode', email: 'c@example.com' });
    expect(repository.listFailures).toHaveBeenCalledWith(expect.objectContaining({ market: 'br', limit: 50, area: null, errorCode: null, cursor: null }));
    const us = await get(server, '?market=us');
    expect(us.body.data.rows[0]).toMatchObject({ kind: 'webhook', user_id: null, email: null, attempt_status: null });
  });

  test('market is required and scoped', async () => {
    const { app: server, repository } = errorsApp();
    const missing = await get(server, '');
    expect(missing.status).toBe(400);
    expect(missing.body.details.code).toBe('market_required');
    const scoped = errorsApp({ identity: { userId: '8', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['US'] } });
    expect((await get(scoped.app, '?market=br', 8)).status).toBe(403);
    expect(repository.listFailures).not.toHaveBeenCalled();
  });

  test('area, period, limit and cursor are validated', async () => {
    const { app: server, repository } = errorsApp();
    expect((await get(server, '?market=br&area=coupon')).body.details.code).toBe('invalid_area');
    expect((await get(server, '?market=br&from=2026-01-01')).body.details.code).toBe('period_out_of_retention');
    expect((await get(server, '?market=br&from=2026-11-18&to=2026-11-10')).body.details.code).toBe('invalid_period');
    expect((await get(server, '?market=br&limit=101')).body.details.code).toBe('invalid_limit');
    expect((await get(server, '?market=br&before=not-a-cursor')).body.details.code).toBe('invalid_cursor');
    expect(repository.listFailures).not.toHaveBeenCalled();

    expect((await get(server, '?market=br&limit=100&area=webhook&error_code=invalid_zipcode')).status).toBe(200);
    expect(repository.listFailures).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100, area: 'webhook', errorCode: 'invalid_zipcode' }));
  });

  test('the next page goes back with the cursor it was given, not a number', async () => {
    const { app: server, repository } = errorsApp();
    const first = await get(server, '?market=br&limit=1');
    expect(first.body.data.next_before).toEqual(expect.any(String));
    await get(server, `?market=br&limit=1&before=${first.body.data.next_before}`);
    expect(repository.listFailures).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { t: new Date('2026-11-18T12:00:00.000Z'), k: 'attempt', id: 1 } }));
  });

  test('readonly reads, a veterinarian and a customer do not; no raw fields leave', async () => {
    const readonly = await get(errorsApp({ roles: ['readonly'] }).app, '?market=br');
    expect(readonly.status).toBe(200);
    const text = JSON.stringify(readonly.body);
    for (const field of ['body', 'headers', 'client_secret', 'payment_method', 'payload', 'cpf']) {
      expect(text).not.toContain(`"${field}"`);
    }
    expect((await get(errorsApp({ roles: ['veterinarian'] }).app, '?market=br')).status).toBe(403);
    const customer = errorsApp({ adminIdentityService: { requireOperational: jest.fn().mockRejectedValue(new HttpError(403, 'Forbidden.')) } });
    const denied = await get(customer.app, '?market=br', 5);
    expect(denied.status).toBe(403);
    expect(denied.body.data).toBeUndefined();
  });

  test('config events take outcome and period; without them the call is the one of before', async () => {
    const { app: server, repository } = errorsApp();
    await request(server).get('/api/v1/admin/purchase-trail/config-events?market=br').set('Authorization', `Bearer ${tokenFor()}`);
    expect(repository.listConfigEvents).toHaveBeenLastCalledWith({ market: 'br', limit: 50, before: null });
    await request(server).get('/api/v1/admin/purchase-trail/config-events?market=br&outcome=failed&from=2026-11-12&to=2026-11-19').set('Authorization', `Bearer ${tokenFor()}`);
    expect(repository.listConfigEvents).toHaveBeenLastCalledWith({ market: 'br', limit: 50, before: null, outcome: 'failed', from: new Date('2026-11-12T00:00:00Z'), to: new Date('2026-11-20T00:00:00Z') });
    const bad = await request(server).get('/api/v1/admin/purchase-trail/config-events?market=br&outcome=maybe').set('Authorization', `Bearer ${tokenFor()}`);
    expect(bad.body.details.code).toBe('invalid_outcome');
  });
});
