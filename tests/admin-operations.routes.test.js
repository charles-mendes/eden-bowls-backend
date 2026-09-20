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

describe('admin onboarding billing catalog users', () => {
  test('lists onboarding checkouts', async () => {
    const adminOnboardingService = {
      list: jest.fn().mockResolvedValue({ total: 1, page: 1, perPage: 20, totalPages: 1, items: [{ userId: '3', email: 'a@b.com' }] }),
      metrics: jest.fn().mockResolvedValue({ totalCheckouts: 1, linkedToStripe: 1, stripeActive: 1, withSimplified: 1 })
    };
    const app = adminApp({ adminOnboardingService });
    const list = await request(app).get('/api/v1/admin/onboarding/checkouts').set('Authorization', `Bearer ${tokenFor()}`);
    const metrics = await request(app).get('/api/v1/admin/onboarding/metrics').set('Authorization', `Bearer ${tokenFor()}`);

    expect(list.status).toBe(200);
    expect(list.body.items[0].userId).toBe('3');
    expect(metrics.body.totalCheckouts).toBe(1);
  });

  test('lists billing subscriptions and users', async () => {
    const adminBillingService = {
      listSubscriptions: jest.fn().mockResolvedValue({ total: 1, page: 1, perPage: 20, items: [{ id: '1', status: 'active' }] }),
      listWebhooks: jest.fn().mockResolvedValue({ total: 0, page: 1, perPage: 20, items: [] })
    };
    const adminUsersService = {
      list: jest.fn().mockResolvedValue({ total: 1, page: 1, perPage: 20, items: [{ id: '8', email: 'c@d.com' }] })
    };
    const adminCatalogService = {
      listProducts: jest.fn().mockResolvedValue({ total: 0, page: 1, perPage: 20, items: [] }),
      health: jest.fn().mockResolvedValue({ market: 'BR', currency: 'BRL', totalExpected: 0, totalMapped: 0, gaps: [] })
    };
    const app = adminApp({ adminBillingService, adminUsersService, adminCatalogService });

    const subs = await request(app).get('/api/v1/admin/billing/subscriptions?status=active').set('Authorization', `Bearer ${tokenFor()}`);
    const users = await request(app).get('/api/v1/admin/users?page=1&perPage=20&q=c@').set('Authorization', `Bearer ${tokenFor()}`);
    const health = await request(app).get('/api/v1/billing/catalog/sync/health?market=BR&currency=BRL').set('Authorization', `Bearer ${tokenFor()}`);
    const adminHealth = await request(app).get('/api/v1/admin/catalog/sync/health?market=BR&currency=BRL').set('Authorization', `Bearer ${tokenFor()}`);

    expect(subs.status).toBe(200);
    expect(users.body.items[0].email).toBe('c@d.com');
    expect(health.body.totalExpected).toBe(0);
    expect(adminHealth.status).toBe(200);
    expect(adminHealth.body).toEqual({ market: 'BR', currency: 'BRL', totalExpected: 0, totalMapped: 0, gaps: [] });
  });

  test('hides a US customer and nested US subscription from a Brazil operator', async () => {
    const { AdminUsersService } = require('../src/services/admin-users.service');
    const { HttpError } = require('../src/core/http-error');
    const brUser = {
      id: '8',
      email: 'br@edenbowls.com',
      status: 'active',
      createdAt: '2026-01-01 00:00:00',
      displayName: 'BR Customer',
      storedRoles: '["customer"]',
      storedMarkets: '',
      profileMarket: 'BR',
      mustChangePassword: '',
      inviteMailStatus: null,
      inviteExpiresAt: null,
      inviteResendCount: '',
      inviteResendWindowStart: '',
      deletedAt: null,
      profile: { fullName: 'BR Customer', phone: null }
    };
    const adminUsersService = new AdminUsersService({
      usersRepository: {
        findUserById: jest.fn()
          .mockResolvedValueOnce({ ...brUser, id: '91', email: 'us@edenbowls.com', profileMarket: 'US' })
          .mockResolvedValueOnce(brUser)
      },
      ledgerRepository: {
        listByUserId: jest.fn().mockResolvedValue([
          { id: 1, stripeAccount: 'br', stripeSubscriptionId: 'sub_br', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, planLabel: 'BR' },
          { id: 2, stripeAccount: 'us', stripeSubscriptionId: 'sub_us', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, planLabel: 'US' }
        ])
      }
    });
    const identity = {
      userId: '7',
      email: 'ops@edenbowls.com',
      roles: ['operator'],
      markets: ['BR'],
      permissions: [...ROLE_PERMISSIONS.operator, 'market.br']
    };
    const app = createApp({
      corsOrigins: ['http://localhost:5174'],
      jwt,
      adminIdentityService: {
        requireOperational: jest.fn().mockResolvedValue(identity)
      },
      adminUsersService,
      privacyService: {
        getUserPrivacySnapshot: jest.fn().mockRejectedValue(new HttpError(404, 'Not found.'))
      }
    });

    const hidden = await request(app)
      .get('/api/v1/admin/users/91')
      .set('Authorization', `Bearer ${tokenFor()}`);
    const snapshot = await request(app)
      .get('/api/v1/admin/users/91/privacy')
      .set('Authorization', `Bearer ${tokenFor()}`);
    const detail = await request(app)
      .get('/api/v1/admin/users/8')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(hidden.status).toBe(404);
    expect(snapshot.status).toBe(404);
    expect(detail.status).toBe(200);
    expect(detail.body.subscriptions.map((item) => item.stripeAccount)).toEqual(['br']);
  });
});
