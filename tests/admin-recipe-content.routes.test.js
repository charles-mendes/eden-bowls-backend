const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { HttpError } = require('../src/core/http-error');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function token() {
  return issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

const content = {
  market: 'BR',
  flavorSlug: 'senior-beef',
  imageUrl: '/recipe-images/recipe-br-senior-beef-1.webp',
  label: null,
  labelStatus: 'missing',
  labelMissing: [],
  variations: [{ id: '301', name: 'Sênior Carne 300g', sku: 'SENIOR-BEEF-300', active: false }]
};

function appFor({ role = 'operator', markets = ['BR'], service = {} } = {}) {
  const recipeContentService = {
    get: jest.fn().mockResolvedValue(content),
    list: jest.fn().mockResolvedValue({ market: 'BR', items: [{ key: 'senior-beef', imageUrl: null, labelStatus: 'missing', variations: content.variations }] }),
    uploadImage: jest.fn().mockResolvedValue(content),
    removeImage: jest.fn().mockResolvedValue({ ...content, imageUrl: null }),
    saveLabel: jest.fn().mockResolvedValue({ ...content, labelStatus: 'complete' }),
    create: jest.fn().mockResolvedValue({ ...content, flavorSlug: 'senior-duck', name: 'Sênior Pato', variations: [] }),
    rename: jest.fn().mockResolvedValue({ ...content, name: 'Carne Sênior' }),
    remove: jest.fn().mockResolvedValue({ deleted: true, market: 'BR', flavorSlug: 'senior-beef' }),
    ...service
  };
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
  return { app, recipeContentService };
}

const base = '/api/v1/admin/catalog/recipe-content/senior-beef';
const upload = { mimeType: 'image/png', imageBase64: Buffer.from('png').toString('base64') };

describe('admin recipe content routes', () => {
  test.each(['operator', 'readonly'])('%s reads the content of its market', async (role) => {
    const { app, recipeContentService } = appFor({ role });

    const response = await request(app).get(`${base}?market=BR`).set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ imageUrl: content.imageUrl, labelStatus: 'missing' });
    expect(recipeContentService.get).toHaveBeenCalledWith('BR', 'senior-beef');
  });

  test('lists the recipes of the market', async () => {
    const { app, recipeContentService } = appFor({ role: 'readonly' });

    const response = await request(app).get('/api/v1/admin/catalog/recipe-content?market=BR').set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.items[0].key).toBe('senior-beef');
    expect(recipeContentService.list).toHaveBeenCalledWith('BR');
  });

  test('operator registers, renames and deletes a recipe', async () => {
    const { app, recipeContentService } = appFor();
    const auth = `Bearer ${token()}`;

    const created = await request(app).post('/api/v1/admin/catalog/recipe-content?market=BR').set('Authorization', auth).send({ key: 'senior-duck', name: 'Sênior Pato' });
    const renamed = await request(app).patch(`${base}?market=BR`).set('Authorization', auth).send({ name: 'Carne Sênior' });
    const removed = await request(app).delete(`${base}?market=BR`).set('Authorization', auth);

    expect([created.status, renamed.status, removed.status]).toEqual([200, 200, 200]);
    expect(recipeContentService.create).toHaveBeenCalledWith('BR', { key: 'senior-duck', name: 'Sênior Pato' }, expect.objectContaining({ userId: '7' }));
    expect(recipeContentService.rename).toHaveBeenCalledWith('BR', 'senior-beef', { name: 'Carne Sênior' }, expect.objectContaining({ userId: '7' }));
    expect(recipeContentService.remove).toHaveBeenCalledWith('BR', 'senior-beef', expect.objectContaining({ userId: '7' }));
  });

  test('operator uploads an image with the actor', async () => {
    const { app, recipeContentService } = appFor();

    const response = await request(app).put(`${base}/image?market=BR`).set('Authorization', `Bearer ${token()}`).send(upload);

    expect(response.status).toBe(200);
    expect(recipeContentService.uploadImage).toHaveBeenCalledWith('BR', 'senior-beef', upload, expect.objectContaining({ userId: '7' }));
  });

  test('accepts an image body larger than the default 1 MB JSON limit', async () => {
    const { app } = appFor();
    const large = { mimeType: 'image/png', imageBase64: 'A'.repeat(3 * 1024 * 1024) };

    const response = await request(app).put(`${base}/image?market=BR`).set('Authorization', `Bearer ${token()}`).send(large);

    expect(response.status).toBe(200);
  });

  test('operator saves the label sent under label', async () => {
    const { app, recipeContentService } = appFor();
    const label = { ingredients: ['Carne'] };

    const response = await request(app).put(`${base}/label?market=BR`).set('Authorization', `Bearer ${token()}`).send({ label });

    expect(response.status).toBe(200);
    expect(recipeContentService.saveLabel).toHaveBeenCalledWith('BR', 'senior-beef', label, expect.objectContaining({ userId: '7' }));
  });

  test.each([
    ['put', `${base}/image?market=BR`],
    ['put', `${base}/label?market=BR`],
    ['delete', `${base}/image?market=BR`],
    ['post', '/api/v1/admin/catalog/recipe-content?market=BR'],
    ['patch', `${base}?market=BR`],
    ['delete', `${base}?market=BR`]
  ])('readonly cannot %s %s', async (method, path) => {
    const { app, recipeContentService } = appFor({ role: 'readonly' });

    const response = await request(app)[method](path).set('Authorization', `Bearer ${token()}`).send(upload);

    expect(response.status).toBe(403);
    expect(recipeContentService.uploadImage).not.toHaveBeenCalled();
    expect(recipeContentService.removeImage).not.toHaveBeenCalled();
    expect(recipeContentService.saveLabel).not.toHaveBeenCalled();
    expect(recipeContentService.create).not.toHaveBeenCalled();
    expect(recipeContentService.rename).not.toHaveBeenCalled();
    expect(recipeContentService.remove).not.toHaveBeenCalled();
  });

  test('a BR operator cannot read US content', async () => {
    const { app, recipeContentService } = appFor();

    const response = await request(app).get('/api/v1/admin/catalog/recipe-content/beef?market=US').set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(403);
    expect(recipeContentService.get).not.toHaveBeenCalled();
  });

  test('passes the 422 and 409 refusals through with their details', async () => {
    const invalid = new HttpError(422, 'Image must be 1024 x 636 pixels.', {
      code: 'recipe_image_invalid', reason: 'dimensions', width: 1200, height: 800, expectedWidth: 1024, expectedHeight: 636
    });
    const inUse = new HttpError(409, 'The image of a recipe with an active variation cannot be removed.', {
      code: 'recipe_content_in_use', activeVariations: ['301']
    });
    const { app } = appFor({ service: { uploadImage: jest.fn().mockRejectedValue(invalid), removeImage: jest.fn().mockRejectedValue(inUse) } });

    const refused = await request(app).put(`${base}/image?market=BR`).set('Authorization', `Bearer ${token()}`).send(upload);
    const locked = await request(app).delete(`${base}/image?market=BR`).set('Authorization', `Bearer ${token()}`);

    expect(refused.status).toBe(422);
    expect(refused.body.details).toEqual(invalid.details);
    expect(locked.status).toBe(409);
    expect(locked.body.details).toEqual(inUse.details);
  });
});
