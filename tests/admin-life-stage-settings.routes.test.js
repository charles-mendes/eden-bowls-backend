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
  operator: { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR', 'US'] },
  operatorBr: { userId: '9', email: 'op.br@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR'] },
  operatorUs: { userId: '10', email: 'op.us@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['US'] },
  operatorUnassigned: { userId: '11', email: 'op.none@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: [] }
};

const BREED = { id: 4, market: 'BR', namePt: 'Dogue Alemão', nameEn: 'Great Dane', namePtNormalized: 'dogue alemao', nameEnNormalized: 'great dane', sizeClass: 'giant', active: true };

function setup(identity) {
  const repository = {
    listMarket: jest.fn().mockResolvedValue({
      market: 'BR',
      sizeClasses: [{ sizeClass: 'medium', adultFromMonths: 12, seniorFromMonths: 96 }],
      breeds: []
    }),
    saveLimits: jest.fn(),
    createBreed: jest.fn(async (market, breed) => ({ id: 9, market, ...breed })),
    findBreed: jest.fn(async (id) => (id === 4 ? BREED : { ...BREED, id, market: 'US' })),
    updateBreed: jest.fn(async (id, changes) => ({ ...BREED, id, ...changes })),
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

  test('the BR operator previews and saves the limits of BR only', async () => {
    const { app, repository } = setup(IDENTITIES.operatorBr);
    const limits = { medium: { adult_from_months: 12, senior_from_months: 84 } };

    const preview = await auth(request(app).post('/api/v1/admin/life-stage/preview')).send({ market: 'BR', limits });
    expect(preview.status).toBe(200);
    expect(preview.body.pets_changing).toBe(1);
    expect((await auth(request(app).put('/api/v1/admin/life-stage/limits')).send({ market: 'BR', limits })).status).toBe(200);
    expect(repository.saveLimits).toHaveBeenCalledWith('BR', { medium: { adultFromMonths: 12, seniorFromMonths: 84 } }, 9, {});

    const otherSave = await auth(request(app).put('/api/v1/admin/life-stage/limits')).send({ market: 'US', limits });
    const otherPreview = await auth(request(app).post('/api/v1/admin/life-stage/preview')).send({ market: 'US', limits });
    expect([otherSave.status, otherPreview.status]).toEqual([403, 403]);
    expect(otherSave.body.details).toEqual({ code: 'market_forbidden' });
    expect(repository.saveLimits).toHaveBeenCalledTimes(1);
  });

  test('the US operator saves the limits of US but not of BR', async () => {
    const { app, repository } = setup(IDENTITIES.operatorUs);
    const limits = { giant: { adult_from_months: 20, senior_from_months: 72 } };
    expect((await auth(request(app).put('/api/v1/admin/life-stage/limits')).send({ market: 'US', limits })).status).toBe(200);
    expect((await auth(request(app).put('/api/v1/admin/life-stage/limits')).send({ market: 'BR', limits })).status).toBe(403);
    expect(repository.saveLimits).toHaveBeenCalledTimes(1);
  });

  test('an operator with no assigned market saves no limits', async () => {
    const { app, repository } = setup(IDENTITIES.operatorUnassigned);
    const limits = { giant: { adult_from_months: 20, senior_from_months: 72 } };
    expect((await auth(request(app).put('/api/v1/admin/life-stage/limits')).send({ market: 'BR', limits })).status).toBe(403);
    expect(repository.saveLimits).not.toHaveBeenCalled();
  });

  test('readonly reads the limits but neither previews nor saves them', async () => {
    const { app, repository } = setup({ userId: '12', email: 'read@edenbowls.com', roles: ['readonly'], permissions: ROLE_PERMISSIONS.readonly, markets: ['BR'] });
    const limits = { medium: { adult_from_months: 12, senior_from_months: 84 } };
    expect((await auth(request(app).get('/api/v1/admin/life-stage?market=BR'))).status).toBe(200);
    expect((await auth(request(app).put('/api/v1/admin/life-stage/limits')).send({ market: 'BR', limits })).status).toBe(403);
    expect((await auth(request(app).post('/api/v1/admin/life-stage/preview')).send({ market: 'BR', limits })).status).toBe(403);
    expect((await auth(request(app).post('/api/v1/admin/life-stage/preview')).send({ market: 'BR' })).status).toBe(403);
    expect(repository.listSubscribedPets).not.toHaveBeenCalled();
  });

  test('the BR operator creates, edits and previews breeds of BR only', async () => {
    const { app, repository } = setup(IDENTITIES.operatorBr);
    const breed = { name_pt: 'Mastim Tibetano', name_en: 'Tibetan Mastiff', size_class: 'giant' };

    expect((await auth(request(app).post('/api/v1/admin/life-stage/preview')).send({ market: 'BR', breed })).status).toBe(200);
    expect((await auth(request(app).post('/api/v1/admin/life-stage/breeds')).send({ market: 'BR', ...breed })).status).toBe(200);
    expect((await auth(request(app).patch('/api/v1/admin/life-stage/breeds/4')).send({ market: 'BR', size_class: 'large' })).status).toBe(200);
    expect(repository.createBreed).toHaveBeenCalledWith('BR', expect.objectContaining({ namePt: 'Mastim Tibetano' }), 9, {});

    const create = await auth(request(app).post('/api/v1/admin/life-stage/breeds')).send({ market: 'US', ...breed });
    const edit = await auth(request(app).patch('/api/v1/admin/life-stage/breeds/5')).send({ market: 'US', active: false });
    const preview = await auth(request(app).post('/api/v1/admin/life-stage/preview')).send({ market: 'US', breed });
    expect([create.status, edit.status, preview.status]).toEqual([403, 403, 403]);
    expect(create.body.details).toEqual({ code: 'market_forbidden' });
    expect(repository.createBreed).toHaveBeenCalledTimes(1);
  });

  test('the US operator writes breeds of US but not of BR', async () => {
    const { app, repository } = setup(IDENTITIES.operatorUs);
    const breed = { name_pt: 'Mastim Tibetano', name_en: 'Tibetan Mastiff', size_class: 'giant' };

    expect((await auth(request(app).post('/api/v1/admin/life-stage/breeds')).send({ market: 'US', ...breed })).status).toBe(200);
    expect((await auth(request(app).patch('/api/v1/admin/life-stage/breeds/4')).send({ market: 'BR', active: false })).status).toBe(403);
    expect(repository.updateBreed).not.toHaveBeenCalled();
  });

  test('an operator with no assigned market writes no breed, though reading falls back to both markets', async () => {
    const { app, repository } = setup(IDENTITIES.operatorUnassigned);
    const breed = { name_pt: 'Mastim Tibetano', name_en: 'Tibetan Mastiff', size_class: 'giant' };

    expect((await auth(request(app).get('/api/v1/admin/life-stage?market=BR'))).status).toBe(200);
    expect((await auth(request(app).post('/api/v1/admin/life-stage/breeds')).send({ market: 'BR', ...breed })).status).toBe(403);
    expect((await auth(request(app).post('/api/v1/admin/life-stage/breeds')).send({ market: 'US', ...breed })).status).toBe(403);
    expect(repository.createBreed).not.toHaveBeenCalled();
  });

  test('the veterinarian with no assigned market writes breeds in both markets', async () => {
    const { app } = setup({ ...IDENTITIES.veterinarian, markets: [] });
    const breed = { name_pt: 'Mastim Tibetano', name_en: 'Tibetan Mastiff', size_class: 'giant' };
    expect((await auth(request(app).post('/api/v1/admin/life-stage/breeds')).send({ market: 'BR', ...breed })).status).toBe(200);
    expect((await auth(request(app).post('/api/v1/admin/life-stage/breeds')).send({ market: 'US', ...breed })).status).toBe(200);
  });

  test('every route names one market', async () => {
    const { app } = setup(IDENTITIES.veterinarian);
    const response = await auth(request(app).get('/api/v1/admin/life-stage'));
    expect(response.status).toBe(400);
    expect(response.body.details).toEqual({ code: 'market_required' });
    expect((await auth(request(app).get('/api/v1/admin/life-stage?market=BR'))).body.sizeClasses).toHaveLength(1);
  });
});
