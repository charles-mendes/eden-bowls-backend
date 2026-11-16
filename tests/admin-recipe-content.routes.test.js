const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { RecipeContentService } = require('../src/services/recipe-content.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function token() {
  return issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

// Product 500 is BR senior-beef, product 600 is US beef.
const CONTENTS = {
  500: { productId: '500', market: 'BR', flavorSlug: 'senior-beef', name: 'Sênior Carne', lifeStage: 'senior', imageUrl: '/recipe-images/old.webp', label: null },
  600: { productId: '600', market: 'US', flavorSlug: 'beef', name: 'Beef', lifeStage: 'adult', imageUrl: null, label: null }
};

function appFor({ role = 'operator', markets = ['BR'] } = {}) {
  const save = (fields) => jest.fn(async ({ productId, ...values }) => ({ ...CONTENTS[productId], ...fields(values) }));
  const repository = {
    findByProductId: jest.fn(async (productId) => CONTENTS[productId] || null),
    setImage: save(({ imageUrl }) => ({ imageUrl })),
    setPlanImage: save(({ imageUrl }) => ({ planImageUrl: imageUrl })),
    setLabel: save(({ label }) => ({ label })),
    setPresentation: save(({ presentation }) => ({ presentation }))
  };
  const recipeContentService = new RecipeContentService({
    repository,
    catalogRepository: { listProductVariations: jest.fn(async () => [{ id: '301', name: 'Sênior Carne 300g', sku: 'S-300', active: false }]) },
    imageStorage: { write: jest.fn(async () => '/recipe-images/new.webp'), delete: jest.fn() },
    processImage: jest.fn(async () => ({ buffer: Buffer.from('webp') }))
  });
  const app = createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue({
        userId: '7',
        email: 'ops@edenbowls.com',
        roles: [role],
        markets,
        permissions: [...ROLE_PERMISSIONS[role], ...markets.map((market) => `market.${market.toLowerCase()}`)]
      })
    },
    recipeContentService
  });
  return { app, repository };
}

const auth = (call) => call.set('Authorization', `Bearer ${token()}`);
const upload = { mimeType: 'image/png', imageBase64: Buffer.from('png').toString('base64') };
const presentation = {
  tag: 'Carne',
  title: 'Receita de Carne para Cães Sênior',
  tagline: 'Leveza & Equilíbrio',
  resume: 'Da nossa linha sênior, com carne bovina, ovo, batata e vagem.',
  highlights: ['Carne bovina', 'Batata', 'Vagem'],
  colors: { color: '#A784C5', accentColor: '#A784C5', pillBg: '#D3BAE8', pillText: '#2D1145', pillBorder: '#9C78BA' }
};

const CALLS = [
  ['PUT', 'image', upload],
  ['DELETE', 'image', null],
  ['PUT', 'plan-image', upload],
  ['DELETE', 'plan-image', null],
  ['PUT', 'label', { label: { ingredients: ['Carne'] } }],
  ['PUT', 'presentation', { presentation }]
];

function send(app, method, productId, part, body) {
  const call = request(app)[method.toLowerCase()](`/api/v1/admin/catalog/products/${productId}/content/${part}`);
  return auth(body ? call.send(body) : call);
}

describe('admin product content routes', () => {
  test.each(CALLS)('an operator of the market can %s the %s', async (method, part, body) => {
    const { app } = appFor();
    const response = await send(app, method, 500, part, body);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ productId: '500', market: 'BR', flavorSlug: 'senior-beef' });
  });

  test.each(CALLS)('a read-only session cannot %s the %s', async (method, part, body) => {
    const { app, repository } = appFor({ role: 'readonly' });
    const response = await send(app, method, 500, part, body);
    expect(response.status).toBe(403);
    expect(repository.findByProductId).not.toHaveBeenCalled();
  });

  // Same rule as the product detail: a record outside the session markets is reported as not found.
  test('a product of another market answers 404 and changes nothing', async () => {
    const { app, repository } = appFor({ markets: ['BR'] });
    const response = await send(app, 'PUT', 600, 'label', { label: { ingredients: ['Beef'] } });
    expect(response.status).toBe(404);
    expect(repository.setLabel).not.toHaveBeenCalled();
  });

  test('an unknown product answers 404 product_not_found', async () => {
    const { app } = appFor();
    const response = await send(app, 'PUT', 999, 'presentation', { presentation });
    expect(response.status).toBe(404);
    expect(response.body.details).toMatchObject({ code: 'product_not_found' });
  });

  test('the old recipe-content routes are gone', async () => {
    const { app } = appFor();
    const response = await auth(request(app).get('/api/v1/admin/catalog/recipe-content?market=BR'));
    expect(response.status).toBe(404);
  });
});
