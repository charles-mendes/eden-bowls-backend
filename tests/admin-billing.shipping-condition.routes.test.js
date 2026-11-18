const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminBillingService } = require('../src/services/admin-billing.service');

// customer-shipping-charge: the admin subscription detail shows the US shipping condition and the company's cost.
const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const usAddress = { country: 'US', street: '1 Market St', city: 'San Francisco', state: 'CA', zipcode: '94105', recipient_name: 'Ana Costa' };
const brAddress = { country: 'BR', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipcode: '80000-000', recipient_name: 'Ana Costa' };

function detailOf(row) {
  const item = { id: 200, userId: 9, customerEmail: 'ana@example.com', stripeSubscriptionId: 'sub_1', status: 'active', ...row };
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminBillingService: new AdminBillingService({
      ledgerRepository: { findById: jest.fn(async () => item) },
      stripeAccounts: { us: { secretKey: 'sk_test_us' }, br: { secretKey: 'sk_test_br' } }
    }),
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue({ userId: '7', email: 'admin@edenbowls.com', roles: ['admin'], permissions: ROLE_PERMISSIONS.admin })
    }
  });
  return request(app).get('/api/v1/admin/billing/subscriptions/200').set('Authorization', `Bearer ${token()}`);
}

describe('admin subscription detail › US shipping condition', () => {
  test('a free US subscription shows the company shipping cost', async () => {
    const response = await detailOf({
      stripeAccount: 'us',
      profileMarket: 'US',
      address: usAddress,
      shipping: { cost: 0, shipping_waived: true, company_cost: { amount: 18.4, currency: 'USD', source: 'ups' } }
    });

    expect(response.status).toBe(200);
    const body = response.body.data || response.body;
    expect(body.shipping_waived).toBe(true);
    expect(body.company_shipping_cost).toEqual({ amount: 18.4, currency: 'USD', source: 'ups' });
  });

  test('a charged US subscription shows no company cost', async () => {
    const response = await detailOf({ stripeAccount: 'us', profileMarket: 'US', address: usAddress, shipping: { cost: 18.4, shipping_waived: false } });
    const body = response.body.data || response.body;
    expect(body.shipping_waived).toBe(false);
    expect(body.company_shipping_cost).toBeNull();
  });

  test('a subscription created before the change and a BR one show no condition', async () => {
    const before = await detailOf({ stripeAccount: 'us', profileMarket: 'US', address: usAddress, shipping: { cost: 12.9 } });
    const br = await detailOf({ stripeAccount: 'br', profileMarket: 'BR', address: brAddress, shipping: { cost: 15 } });
    expect((before.body.data || before.body).shipping_waived).toBeNull();
    expect((br.body.data || br.body).shipping_waived).toBeNull();
    expect((br.body.data || br.body).company_shipping_cost).toBeNull();
  });
});
