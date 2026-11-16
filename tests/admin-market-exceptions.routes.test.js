const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { MarketExceptionsService } = require('../src/services/market-exceptions.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
const auth = (req) => req.set('Authorization', `Bearer ${token()}`);

const crossed = {
  id: 42,
  userId: 9,
  customerEmail: 'ana@example.com',
  stripeSubscriptionId: 'sub_br_us',
  stripeAccount: 'br',
  status: 'active',
  address: { country: 'US', recipient_name: 'Ana Costa' },
  openPaidCycles: 1
};

function appFor(identity) {
  const ledgerRepository = {
    listMarketExceptions: jest.fn(async ({ stripeAccounts }) => (
      Array.isArray(stripeAccounts) && !stripeAccounts.includes('br') ? [] : [crossed]
    ))
  };
  const marketExceptionsService = new MarketExceptionsService({ ledgerRepository, now: () => new Date('2026-11-06T12:00:00Z') });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue({ userId: '7', email: 'ops@edenbowls.com', ...identity }) },
    marketExceptionsService
  });
  return { app, ledgerRepository };
}

describe('GET /api/v1/admin/market-exceptions', () => {
  test('an admin sees the crossed subscription with its open paid cycles', async () => {
    const { app, ledgerRepository } = appFor({ roles: ['admin'], permissions: ROLE_PERMISSIONS.admin });
    const response = await auth(request(app).get('/api/v1/admin/market-exceptions'));
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      items: [{
        subscription_id: '42',
        stripe_subscription_id: 'sub_br_us',
        status: 'active',
        stripe_account: 'br',
        address_country: 'US',
        customer: { id: '9', email: 'ana@example.com', name: 'Ana Costa' },
        open_paid_cycles: 1
      }],
      truncated: false
    });
    expect(ledgerRepository.listMarketExceptions.mock.calls[0][0]).toMatchObject({ deliveryFloor: '2026-10-07' });
  });

  test('staff scoped to the US does not see a Brazil account', async () => {
    const { app } = appFor({ roles: ['operator'], markets: ['US'], permissions: ROLE_PERMISSIONS.operator });
    const response = await auth(request(app).get('/api/v1/admin/market-exceptions'));
    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([]);
  });

  test('without shipping.read the route answers 403', async () => {
    const { app } = appFor({ roles: ['operator'], permissions: ['billing.subscribers.read'] });
    const response = await auth(request(app).get('/api/v1/admin/market-exceptions'));
    expect(response.status).toBe(403);
  });
});
