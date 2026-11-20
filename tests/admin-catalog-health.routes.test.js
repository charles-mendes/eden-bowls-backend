const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminCatalogService } = require('../src/services/admin-catalog.service');
const { StripeAccounts } = require('../src/infrastructure/stripe/stripe-accounts');
const { StripeBillingClient } = require('../src/infrastructure/stripe/stripe-billing-client');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const token = () => issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });

const identities = {
  admin: { userId: '7', roles: ['admin'], markets: ['BR', 'US'], permissions: [...ROLE_PERMISSIONS.admin, 'market.br', 'market.us'] },
  readonly: { userId: '9', roles: ['readonly'], markets: ['BR', 'US'], permissions: [...ROLE_PERMISSIONS.readonly, 'market.br', 'market.us'] },
  veterinarian: { userId: '10', roles: ['veterinarian'], markets: ['BR', 'US'], permissions: [...ROLE_PERMISSIONS.veterinarian, 'market.br', 'market.us'] }
};

// Key-shaped fakes: the response must never echo any of them.
const FAKE_SECRET = 'sk_test_FAKEreadinessSECRET';

function appFor(identity) {
  const sdk = {
    accounts: { retrieve: jest.fn().mockResolvedValue({ id: 'acct_LOCALUS' }) },
    prices: { retrieve: jest.fn().mockImplementation(async (id) => ({ id })) }
  };
  const us = new StripeBillingClient({ account: 'us', secretKey: FAKE_SECRET, client: sdk });
  const stripeAccounts = new StripeAccounts({
    us,
    br: us,
    brEnabled: true,
    usWebhookSecret: 'whsec_FAKEus',
    brWebhookSecret: 'whsec_FAKEbr'
  });
  const adminCatalogService = new AdminCatalogService({
    repository: {
      listProducts: jest.fn().mockResolvedValue({
        items: [{ id: '2', planCountry: 'US', variants: [{ id: '21', stripePriceId: 'price_a', stripePriceIdsByCurrency: { usd: 'price_a' } }] }]
      })
    },
    stripeAccounts,
    syncRunsRepository: {
      latestCompletedByMarket: jest.fn().mockResolvedValue({ US: { stripeAccountId: 'acct_LOCALUS', updatedAt: '2026-11-18T10:00:00.000Z' } })
    }
  });
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    adminCatalogService
  });
}

describe.each([
  '/api/v1/admin/catalog/sync/health',
  '/api/v1/billing/catalog/sync/health'
])('GET %s', (path) => {
  test.each(['admin', 'readonly'])('answers %s (catalog.read) with stripe_account and no secret', async (role) => {
    const response = await request(appFor(identities[role])).get(`${path}?market=US&currency=USD`).set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ market: 'US', totalExpected: 1, totalMapped: 1, stripe_account: { status: 'ok', current_account_id: 'acct_LOCALUS' } });
    const body = JSON.stringify(response.body);
    expect(body).not.toContain(FAKE_SECRET);
    expect(body).not.toMatch(/sk_|rk_|pk_|whsec_/);
  });

  test('forbids a role without catalog.read', async () => {
    const response = await request(appFor(identities.veterinarian)).get(`${path}?market=US`).set('Authorization', `Bearer ${token()}`);
    expect(response.status).toBe(403);
  });
});
