const { createApp } = require('../src/app');
const { buildRequireAdminPermission } = require('../src/api/middleware/require-admin-permission.middleware');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { issueJwtToken } = require('../src/core/jwt-token');
const request = require('supertest');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function collectAdminMarketScopes(app) {
  const router = app.router || app._router;
  const stack = router && router.stack ? router.stack : [];
  const routes = [];

  for (const layer of stack) {
    if (!layer.route || !layer.route.path) {
      continue;
    }

    const routePath = String(layer.route.path);
    if (!routePath.startsWith('/api/v1/admin')) {
      continue;
    }

    const methods = Object.keys(layer.route.methods || {})
      .filter((method) => layer.route.methods[method])
      .map((method) => method.toUpperCase());
    const marketScopes = (layer.route.stack || [])
      .map((item) => item.handle && item.handle.marketScope)
      .filter(Boolean);

    routes.push({
      path: routePath,
      methods,
      marketScopes
    });
  }

  return routes;
}

describe('admin market scope registry', () => {
  test('throws at registration when market is missing', () => {
    const requirePermission = buildRequireAdminPermission({});
    expect(() => requirePermission('users.read')).toThrow('Admin routes must declare market: none|query|record.');
  });

  test('every /api/v1/admin route declares marketScope and freezes none paths', () => {
    const app = createApp({
      corsOrigins: ['http://localhost:5174'],
      jwt,
      adminIdentityService: {
        requireOperational: jest.fn().mockResolvedValue({
          userId: '7',
          email: 'admin@edenbowls.com',
          roles: ['admin'],
          markets: ['BR', 'US'],
          permissions: [...ROLE_PERMISSIONS.admin, 'market.br', 'market.us']
        })
      }
    });

    const routes = collectAdminMarketScopes(app);
    expect(routes.length).toBeGreaterThan(10);

    const missing = routes.filter((route) => route.marketScopes.length === 0);
    expect(missing).toEqual([]);

    const nonePaths = routes
      .filter((route) => route.marketScopes.includes('none'))
      .flatMap((route) => route.methods.map((method) => `${method} ${route.path}`))
      .sort();

    expect(nonePaths).toEqual([
      'GET /api/v1/admin/me',
      'POST /api/v1/admin/me/password'
    ]);
  });

  test('query routes reject an out-of-scope market with 403 market_forbidden', async () => {
    const token = issueJwtToken(
      { data: { user: { id: 7 } } },
      { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
    );
    const app = createApp({
      corsOrigins: ['http://localhost:5174'],
      jwt,
      adminIdentityService: {
        requireOperational: jest.fn().mockResolvedValue({
          userId: '7',
          email: 'op@edenbowls.com',
          roles: ['operator'],
          markets: ['BR'],
          permissions: [...ROLE_PERMISSIONS.operator, 'market.br']
        })
      },
      adminUsersService: {
        list: jest.fn()
      }
    });

    const response = await request(app)
      .get('/api/v1/admin/users')
      .query({ market: 'US' })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.details).toEqual({ code: 'market_forbidden' });
  });
});
