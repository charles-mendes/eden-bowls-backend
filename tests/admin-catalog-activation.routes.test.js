const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { AdminCatalogService } = require('../src/services/admin-catalog.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function token() {
  return issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

function appFor(product, { activeCount = 0, permissions = ROLE_PERMISSIONS.operator } = {}) {
  const repository = {
    getProduct: jest.fn().mockResolvedValue(product),
    updatePostStatus: jest.fn()
  };
  const adminCatalogService = new AdminCatalogService({
    repository,
    ledgerRepository: {
      findReferencedCatalogIds: jest.fn().mockResolvedValue({ variationIds: [], priceIds: [] }),
      countActiveSubscriptionsForCatalog: jest.fn().mockResolvedValue(activeCount)
    }
  });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue({
        userId: '7',
        email: 'ops@edenbowls.com',
        roles: ['operator'],
        markets: ['BR'],
        permissions: [...permissions, 'market.br']
      })
    },
    adminCatalogService
  });
  return { app, repository };
}

const path = '/api/v1/admin/catalog/products/100/variations/1001/activation';
const beef = { id: '1001', active: true, regularPrice: 25, stripePriceIdsByCurrency: { brl: 'price_beef' } };

describe('POST /api/v1/admin/catalog/products/:productId/variations/:variationId/activation', () => {
  test('deactivates a BR variation for a BR operator', async () => {
    const { app, repository } = appFor({ id: '100', active: true, planCountry: 'BR', variants: [beef] });

    const response = await request(app).post(path).set('Authorization', `Bearer ${token()}`).send({ active: false });

    expect(response.status).toBe(200);
    expect(repository.updatePostStatus).toHaveBeenCalledWith('1001', 'draft');
  });

  test('returns the active subscription count when deactivation is refused', async () => {
    const { app } = appFor({ id: '100', active: true, planCountry: 'BR', variants: [beef] }, { activeCount: 3 });

    const response = await request(app).post(path).set('Authorization', `Bearer ${token()}`).send({ active: false });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Variation is used by 3 active subscriptions and cannot be deactivated.');
    expect(response.body.details).toEqual({ code: 'variation_in_active_subscriptions', activeSubscriptions: 3 });
  });

  test('hides a US product from a BR operator', async () => {
    const { app, repository } = appFor({ id: '100', active: true, planCountry: 'US', variants: [beef] });

    const response = await request(app).post(path).set('Authorization', `Bearer ${token()}`).send({ active: false });

    expect(response.status).toBe(404);
    expect(repository.updatePostStatus).not.toHaveBeenCalled();
  });

  test('requires catalog.write', async () => {
    const { app } = appFor({ id: '100', active: true, planCountry: 'BR', variants: [beef] }, {
      permissions: ROLE_PERMISSIONS.operator.filter((permission) => permission !== 'catalog.write')
    });

    const response = await request(app).post(path).set('Authorization', `Bearer ${token()}`).send({ active: false });

    expect(response.status).toBe(403);
  });
});
