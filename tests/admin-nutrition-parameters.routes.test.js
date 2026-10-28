const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { DEFAULT_NUTRITION_PARAMETERS } = require('../src/core/nutrition-recommendation');
const { AdminNutritionService } = require('../src/services/admin-nutrition.service');
const { NutritionParametersService } = require('../src/services/nutrition-parameters.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function tokenFor(userId = 7) {
  return issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

const IDENTITIES = {
  veterinarian: { userId: '5', email: 'vet@edenbowls.com', roles: ['veterinarian'], permissions: ROLE_PERMISSIONS.veterinarian },
  operator: { userId: '8', email: 'op@edenbowls.com', roles: ['operator'], permissions: ROLE_PERMISSIONS.operator, markets: ['BR', 'US'] },
  readonly: { userId: '9', email: 'ro@edenbowls.com', roles: ['readonly'], permissions: ROLE_PERMISSIONS.readonly, markets: ['BR', 'US'] }
};

const defaults = () => JSON.parse(JSON.stringify(DEFAULT_NUTRITION_PARAMETERS));

function setup(identity, { draft = null } = {}) {
  const repository = {
    published: jest.fn().mockResolvedValue({ id: 1, parameters: defaults(), publishedAt: '2026-10-27T10:00:00.000Z' }),
    draft: jest.fn().mockResolvedValue(draft),
    history: jest.fn().mockResolvedValue([{ id: 1, status: 'published' }]),
    findById: jest.fn(),
    saveDraft: jest.fn(async ({ parameters }) => ({ id: 2, status: 'draft', parameters })),
    deleteDraft: jest.fn(),
    publishDraft: jest.fn(),
    clearCache: jest.fn()
  };
  const nutritionParametersService = new NutritionParametersService({ repository, dataSource: { transaction: async (work) => work({}) } });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: { requireOperational: jest.fn().mockResolvedValue(identity) },
    nutritionParametersService,
    adminNutritionService: new AdminNutritionService({ nutritionParametersService })
  });
  return { app, repository };
}

const auth = (call) => call.set('Authorization', `Bearer ${tokenFor()}`);
const greatDane = {
  country: 'BR',
  pet: { type: 'dog', life_stage: 'adult', weight: 60, breed: 'Great Dane', neutered: false, age: 4 },
  questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
};

describe('admin nutrition parameters routes', () => {
  test('readonly reads the published set and the history', async () => {
    const { app } = setup(IDENTITIES.readonly);

    const response = await auth(request(app).get('/api/v1/admin/nutrition/parameters'));

    expect(response.status).toBe(200);
    expect(response.body.published.id).toBe(1);
    expect(response.body.history).toEqual([{ id: 1, status: 'published' }]);
    expect(response.body.draft).toBeNull();
  });

  test('a veterinarian saves a draft and gets 422 for an invalid one', async () => {
    const { app } = setup(IDENTITIES.veterinarian);
    const parameters = defaults();
    parameters.base.dogue = 190;

    const saved = await auth(request(app).put('/api/v1/admin/nutrition/parameters/draft')).send({ parameters });
    parameters.base.dogue = 500;
    const refused = await auth(request(app).put('/api/v1/admin/nutrition/parameters/draft')).send({ parameters });

    expect(saved.status).toBe(200);
    expect(saved.body.parameters.base.dogue).toBe(190);
    expect(refused.status).toBe(422);
    expect(refused.body.details).toMatchObject({ code: 'nutrition_parameters_invalid', fields: ['base.dogue'] });
  });

  test('Simulate with a draft: the draft Dogue factor, while customers keep the published one', async () => {
    const parameters = defaults();
    parameters.base.dogue = 190;
    const { app } = setup(IDENTITIES.veterinarian, { draft: { id: 2, status: 'draft', parameters } });

    const draft = await auth(request(app).post('/api/v1/admin/nutrition/simulate')).send({ ...greatDane, parameter_set: 'draft' });
    const published = await auth(request(app).post('/api/v1/admin/nutrition/simulate')).send(greatDane);

    expect(draft.status).toBe(200);
    expect(draft.body.data.parameter_set).toEqual({ id: 2, status: 'draft' });
    expect(draft.body.data.decision_trace).toContain('breed_dogue_group:190');
    expect(published.body.data.parameter_set).toEqual({ id: 1, status: 'published' });
    expect(published.body.data.decision_trace).toContain('breed_dogue_group:200');
  });

  test('Operator cannot publish nor simulate a draft', async () => {
    const { app, repository } = setup(IDENTITIES.operator, { draft: { id: 2, status: 'draft', parameters: defaults() } });

    const publish = await auth(request(app).post('/api/v1/admin/nutrition/parameters/publish'));
    const simulate = await auth(request(app).post('/api/v1/admin/nutrition/simulate')).send({ ...greatDane, parameter_set: 'draft' });

    expect(publish.status).toBe(403);
    expect(simulate.status).toBe(403);
    expect(repository.publishDraft).not.toHaveBeenCalled();
  });

  test('a veterinarian publishes the draft', async () => {
    const { app, repository } = setup(IDENTITIES.veterinarian, { draft: { id: 2, status: 'draft', parameters: defaults() } });

    const response = await auth(request(app).post('/api/v1/admin/nutrition/parameters/publish'));

    expect(response.status).toBe(200);
    expect(repository.publishDraft).toHaveBeenCalledWith({ draftId: 2, actorId: 5 }, {});
  });
});
