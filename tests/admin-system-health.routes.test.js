const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

const identities = {
  admin: { userId: '7', email: 'admin@edenbowls.com', roles: ['admin'], markets: ['BR', 'US'], permissions: [...ROLE_PERMISSIONS.admin, 'market.br', 'market.us'] },
  operator: { userId: '8', email: 'ops@edenbowls.com', roles: ['operator'], markets: ['BR', 'US'], permissions: [...ROLE_PERMISSIONS.operator, 'market.br', 'market.us'] },
  readonly: { userId: '9', email: 'ro@edenbowls.com', roles: ['readonly'], markets: ['BR'], permissions: [...ROLE_PERMISSIONS.readonly, 'market.br'] }
};

function appFor(identity) {
  const adminSystemHealthService = {
    marketConflicts: jest.fn().mockResolvedValue({ total: 0, page: 1, perPage: 20, totalPages: 1, items: [] }),
    webhookHealth: jest.fn().mockResolvedValue({ generatedAt: '2026-10-08T12:00:00.000Z', staleAfterHours: 72, accounts: [] })
  };
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    adminSystemHealthService
  });
  return { app, adminSystemHealthService };
}

describe.each([
  ['/api/v1/admin/markets/conflicts', 'marketConflicts'],
  ['/api/v1/admin/billing/webhooks/health', 'webhookHealth']
])('GET %s', (path, method) => {
  test('requires a token', async () => {
    const { app } = appFor(identities.admin);
    const response = await request(app).get(path);
    expect(response.status).toBe(401);
  });

  test.each(['operator', 'readonly'])('forbids %s', async (role) => {
    const { app, adminSystemHealthService } = appFor(identities[role]);
    const response = await request(app).get(path).set('Authorization', `Bearer ${tokenFor()}`);
    expect(response.status).toBe(403);
    expect(adminSystemHealthService[method]).not.toHaveBeenCalled();
  });

  test('answers an admin', async () => {
    const { app, adminSystemHealthService } = appFor(identities.admin);
    const response = await request(app).get(path).set('Authorization', `Bearer ${tokenFor()}`);
    expect(response.status).toBe(200);
    expect(adminSystemHealthService[method]).toHaveBeenCalledTimes(1);
  });
});

test('passes page and perPage to the conflicts list', async () => {
  const { app, adminSystemHealthService } = appFor(identities.admin);
  await request(app).get('/api/v1/admin/markets/conflicts?page=3&perPage=500').set('Authorization', `Bearer ${tokenFor()}`);
  expect(adminSystemHealthService.marketConflicts).toHaveBeenCalledWith({ page: 3, perPage: 100, offset: 200 });
});

describe('GET /api/v1/admin/catalog/sync/status', () => {
  function appWithCatalog(identity) {
    const adminCatalogService = { status: jest.fn().mockResolvedValue({ status: null, byMarket: {} }) };
    const app = createApp({
      corsOrigins: ['http://localhost:5174'],
      jwt,
      adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
      adminCatalogService
    });
    return { app, adminCatalogService };
  }

  test('scopes an operator to their own market', async () => {
    const { app, adminCatalogService } = appWithCatalog({
      userId: '8', email: 'us@edenbowls.com', roles: ['operator'], markets: ['US'], permissions: [...ROLE_PERMISSIONS.operator, 'market.us']
    });
    const response = await request(app).get('/api/v1/admin/catalog/sync/status').set('Authorization', `Bearer ${tokenFor()}`);
    expect(response.status).toBe(200);
    expect(adminCatalogService.status).toHaveBeenCalledWith(expect.objectContaining({ markets: ['US'] }));
  });

  test('forbids an operator from asking for the other market', async () => {
    const { app } = appWithCatalog({
      userId: '8', email: 'us@edenbowls.com', roles: ['operator'], markets: ['US'], permissions: [...ROLE_PERMISSIONS.operator, 'market.us']
    });
    const response = await request(app).get('/api/v1/admin/catalog/sync/status?market=BR').set('Authorization', `Bearer ${tokenFor()}`);
    expect(response.status).toBe(403);
  });

  test('gives an admin both markets', async () => {
    const { app, adminCatalogService } = appWithCatalog(identities.admin);
    await request(app).get('/api/v1/admin/catalog/sync/status').set('Authorization', `Bearer ${tokenFor()}`);
    expect(adminCatalogService.status).toHaveBeenCalledWith(expect.objectContaining({ markets: ['BR', 'US'] }));
  });
});
