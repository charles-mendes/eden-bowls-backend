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
    listConfigEvents: jest.fn(async ({ market }) => ({ events: [{ id: 3, market, action: 'shipping_settings.update' }], next_before: null }))
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
