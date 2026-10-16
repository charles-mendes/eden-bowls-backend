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

describe('app error handler', () => {
  test('logs a 5xx message and code without headers, query or body, and keeps the generic response', async () => {
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    const adminCatalogService = {
      sync: jest.fn().mockRejectedValue(new HttpError(502, 'The requested Stripe resource was not found.', {
        code: 'stripe_price_ensure_failed',
        stripe_account: 'br'
      }))
    };
    const app = adminApp({ adminCatalogService, logger });
    const token = tokenFor();

    const response = await request(app)
      .post('/api/v1/admin/catalog/sync?market=BR&probe=query-secret')
      .set('Authorization', `Bearer ${token}`)
      .send({ market: 'BR', currency: 'BRL', probe: 'body-secret' });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      success: false,
      message: 'Internal server error.',
      details: { code: 'stripe_price_ensure_failed', stripe_account: 'br' }
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [fields, message] = logger.error.mock.calls[0];
    expect(message).toBe('Request failed.');
    expect(fields).toEqual({
      statusCode: 502,
      method: 'POST',
      path: '/api/v1/admin/catalog/sync',
      code: 'stripe_price_ensure_failed',
      stripe_account: 'br',
      message: 'The requested Stripe resource was not found.'
    });
    const logged = JSON.stringify(fields);
    for (const sensitive of [token, 'query-secret', 'body-secret']) {
      expect(logged).not.toContain(sensitive);
    }
  });

  test('does not log a 4xx error', async () => {
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    const adminCatalogService = {
      sync: jest.fn().mockRejectedValue(new HttpError(422, 'A catalog variant is not mapped to a Stripe price.', {
        code: 'unmapped_variant'
      }))
    };
    const app = adminApp({ adminCatalogService, logger });

    const response = await request(app)
      .post('/api/v1/admin/catalog/sync?market=BR')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ market: 'BR', currency: 'BRL' });

    expect(response.status).toBe(422);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
