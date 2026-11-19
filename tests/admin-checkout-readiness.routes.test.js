const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminCheckoutReadinessService } = require('../src/services/admin-checkout-readiness.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });

const identities = {
  admin: { userId: '7', roles: ['admin'], markets: ['BR'], permissions: [...ROLE_PERMISSIONS.admin, 'market.br'] },
  operator: { userId: '8', roles: ['operator'], markets: ['BR', 'US'], permissions: [...ROLE_PERMISSIONS.operator, 'market.br', 'market.us'] },
  readonly: { userId: '9', roles: ['readonly'], markets: ['BR', 'US'], permissions: [...ROLE_PERMISSIONS.readonly, 'market.br', 'market.us'] },
  veterinarian: { userId: '10', roles: ['veterinarian'], markets: ['BR', 'US'], permissions: [...ROLE_PERMISSIONS.veterinarian, 'market.br', 'market.us'] }
};

// Key-shaped fakes. The readiness service only learns whether each one is set.
const FAKE_ENV = {
  STRIPE_US_SECRET_KEY: 'sk_test_FAKEusREADINESS',
  STRIPE_BR_SECRET_KEY: 'sk_test_FAKEbrREADINESS',
  STRIPE_US_WEBHOOK_SECRET: 'whsec_FAKEusREADINESS',
  STRIPE_BR_WEBHOOK_SECRET: 'whsec_FAKEbrREADINESS',
  UPS_CLIENT_ID: 'FAKE-ups-client-id-READINESS',
  UPS_CLIENT_SECRET: 'FAKE-ups-client-secret-READINESS'
};

function appFor(identity) {
  const upsClient = {
    clientId: FAKE_ENV.UPS_CLIENT_ID,
    clientSecret: FAKE_ENV.UPS_CLIENT_SECRET,
    isConfigured() {
      return Boolean(this.clientId && this.clientSecret);
    }
  };
  const adminCheckoutReadinessService = new AdminCheckoutReadinessService({
    adminCatalogService: { health: jest.fn(async ({ market }) => ({ market, stripe_account: { status: market === 'US' ? 'prices_missing' : 'ok', current_account_id: 'acct_LOCALUS' } })) },
    stripeCouponService: { checkoutReadiness: jest.fn(async (account) => ({ stripe_account: account, missing_terms: [], unverified: false })) },
    shippingService: {
      settings: { br: { center: { lat: -25.4, lng: -49.2 } }, us: {} },
      usCheckoutReadiness: jest.fn(async () => ({ ups_configured: upsClient.isConfigured(), code: null, unverified: false }))
    },
    stripeBrEnabled: true,
    stripeSecretKeyPresent: { BR: Boolean(FAKE_ENV.STRIPE_BR_SECRET_KEY), US: Boolean(FAKE_ENV.STRIPE_US_SECRET_KEY) }
  });
  jest.spyOn(adminCheckoutReadinessService, 'read');
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    adminCheckoutReadinessService
  });
  return { app, adminCheckoutReadinessService };
}

const PATH = '/api/v1/admin/checkout/readiness';

describe(`GET ${PATH}`, () => {
  test('requires a token', async () => {
    const { app } = appFor(identities.admin);
    expect((await request(app).get(PATH)).status).toBe(401);
  });

  test.each(['operator', 'readonly', 'veterinarian'])('forbids %s', async (role) => {
    const { app, adminCheckoutReadinessService } = appFor(identities[role]);
    const response = await request(app).get(PATH).set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(403);
    expect(adminCheckoutReadinessService.read).not.toHaveBeenCalled();
  });

  test('answers an admin with both markets, even one who works only in Brazil', async () => {
    const { app } = appFor(identities.admin);
    const response = await request(app).get(PATH).set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.config).toEqual({ stripe_br_enabled: true, stripe_secret_key_present: { BR: true, US: true }, ups_configured: true });
    expect(response.body.warnings).toEqual([expect.objectContaining({ code: 'catalog_prices_missing', market: 'US' })]);
  });

  test('the response carries no key, secret or credential', async () => {
    const { app } = appFor(identities.admin);
    const body = JSON.stringify((await request(app).get(PATH).set('Authorization', `Bearer ${token()}`)).body);

    for (const value of Object.values(FAKE_ENV)) {
      expect(body).not.toContain(value);
    }
    expect(body).not.toMatch(/sk_|rk_|pk_|whsec_/);
  });
});
