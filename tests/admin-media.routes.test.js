const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { HttpError } = require('../src/core/http-error');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function token() {
  return issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

const asset = {
  id: 12,
  kind: 'plan',
  market: 'BR',
  url: '/recipe-images/plan-br-0123456789abcdef0123456789abcdef.webp',
  originalFilename: 'adulto-carne_400.png',
  archived: false,
  usedBy: []
};

function appFor({ role = 'operator', markets = ['BR'], service = {} } = {}) {
  const mediaLibraryService = {
    list: jest.fn().mockResolvedValue({ market: 'BR', items: [asset] }),
    upload: jest.fn().mockResolvedValue({ asset, duplicate: false }),
    archive: jest.fn().mockResolvedValue({ ...asset, archived: true }),
    restore: jest.fn().mockResolvedValue(asset),
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
    mediaLibraryService
  });
  return { app, mediaLibraryService };
}

const upload = { kind: 'plan', market: 'BR', originalFilename: 'adulto-carne_400.png', mimeType: 'image/png', imageBase64: Buffer.from('png').toString('base64') };

describe('admin media routes', () => {
  test('readonly lists the library of its market', async () => {
    const { app, mediaLibraryService } = appFor({ role: 'readonly' });

    const response = await request(app).get('/api/v1/admin/media?market=BR&kind=plan&archived=true').set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([asset]);
    expect(mediaLibraryService.list).toHaveBeenCalledWith(expect.objectContaining({ market: 'BR', kind: 'plan', archived: 'true' }), expect.objectContaining({ userId: '7' }));
  });

  test('upload answers 201 for a new image and 200 with duplicate for known bytes', async () => {
    const { app, mediaLibraryService } = appFor();

    const created = await request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${token()}`).send(upload);
    mediaLibraryService.upload.mockResolvedValueOnce({ asset, duplicate: true });
    const again = await request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${token()}`).send(upload);

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 12, duplicate: false });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: 12, duplicate: true });
    expect(mediaLibraryService.upload).toHaveBeenCalledWith(upload, expect.objectContaining({ userId: '7' }));
  });

  test('a banner uploads, deduplicates and lists through the same routes', async () => {
    const banner = { ...asset, id: 31, kind: 'banner', url: '/recipe-images/banner-br-0123456789abcdef0123456789abcdef.webp', originalFilename: 'filhote-frango-porco.png' };
    const { app, mediaLibraryService } = appFor({
      service: {
        upload: jest.fn().mockResolvedValueOnce({ asset: banner, duplicate: false }).mockResolvedValueOnce({ asset: banner, duplicate: true }),
        list: jest.fn().mockResolvedValue({ market: 'BR', items: [banner] })
      }
    });
    const bannerUpload = { ...upload, kind: 'banner', originalFilename: 'filhote-frango-porco.png' };

    const created = await request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${token()}`).send(bannerUpload);
    const again = await request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${token()}`).send(bannerUpload);
    const listed = await request(app).get('/api/v1/admin/media?market=BR&kind=banner').set('Authorization', `Bearer ${token()}`);

    expect([created.status, again.status]).toEqual([201, 200]);
    expect(again.body).toMatchObject({ id: 31, kind: 'banner', duplicate: true });
    expect(mediaLibraryService.upload).toHaveBeenCalledWith(bannerUpload, expect.objectContaining({ userId: '7' }));
    expect(listed.body.items).toEqual([banner]);
    expect(mediaLibraryService.list).toHaveBeenCalledWith(expect.objectContaining({ market: 'BR', kind: 'banner' }), expect.anything());
  });

  test('accepts a 5 MB image in base64', async () => {
    const { app } = appFor();
    const imageBase64 = Buffer.alloc(5 * 1024 * 1024).toString('base64');

    const response = await request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${token()}`).send({ ...upload, imageBase64 });

    expect(response.status).toBe(201);
  });

  test('readonly cannot upload, archive or restore', async () => {
    const { app, mediaLibraryService } = appFor({ role: 'readonly' });

    const responses = await Promise.all([
      request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${token()}`).send(upload),
      request(app).post('/api/v1/admin/media/12/archive').set('Authorization', `Bearer ${token()}`),
      request(app).post('/api/v1/admin/media/12/restore').set('Authorization', `Bearer ${token()}`)
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expect(mediaLibraryService.upload).not.toHaveBeenCalled();
    expect(mediaLibraryService.archive).not.toHaveBeenCalled();
  });

  test('an operator limited to BR cannot upload or list US', async () => {
    const { app, mediaLibraryService } = appFor();

    const uploaded = await request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${token()}`).send({ ...upload, market: 'US' });
    const listed = await request(app).get('/api/v1/admin/media?market=US&kind=plan').set('Authorization', `Bearer ${token()}`);

    expect(uploaded.status).toBe(403);
    expect(listed.status).toBe(403);
    expect(mediaLibraryService.upload).not.toHaveBeenCalled();
  });

  test('archiving an image in use answers 409 with its recipes', async () => {
    const usedBy = [{ key: 'beef', name: 'Adulto Carne', market: 'BR' }];
    const { app } = appFor({
      service: { archive: jest.fn().mockRejectedValue(new HttpError(409, 'A library image in use cannot be archived.', { code: 'media_asset_in_use', usedBy })) }
    });

    const response = await request(app).post('/api/v1/admin/media/12/archive').set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(409);
    expect(response.body.details).toMatchObject({ code: 'media_asset_in_use', usedBy });
  });

  test('archiving a banner in use answers 409 with its recipes', async () => {
    const usedBy = [{ key: 'senior-beef', name: 'Sênior Carne', market: 'BR' }];
    const { app } = appFor({
      service: { archive: jest.fn().mockRejectedValue(new HttpError(409, 'A library image in use cannot be archived.', { code: 'media_asset_in_use', usedBy })) }
    });

    const response = await request(app).post('/api/v1/admin/media/31/archive').set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(409);
    expect(response.body.details).toMatchObject({ code: 'media_asset_in_use', usedBy });
  });

  test('archive and restore pass the image id', async () => {
    const { app, mediaLibraryService } = appFor();

    const archived = await request(app).post('/api/v1/admin/media/12/archive').set('Authorization', `Bearer ${token()}`);
    const restored = await request(app).post('/api/v1/admin/media/12/restore').set('Authorization', `Bearer ${token()}`);

    expect(archived.body.archived).toBe(true);
    expect(restored.body.archived).toBe(false);
    expect(mediaLibraryService.archive).toHaveBeenCalledWith('12', expect.objectContaining({ userId: '7' }));
    expect(mediaLibraryService.restore).toHaveBeenCalledWith('12', expect.objectContaining({ userId: '7' }));
  });

  test('there is no delete route', async () => {
    const { app } = appFor({ role: 'admin', markets: ['BR', 'US'] });

    const response = await request(app).delete('/api/v1/admin/media/12').set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(404);
  });
});
