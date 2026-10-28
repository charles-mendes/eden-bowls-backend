const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { LifeStageSettingsService } = require('../src/services/life-stage-settings.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

const IDENTITIES = {
  veterinarian: { userId: '5', email: 'vet@edenbowls.com', roles: ['veterinarian'], permissions: ROLE_PERMISSIONS.veterinarian },
  operator: { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR', 'US'] }
};

function setup(identity) {
  const repository = {
    listMarket: jest.fn().mockResolvedValue({
      market: 'BR',
      sizeClasses: [{ sizeClass: 'medium', adultFromMonths: 12, seniorFromMonths: 96 }],
      breeds: []
    }),
    saveLimits: jest.fn(),
    listSubscribedPets: jest.fn().mockResolvedValue([
      { id: '1', breed: '', size: 'medium', age_years: 7, age_months: 6, age_recorded_at: new Date().toISOString(), birth_date: null }
    ])
  };
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    lifeStageSettingsService: new LifeStageSettingsService({ repository, dataSource: { transaction: async (work) => work({}) } })
  });
  return { app, repository };
}

const auth = (call) => call.set('Authorization', `Bearer ${tokenFor()}`);

describe('admin life-stage settings routes', () => {
  test('the veterinarian previews a lower BR medium senior age without saving', async () => {
    const { app, repository } = setup(IDENTITIES.veterinarian);

    const response = await auth(request(app).post('/api/v1/admin/life-stage/preview'))
      .send({ market: 'BR', limits: { medium: { adult_from_months: 12, senior_from_months: 84 } } });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ market: 'BR', pets_changing: 1, transitions: [{ from: 'adult', to: 'senior', count: 1 }] });
    expect(repository.listSubscribedPets).toHaveBeenCalledWith('br');
    expect(repository.saveLimits).not.toHaveBeenCalled();
  });

  test('Invalid limits answer 422 and nothing is saved', async () => {
    const { app, repository } = setup(IDENTITIES.veterinarian);

    const response = await auth(request(app).put('/api/v1/admin/life-stage/limits'))
      .send({ market: 'BR', limits: { small: { adult_from_months: 120, senior_from_months: 100 } } });

    expect(response.status).toBe(422);
    expect(response.body.details).toEqual({ code: 'life_stage_limits_invalid', fields: ['small.senior_from_months'] });
    expect(repository.saveLimits).not.toHaveBeenCalled();
  });

  test('the operator reads the limits but saves and previews nothing: the change is clinical', async () => {
    const { app } = setup(IDENTITIES.operator);
    expect((await auth(request(app).get('/api/v1/admin/life-stage?market=BR'))).status).toBe(200);
    expect((await auth(request(app).put('/api/v1/admin/life-stage/limits')).send({ market: 'BR', limits: {} })).status).toBe(403);
    expect((await auth(request(app).post('/api/v1/admin/life-stage/preview')).send({ market: 'BR' })).status).toBe(403);
  });

  test('every route names one market', async () => {
    const { app } = setup(IDENTITIES.veterinarian);
    const response = await auth(request(app).get('/api/v1/admin/life-stage'));
    expect(response.status).toBe(400);
    expect(response.body.details).toEqual({ code: 'market_required' });
    expect((await auth(request(app).get('/api/v1/admin/life-stage?market=BR'))).body.sizeClasses).toHaveLength(1);
  });
});
