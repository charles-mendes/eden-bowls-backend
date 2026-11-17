const crypto = require('crypto');
const { HttpError } = require('../src/core/http-error');
const { MediaLibraryService } = require('../src/services/media-library.service');

const ADMIN = { userId: 7, roles: ['admin'] };
const BR_OPERATOR = { userId: 8, roles: ['operator'], markets: ['BR'] };
const PNG = Buffer.from('designer-png-bytes');

function sha(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// In-memory library; usedBy is set by the test per image id.
function setup({ processImage } = {}) {
  const rows = new Map();
  const usedBy = new Map();
  let nextId = 1;
  const view = (row) => (row ? { ...row, archived: row.archivedAt != null, usedBy: usedBy.get(row.id) || [] } : null);
  const repository = {
    findByHash: jest.fn(async ({ market, kind, sha256 }) => view([...rows.values()].find((row) => row.market === market && row.kind === kind && row.sha256 === sha256))),
    findById: jest.fn(async (id) => view(rows.get(id))),
    insert: jest.fn(async (input) => {
      const row = { id: nextId++, ...input, archivedAt: null };
      rows.set(row.id, row);
      return view(row);
    }),
    list: jest.fn(async () => [...rows.values()].map(view)),
    archive: jest.fn(async (id) => {
      if ((usedBy.get(id) || []).length === 0) {
        rows.get(id).archivedAt = '2026-10-28T12:00:00.000Z';
      }
      return view(rows.get(id));
    }),
    restore: jest.fn(async (id) => {
      rows.get(id).archivedAt = null;
      return view(rows.get(id));
    })
  };
  const imageStorage = {
    writeAsset: jest.fn(async ({ market, kind }) => `/recipe-images/${kind}-${market.toLowerCase()}-${String(nextId).padStart(32, '0')}.webp`),
    delete: jest.fn()
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new MediaLibraryService({
    repository,
    imageStorage,
    auditService,
    processImage: processImage || jest.fn(async () => ({ buffer: Buffer.from('webp'), mimeType: 'image/webp', ext: 'webp', width: 400, height: 400 }))
  });
  return { service, repository, imageStorage, auditService, rows, usedBy };
}

function payload(overrides = {}) {
  return { kind: 'plan', market: 'BR', originalFilename: 'adulto-carne_400.png', mimeType: 'image/png', imageBase64: PNG.toString('base64'), ...overrides };
}

describe('MediaLibraryService', () => {
  test('stores a plan image of the market as WebP with the hash of the uploaded bytes and audits it', async () => {
    const { service, repository, imageStorage, auditService } = setup();

    const result = await service.upload(payload(), ADMIN);

    expect(imageStorage.writeAsset).toHaveBeenCalledWith({ market: 'BR', kind: 'plan', buffer: Buffer.from('webp') });
    expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'plan', market: 'BR', originalFilename: 'adulto-carne_400.png', mimeType: 'image/webp', width: 400, height: 400, bytes: 4, sha256: sha(PNG), uploadedBy: 7
    }));
    expect(result).toMatchObject({ duplicate: false, asset: { id: 1, market: 'BR', archived: false } });
    expect(auditService.record).toHaveBeenCalledWith({
      actor: ADMIN,
      action: 'media.upload',
      metadata: { market: 'BR', assetId: 1, originalFilename: 'adulto-carne_400.png' }
    });
  });

  test('a refused image stores nothing', async () => {
    const refusal = new HttpError(422, 'Image must be 400 x 400 pixels.', { code: 'recipe_image_invalid', width: 200, expectedWidth: 400 });
    const { service, repository, imageStorage } = setup({ processImage: jest.fn().mockRejectedValue(refusal) });

    await expect(service.upload(payload({ originalFilename: 'adulto-carne_200.png' }), ADMIN)).rejects.toBe(refusal);
    expect(imageStorage.writeAsset).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  test('stores a banner of the market at the banner size, validated as a banner', async () => {
    const processImage = jest.fn(async () => ({ buffer: Buffer.from('webp'), mimeType: 'image/webp', ext: 'webp', width: 1024, height: 636 }));
    const { service, repository, imageStorage } = setup({ processImage });

    const result = await service.upload(payload({ kind: 'banner', originalFilename: 'filhote-frango-porco.png' }), ADMIN);

    expect(processImage).toHaveBeenCalledWith({ mimeType: 'image/png', buffer: PNG, kind: 'banner' });
    expect(imageStorage.writeAsset).toHaveBeenCalledWith({ market: 'BR', kind: 'banner', buffer: Buffer.from('webp') });
    expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'banner', market: 'BR', originalFilename: 'filhote-frango-porco.png', width: 1024, height: 636
    }));
    expect(result.duplicate).toBe(false);
    expect(result.asset.url).toMatch(/^\/recipe-images\/banner-br-[0-9]{32}\.webp$/);
  });

  test('the same bytes as a plan image and as a banner are two images', async () => {
    const { service, imageStorage } = setup();
    const plan = await service.upload(payload(), ADMIN);
    const banner = await service.upload(payload({ kind: 'banner' }), ADMIN);
    expect(banner.asset.id).not.toBe(plan.asset.id);
    expect(imageStorage.writeAsset).toHaveBeenCalledTimes(2);
  });

  test('refuses an unknown kind before reading the image', async () => {
    const { service, imageStorage } = setup();
    await expect(service.upload(payload({ kind: 'avatar' }), ADMIN))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'media_asset_invalid' } });
    expect(imageStorage.writeAsset).not.toHaveBeenCalled();
  });

  test('the same bytes in the same market return the stored image without a second file', async () => {
    const { service, imageStorage } = setup();

    const first = await service.upload(payload(), ADMIN);
    const second = await service.upload(payload(), ADMIN);

    expect(second).toEqual({ duplicate: true, asset: first.asset });
    expect(imageStorage.writeAsset).toHaveBeenCalledTimes(1);
  });

  test('the same bytes in another market are a second image', async () => {
    const { service, imageStorage } = setup();

    const br = await service.upload(payload(), ADMIN);
    const us = await service.upload(payload({ market: 'US', originalFilename: 'adult-beef_400.png' }), ADMIN);

    expect(us.duplicate).toBe(false);
    expect(us.asset.id).not.toBe(br.asset.id);
    expect(imageStorage.writeAsset).toHaveBeenCalledTimes(2);
  });

  test('re-uploading an archived image restores it', async () => {
    const { service } = setup();
    const { asset } = await service.upload(payload(), ADMIN);
    await service.archive(asset.id, ADMIN);

    const again = await service.upload(payload(), ADMIN);

    expect(again).toMatchObject({ duplicate: true, asset: { id: asset.id, archived: false } });
  });

  test('a concurrent upload of the same bytes returns the image stored first', async () => {
    const { service, repository } = setup();
    const stored = await service.upload(payload(), ADMIN);
    repository.findByHash.mockResolvedValueOnce(null);
    repository.insert.mockResolvedValueOnce(null);

    const result = await service.upload(payload(), ADMIN);

    expect(result).toEqual({ duplicate: true, asset: stored.asset });
  });

  test('an image in use is not archived and the refusal names its recipes', async () => {
    const { service, usedBy, auditService } = setup();
    const { asset } = await service.upload(payload(), ADMIN);
    usedBy.set(asset.id, [{ key: 'beef', name: 'Adulto Carne', market: 'BR' }]);
    auditService.record.mockClear();

    await expect(service.archive(asset.id, ADMIN)).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'media_asset_in_use', usedBy: [{ key: 'beef', name: 'Adulto Carne', market: 'BR' }] }
    });
    expect(auditService.record).not.toHaveBeenCalled();
  });

  test('archives and restores an unused image, auditing each and keeping its file', async () => {
    const { service, imageStorage, auditService } = setup();
    const { asset } = await service.upload(payload(), ADMIN);

    const archived = await service.archive(asset.id, ADMIN);
    const again = await service.archive(asset.id, ADMIN);
    const restored = await service.restore(asset.id, ADMIN);

    expect(archived.archived).toBe(true);
    expect(again.archived).toBe(true);
    expect(restored.archived).toBe(false);
    expect(auditService.record.mock.calls.map(([entry]) => entry.action)).toEqual(['media.upload', 'media.archive', 'media.restore']);
    expect(imageStorage.delete).not.toHaveBeenCalled();
  });

  test('an operator limited to BR cannot upload, list or archive US images', async () => {
    const { service, imageStorage } = setup();
    const { asset } = await service.upload(payload({ market: 'US' }), ADMIN);

    await expect(service.upload(payload({ market: 'US' }), BR_OPERATOR)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.list({ market: 'US', kind: 'plan' }, BR_OPERATOR)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.archive(asset.id, BR_OPERATOR)).rejects.toMatchObject({ statusCode: 404 });
    expect(imageStorage.writeAsset).toHaveBeenCalledTimes(1);
  });

  test('lists archived images only when asked', async () => {
    const { service, repository } = setup();
    await service.list({ market: 'br', kind: 'plan' }, ADMIN);
    await service.list({ market: 'BR', kind: 'plan', archived: 'true' }, ADMIN);
    expect(repository.list.mock.calls.map(([query]) => query)).toEqual([
      { market: 'BR', kind: 'plan', archived: false },
      { market: 'BR', kind: 'plan', archived: true }
    ]);
  });

  test('has no way to delete an image', () => {
    const methods = Object.getOwnPropertyNames(MediaLibraryService.prototype);
    expect(methods.filter((name) => /delete|remove|destroy/i.test(name))).toEqual([]);
  });
});
