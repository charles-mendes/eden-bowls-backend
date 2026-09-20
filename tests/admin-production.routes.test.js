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

const queueEnvelope = {
  total: 1,
  page: 1,
  perPage: 20,
  totalPages: 1,
  metrics: { today: 1, tomorrow: 0, upcoming: 0, overdue: 0 },
  items: [{
    id: 42,
    productionStatus: 'to_prepare',
    lineItems: [{ flavor: 'beef', quantity: 2, packSize: '500 g', petName: 'Luna' }]
  }]
};

describe('admin production routes', () => {
  test('lists the production queue envelope', async () => {
    const adminProductionService = {
      listQueue: jest.fn().mockResolvedValue(queueEnvelope)
    };
    const app = adminApp({ adminProductionService });
    const response = await request(app)
      .get('/api/v1/admin/production/queue')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body.metrics.today).toBe(1);
    expect(response.body.items[0].id).toBe(42);
    expect(adminProductionService.listQueue).toHaveBeenCalled();
  });

  test('patches production status', async () => {
    const adminProductionService = {
      updateStatus: jest.fn().mockResolvedValue({
        id: 42,
        productionStatus: 'in_production'
      })
    };
    const app = adminApp({ adminProductionService });
    const response = await request(app)
      .patch('/api/v1/admin/production/queue/42')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'in_production', periodEnd: '2026-09-20T08:00:00.000Z' });

    expect(response.status).toBe(200);
    expect(response.body.productionStatus).toBe('in_production');
    expect(adminProductionService.updateStatus).toHaveBeenCalledWith(
      '42',
      { status: 'in_production', periodEnd: '2026-09-20T08:00:00.000Z', note: null },
      expect.objectContaining({ userId: '7' })
    );
  });

  test('rejects PATCH without production.write', async () => {
    const adminProductionService = {
      updateStatus: jest.fn()
    };
    const app = adminApp({
      adminProductionService,
      adminIdentityService: {
        requireOperational: jest.fn().mockResolvedValue({
          userId: '9',
          email: 'read@edenbowls.com',
          roles: ['readonly'],
          permissions: ROLE_PERMISSIONS.readonly
        })
      }
    });
    const response = await request(app)
      .patch('/api/v1/admin/production/queue/42')
      .set('Authorization', `Bearer ${tokenFor(9)}`)
      .send({ status: 'in_production', periodEnd: '2026-09-20T08:00:00.000Z' });

    expect(response.status).toBe(403);
    expect(adminProductionService.updateStatus).not.toHaveBeenCalled();
  });
});
