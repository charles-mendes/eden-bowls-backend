const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { HttpError } = require('../src/core/http-error');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

function adminApp(overrides = {}) {
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue({
        userId: '7',
        email: 'admin@edenbowls.com',
        roles: ['admin'],
        permissions: ROLE_PERMISSIONS.admin
      })
    },
    ...overrides
  });
}

describe('admin shipping and coupon routes', () => {
  test('returns shipping settings for operators', async () => {
    const adminShippingService = {
      getSettings: jest.fn().mockReturnValue({
        success: true,
        data: { settings: { br: { enabled: true }, us: { cost: 12.9 } } }
      })
    };
    const app = adminApp({ adminShippingService });
    const response = await request(app)
      .get('/api/v1/admin/shipping/settings')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body.data.settings.us.cost).toBe(12.9);
  });

  test('saves shipping settings', async () => {
    const adminShippingService = {
      saveSettings: jest.fn().mockReturnValue({ success: true, data: { settings: { br: { enabled: false } } } })
    };
    const app = adminApp({ adminShippingService });
    const response = await request(app)
      .put('/api/v1/admin/shipping/settings')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ br: { enabled: false } });

    expect(response.status).toBe(200);
    expect(adminShippingService.saveSettings).toHaveBeenCalled();
  });

  test('returns first-purchase promo health', async () => {
    const stripeCouponService = {
      mappingHealth: jest.fn().mockResolvedValue({
        complete: false,
        missing_terms: [6],
        mapping: { 1: 'promo_a', 3: 'promo_b', 6: null },
        misconfig_count: 2
      }),
      envSlotsSet: jest.fn().mockReturnValue([1])
    };
    const app = adminApp({ stripeCouponService });
    const response = await request(app)
      .get('/api/v1/admin/stripe/first-purchase-promos')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body.missing_terms).toEqual([6]);
    expect(response.body.envSlots).toEqual([1]);
  });

  test('nutritionist cannot read shipping', async () => {
    const app = createApp({
      corsOrigins: ['http://localhost:5174'],
      jwt,
      adminIdentityService: {
        requireOperational: jest.fn().mockResolvedValue({
          userId: '9',
          email: 'nutri@edenbowls.com',
          roles: ['nutritionist'],
          permissions: ROLE_PERMISSIONS.nutritionist
        })
      }
    });
    const response = await request(app)
      .get('/api/v1/admin/shipping/settings')
      .set('Authorization', `Bearer ${tokenFor(9)}`);

    expect(response.status).toBe(403);
  });

  test('returns 422 from shipping test with code in body', async () => {
    const adminShippingService = {
      test: jest.fn().mockRejectedValue(new HttpError(422, 'Brazil distance shipping is disabled.', { code: 'shipping_disabled' }))
    };
    const app = adminApp({ adminShippingService });
    const response = await request(app)
      .post('/api/v1/admin/shipping/test')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ zipCode: '01310100', country: 'BR' });

    expect(response.status).toBe(422);
    expect(response.body.message).toContain('disabled');
  });
});
