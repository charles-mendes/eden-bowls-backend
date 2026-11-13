const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { PlanSettingsService } = require('../src/services/plan-settings.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

const IDENTITIES = {
  readonly: { userId: '3', email: 'ro@edenbowls.com', roles: ['readonly'], permissions: ROLE_PERMISSIONS.readonly, markets: ['BR', 'US'] },
  operatorBr: { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR'] }
};

function setup(identity) {
  const repository = {
    read: jest.fn(async (market) => ({ market, planDays: 30, largePackLimit: 8, stored: true, updatedAt: null })),
    save: jest.fn()
  };
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    planSettingsService: new PlanSettingsService({
      repository,
      auditRepository: { createIn: jest.fn() },
      dataSource: { transaction: async (work) => work({ tx: true }) }
    })
  });
  return { app, repository };
}

const auth = (call) => call.set('Authorization', `Bearer ${tokenFor()}`);

describe('admin plan settings routes', () => {
  test('reads the settings of one market', async () => {
    const { app } = setup(IDENTITIES.readonly);
    const response = await auth(request(app).get('/api/v1/admin/catalog/plan-settings?market=BR'));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ market: 'BR', planDays: 30, largePackLimit: 8 });
  });

  test('a read-only session cannot save', async () => {
    const { app, repository } = setup(IDENTITIES.readonly);
    const response = await auth(request(app).put('/api/v1/admin/catalog/plan-settings?market=BR')).send({ planDays: 28, largePackLimit: 6 });
    expect(response.status).toBe(403);
    expect(repository.save).not.toHaveBeenCalled();
  });

  test('a session outside the market gets 403', async () => {
    const { app } = setup(IDENTITIES.operatorBr);
    expect((await auth(request(app).get('/api/v1/admin/catalog/plan-settings?market=US'))).status).toBe(403);
  });

  test('a session with access to several markets must choose one', async () => {
    const { app } = setup(IDENTITIES.readonly);
    expect((await auth(request(app).get('/api/v1/admin/catalog/plan-settings'))).status).toBe(400);
  });

  test('a writer saves valid values', async () => {
    const { app, repository } = setup(IDENTITIES.operatorBr);
    const response = await auth(request(app).put('/api/v1/admin/catalog/plan-settings?market=BR')).send({ planDays: 28, largePackLimit: 6 });
    expect(response.status).toBe(200);
    expect(repository.save).toHaveBeenCalledWith('BR', { planDays: 28, largePackLimit: 6 }, 8, { tx: true });
  });

  test('invalid values answer 422', async () => {
    const { app, repository } = setup(IDENTITIES.operatorBr);
    const response = await auth(request(app).put('/api/v1/admin/catalog/plan-settings?market=BR')).send({ planDays: 28.5, largePackLimit: 6 });
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain('plan_days_invalid');
    expect(repository.save).not.toHaveBeenCalled();
  });
});
