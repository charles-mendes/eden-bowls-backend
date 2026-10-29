const { RecipeContentService } = require('../src/services/recipe-content.service');

const SENIOR_BEEF_BR = [
  { id: '301', name: 'Sênior Carne 300g', sku: 'SENIOR-BEEF-300', active: false },
  { id: '302', name: 'Sênior Carne 500g', sku: 'SENIOR-BEEF-500', active: false }
];

// Registered recipes every test starts with; `stored` replaces one of them.
const REGISTERED = [
  { market: 'BR', flavorSlug: 'senior-beef', name: 'Sênior Carne', lifeStage: 'senior', imageUrl: null, label: null },
  { market: 'US', flavorSlug: 'beef', name: 'Beef', imageUrl: null, label: null },
  { market: 'BR', flavorSlug: 'senior-lamb', name: 'Sênior Cordeiro', lifeStage: 'senior', imageUrl: '/recipe-images/lamb.webp', label: null }
];

// Library images by id; `upload` adds one per call.
const LIBRARY = [
  { id: 12, kind: 'plan', market: 'BR', url: '/recipe-images/plan-br-12.webp', archived: false },
  { id: 13, kind: 'plan', market: 'US', url: '/recipe-images/plan-us-13.webp', archived: false },
  { id: 14, kind: 'plan', market: 'BR', url: '/recipe-images/plan-br-14.webp', archived: true },
  { id: 31, kind: 'banner', market: 'BR', url: '/recipe-images/banner-br-31.webp', archived: false },
  { id: 32, kind: 'banner', market: 'US', url: '/recipe-images/banner-us-32.webp', archived: false },
  { id: 33, kind: 'banner', market: 'BR', url: '/recipe-images/banner-br-33.webp', archived: true }
];

function setup({ variations = SENIOR_BEEF_BR, stored = null } = {}) {
  const library = new Map(LIBRARY.map((asset) => [asset.id, { ...asset }]));
  const mediaLibraryService = {
    get: jest.fn(async (id) => {
      const asset = library.get(Number(id));
      if (!asset) {
        throw Object.assign(new Error('Library image not found.'), { statusCode: 404 });
      }
      return asset;
    }),
    upload: jest.fn(async ({ market, kind }) => {
      const asset = { id: 100 + library.size, kind, market, url: `/recipe-images/${kind}-${market.toLowerCase()}-${100 + library.size}.webp`, archived: false };
      library.set(asset.id, asset);
      return { asset, duplicate: false };
    })
  };
  const rows = new Map(REGISTERED.map((row) => [`${row.market}:${row.flavorSlug}`, { ...row }]));
  if (stored) {
    rows.set(`${stored.market}:${stored.flavorSlug}`, { name: stored.flavorSlug, ...stored });
  }
  const repository = {
    findByMarketAndSlug: jest.fn(async (market, slug) => rows.get(`${market}:${slug}`) || null),
    listByMarket: jest.fn(async (market) => [...rows.values()].filter((row) => row.market === market)
      .sort((left, right) => left.flavorSlug.localeCompare(right.flavorSlug))),
    createRecipe: jest.fn(async ({ market, flavorSlug, name, lifeStage }) => {
      const row = { market, flavorSlug, name, lifeStage, imageUrl: null, label: null };
      rows.set(`${market}:${flavorSlug}`, row);
      return row;
    }),
    updateRecipe: jest.fn(async ({ market, flavorSlug, name, lifeStage }) => {
      const current = rows.get(`${market}:${flavorSlug}`);
      const row = { ...current, name: name === undefined ? current.name : name, lifeStage: lifeStage === undefined ? current.lifeStage : lifeStage };
      rows.set(`${market}:${flavorSlug}`, row);
      return row;
    }),
    deleteRecipe: jest.fn(async ({ market, flavorSlug }) => {
      rows.delete(`${market}:${flavorSlug}`);
    }),
    upsertLabel: jest.fn(async ({ market, flavorSlug, label }) => {
      const row = { ...(rows.get(`${market}:${flavorSlug}`) || { market, flavorSlug, imageUrl: null }), label };
      rows.set(`${market}:${flavorSlug}`, row);
      return row;
    }),
    upsertPresentation: jest.fn(async ({ market, flavorSlug, presentation }) => {
      const row = { ...rows.get(`${market}:${flavorSlug}`), presentation };
      rows.set(`${market}:${flavorSlug}`, row);
      return row;
    }),
    setImage: jest.fn(async ({ market, flavorSlug, assetId }) => link(market, flavorSlug, assetId, 'imageUrl', 'imageAssetId')),
    setPlanImage: jest.fn(async ({ market, flavorSlug, assetId }) => link(market, flavorSlug, assetId, 'planImageUrl', 'planImageAssetId'))
  };
  // Links a library image into a recipe row like the repository: an archived image is refused.
  function link(market, flavorSlug, assetId, urlField, idField) {
    const asset = assetId == null ? null : library.get(assetId);
    if (asset && asset.archived) {
      throw Object.assign(new Error('archived'), { statusCode: 409, details: { code: 'media_asset_archived' } });
    }
    const row = { ...rows.get(`${market}:${flavorSlug}`), [urlField]: asset ? asset.url : null, [idField]: asset ? asset.id : null };
    rows.set(`${market}:${flavorSlug}`, row);
    return row;
  }
  const catalogRepository = {
    listRecipeVariations: jest.fn(async (market, key) => (market === 'BR' && key === 'senior-beef') || (market === 'US' && key === 'beef') ? variations : []),
    setRecipeLifeStage: jest.fn().mockResolvedValue(undefined)
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new RecipeContentService({
    repository,
    catalogRepository,
    mediaLibraryService,
    auditService
  });
  return { service, repository, catalogRepository, mediaLibraryService, auditService, rows, library };
}

const actor = { userId: '7', email: 'ops@edenbowls.com' };
const upload = { mimeType: 'image/png', imageBase64: Buffer.from('png').toString('base64') };

describe('RecipeContentService', () => {
  test('one image serves every size of the flavor in that market only', async () => {
    const { service, repository, library } = setup();

    const result = await service.uploadImage('br', 'senior-beef', upload, actor);

    expect(result).toMatchObject({
      market: 'BR',
      flavorSlug: 'senior-beef',
      name: 'Sênior Carne',
      imageUrl: library.get(result.imageAssetId).url,
      labelStatus: 'missing',
      variations: SENIOR_BEEF_BR
    });
    expect(library.get(result.imageAssetId)).toMatchObject({ kind: 'banner', market: 'BR' });
    expect(repository.setImage).toHaveBeenCalledWith({ market: 'BR', flavorSlug: 'senior-beef', assetId: result.imageAssetId, actorId: 7 });
    await expect(service.get('US', 'senior-beef')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('admin routes need a registered key as sent, so a flavor alias does not reach a recipe', async () => {
    const { service, repository } = setup({ variations: [{ id: '11', name: 'Beef', sku: 'B', active: true }] });

    await expect(service.get('US', 'bovino')).rejects.toMatchObject({ statusCode: 404, details: { code: 'recipe_not_found' } });
    expect(repository.findByMarketAndSlug).toHaveBeenCalledWith('US', 'bovino');
    expect(repository.findByMarketAndSlug).not.toHaveBeenCalledWith('US', 'beef');
  });

  test('lists every registered recipe of the market, with or without variations', async () => {
    const { service, catalogRepository } = setup();
    catalogRepository.listMarketRecipeVariations = jest.fn().mockResolvedValue(new Map([['senior-beef', SENIOR_BEEF_BR]]));

    const result = await service.list('br');

    expect(result).toEqual({
      market: 'BR',
      items: [
        { key: 'senior-beef', name: 'Sênior Carne', lifeStage: 'senior', imageUrl: null, planImageUrl: null, labelStatus: 'missing', variations: SENIOR_BEEF_BR },
        { key: 'senior-lamb', name: 'Sênior Cordeiro', lifeStage: 'senior', imageUrl: '/recipe-images/lamb.webp', planImageUrl: null, labelStatus: 'missing', variations: [] }
      ]
    });
  });

  describe('public list', () => {
    // Variations per market and key; the single-recipe lookup and the market listing read the same data.
    function withVariations(byMarket) {
      const context = setup();
      const variationsOf = (market, key) => (byMarket[market] && byMarket[market][key]) || [];
      context.catalogRepository.listRecipeVariations = jest.fn(async (market, key) => variationsOf(market, key));
      context.catalogRepository.listMarketRecipeVariations = jest.fn(async (market) => new Map(Object.entries(byMarket[market] || {})));
      return context;
    }

    test('senior line launched in BR only', async () => {
      const { service } = withVariations({
        BR: { 'senior-beef': [{ id: '301', name: 'Sênior Carne 300g', sku: 'SENIOR-BEEF-300', active: true }] },
        US: { beef: [{ id: '11', name: 'Beef', sku: 'B', active: true }] }
      });

      await expect(service.listPublic('br')).resolves.toEqual({
        market: 'BR',
        items: [{ key: 'senior-beef', name: 'Sênior Carne', lifeStage: 'senior', title: null, tag: null }]
      });
      const us = await service.listPublic('US');
      expect(us.items.map((item) => item.key)).toEqual(['beef']);
    });

    test('deactivating the last variation removes the recipe', async () => {
      const { service } = withVariations({ BR: { 'senior-beef': SENIOR_BEEF_BR } });

      await expect(service.listPublic('BR')).resolves.toEqual({ market: 'BR', items: [] });
      await expect(service.getPublic('senior-beef', 'BR')).rejects.toMatchObject({ statusCode: 404 });
    });

    test('every listed key resolves on the single-recipe route', async () => {
      const { service } = withVariations({
        BR: {
          'senior-beef': [{ id: '301', name: 'Sênior Carne 300g', sku: 'SENIOR-BEEF-300', active: true }, SENIOR_BEEF_BR[1]],
          'senior-lamb': [{ id: '401', name: 'Sênior Cordeiro 300g', sku: 'SENIOR-LAMB-300', active: true }]
        }
      });

      const { items } = await service.listPublic('BR');

      expect(items.map((item) => item.key)).toEqual(['senior-beef', 'senior-lamb']);
      for (const item of items) {
        await expect(service.getPublic(item.key, 'BR')).resolves.toMatchObject({ key: item.key, market: 'BR' });
      }
    });

    test('an unknown market is refused', async () => {
      const { service } = withVariations({});

      await expect(service.listPublic('AR')).rejects.toMatchObject({ statusCode: 400, details: { code: 'invalid_market' } });
    });
  });

  describe('registration', () => {
    test('registers a recipe without variations that can then hold an image', async () => {
      const { service, repository, auditService, library } = setup({ variations: [] });

      const created = await service.create('BR', { key: 'senior-duck', name: '  Sênior Pato  ', lifeStage: 'senior' }, actor);
      const withImage = await service.uploadImage('BR', 'senior-duck', upload, actor);

      expect(repository.createRecipe).toHaveBeenCalledWith({ market: 'BR', flavorSlug: 'senior-duck', name: 'Sênior Pato', lifeStage: 'senior', actorId: 7 });
      expect(created).toMatchObject({ flavorSlug: 'senior-duck', name: 'Sênior Pato', lifeStage: 'senior', variations: [], imageUrl: null });
      expect(withImage.imageUrl).toBe(library.get(withImage.imageAssetId).url);
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'catalog.recipe.create',
        metadata: { market: 'BR', flavorSlug: 'senior-duck', name: 'Sênior Pato', lifeStage: 'senior' }
      }));
    });

    test('refuses a key already registered in the market', async () => {
      const { service, repository } = setup();
      await expect(service.create('BR', { key: 'senior-beef', name: 'Outra' }, actor)).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'recipe_key_taken' }
      });
      expect(repository.createRecipe).not.toHaveBeenCalled();
    });

    test('maps a duplicate insert race to recipe_key_taken', async () => {
      const { service, repository } = setup();
      repository.createRecipe.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));
      await expect(service.create('BR', { key: 'senior-duck', name: 'Pato' }, actor)).rejects.toMatchObject({ details: { code: 'recipe_key_taken' } });
    });

    test.each([
      [{ key: 'Senior Duck', name: 'Pato' }, 'recipe_key_invalid'],
      [{ key: '', name: 'Pato' }, 'recipe_key_invalid'],
      [{ key: 'senior-duck', name: '   ' }, 'recipe_name_invalid'],
      [{ key: 'senior-duck', name: 'x'.repeat(121) }, 'recipe_name_invalid']
    ])('refuses %j', async (input, code) => {
      const { service } = setup();
      await expect(service.create('BR', input, actor)).rejects.toMatchObject({ statusCode: 422, details: { code } });
    });

    test('renames and keeps the key and the variations', async () => {
      const { service, auditService } = setup();

      const renamed = await service.update('BR', 'senior-beef', { name: 'Carne Sênior' }, actor);

      expect(renamed).toMatchObject({ flavorSlug: 'senior-beef', name: 'Carne Sênior', lifeStage: 'senior', variations: SENIOR_BEEF_BR });
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'catalog.recipe.rename',
        metadata: { market: 'BR', flavorSlug: 'senior-beef', from: 'Sênior Carne', to: 'Carne Sênior' }
      }));
    });

    test('changes the life stage and moves every variation of the recipe to it', async () => {
      const { service, catalogRepository, auditService } = setup();

      const updated = await service.update('BR', 'senior-beef', { lifeStage: 'adult' }, actor);

      expect(updated).toMatchObject({ name: 'Sênior Carne', lifeStage: 'adult' });
      expect(catalogRepository.setRecipeLifeStage).toHaveBeenCalledWith('BR', 'senior-beef', 'adult');
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'catalog.recipe.life_stage',
        metadata: { market: 'BR', flavorSlug: 'senior-beef', from: 'senior', to: 'adult' }
      }));
    });

    test('keeps the variations when the life stage does not change', async () => {
      const { service, catalogRepository } = setup();
      await service.update('BR', 'senior-beef', { lifeStage: 'senior' }, actor);
      expect(catalogRepository.setRecipeLifeStage).not.toHaveBeenCalled();
    });

    test.each([
      [{}, 'recipe_update_empty'],
      [{ lifeStage: 'kitten' }, 'recipe_life_stage_invalid']
    ])('refuses the update %j', async (input, code) => {
      const { service } = setup();
      await expect(service.update('BR', 'senior-beef', input, actor)).rejects.toMatchObject({ statusCode: 422, details: { code } });
    });

    test('refuses to delete a recipe used by variations, naming them', async () => {
      const { service, repository } = setup();

      await expect(service.remove('BR', 'senior-beef', actor)).rejects.toMatchObject({
        statusCode: 409,
        details: {
          code: 'recipe_in_use',
          variations: [
            { id: '301', sku: 'SENIOR-BEEF-300', name: 'Sênior Carne 300g' },
            { id: '302', sku: 'SENIOR-BEEF-500', name: 'Sênior Carne 500g' }
          ]
        }
      });
      expect(repository.deleteRecipe).not.toHaveBeenCalled();
    });

    test('deletes an unused recipe and only unlinks its banner, which stays in the library', async () => {
      const { service, repository, auditService, library } = setup({
        variations: [],
        stored: { market: 'BR', flavorSlug: 'senior-lamb', name: 'Sênior Cordeiro', imageUrl: '/recipe-images/banner-br-31.webp', imageAssetId: 31, label: null }
      });

      const result = await service.remove('BR', 'senior-lamb', actor);

      expect(result).toEqual({ deleted: true, market: 'BR', flavorSlug: 'senior-lamb' });
      expect(repository.deleteRecipe).toHaveBeenCalledWith({ market: 'BR', flavorSlug: 'senior-lamb' });
      expect(library.get(31)).toMatchObject({ archived: false, url: '/recipe-images/banner-br-31.webp' });
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'catalog.recipe.delete' }));
      await expect(service.get('BR', 'senior-lamb')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('banner', () => {
    const LINKED = { market: 'BR', flavorSlug: 'senior-beef', name: 'Sênior Carne', lifeStage: 'senior', imageUrl: '/recipe-images/banner-br-31.webp', imageAssetId: 31, label: null };

    test('links an existing library banner by id and audits the image id', async () => {
      const { service, repository, auditService } = setup();

      const result = await service.uploadImage('BR', 'senior-beef', { assetId: 31 }, actor);

      expect(repository.setImage).toHaveBeenCalledWith({ market: 'BR', flavorSlug: 'senior-beef', assetId: 31, actorId: 7 });
      expect(result).toMatchObject({ imageAssetId: 31, imageUrl: '/recipe-images/banner-br-31.webp' });
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'catalog.recipe.image.update',
        metadata: { market: 'BR', flavorSlug: 'senior-beef', assetId: 31 }
      }));
    });

    test('refuses a plan thumbnail and a banner of another market, keeping the current banner', async () => {
      const { service, repository } = setup({ stored: LINKED });

      await expect(service.uploadImage('BR', 'senior-beef', { assetId: 12 }, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'media_asset_invalid', reason: 'kind' } });
      await expect(service.uploadImage('BR', 'senior-beef', { assetId: 32 }, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'media_asset_invalid', reason: 'market' } });
      expect(repository.setImage).not.toHaveBeenCalled();
    });

    test('refuses an archived banner and an unknown one, keeping the current banner', async () => {
      const { service, rows } = setup({ stored: LINKED });

      await expect(service.uploadImage('BR', 'senior-beef', { assetId: 33 }, actor))
        .rejects.toMatchObject({ statusCode: 409, details: { code: 'media_asset_archived' } });
      await expect(service.uploadImage('BR', 'senior-beef', { assetId: 99 }, actor)).rejects.toMatchObject({ statusCode: 404 });
      expect(rows.get('BR:senior-beef').imageAssetId).toBe(31);
    });

    test('refuses a body with both an asset id and an image, or with neither', async () => {
      const { service } = setup();
      await expect(service.uploadImage('BR', 'senior-beef', { assetId: 31, ...upload }, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'media_asset_invalid' } });
      await expect(service.uploadImage('BR', 'senior-beef', {}, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'media_asset_invalid' } });
    });

    test('an upload goes into the banner library of the recipe market and replaces the link, keeping the old banner', async () => {
      const { service, mediaLibraryService, library } = setup({ stored: LINKED });

      const result = await service.uploadImage('BR', 'senior-beef', { ...upload, originalFilename: 'senior-carne.png' }, actor);

      expect(mediaLibraryService.upload).toHaveBeenCalledWith(
        { kind: 'banner', market: 'BR', originalFilename: 'senior-carne.png', mimeType: 'image/png', imageBase64: upload.imageBase64 },
        actor
      );
      expect(result.imageAssetId).not.toBe(31);
      expect(result.imageUrl).toBe(library.get(result.imageAssetId).url);
      expect(library.get(31)).toMatchObject({ archived: false, url: '/recipe-images/banner-br-31.webp' });
    });

    test('a backfilled banner stays in the library when a new one is uploaded', async () => {
      const backfilled = { id: 40, kind: 'banner', market: 'BR', url: '/recipe-images/recipe-br-turkey-0123456789abcdef0123456789abcdef.webp', archived: false };
      const { service, library } = setup({
        stored: { market: 'BR', flavorSlug: 'senior-beef', name: 'Sênior Carne', imageUrl: backfilled.url, imageAssetId: 40, label: null }
      });
      library.set(40, backfilled);

      const result = await service.uploadImage('BR', 'senior-beef', upload, actor);

      expect(result.imageAssetId).not.toBe(40);
      expect(library.get(40)).toEqual(backfilled);
    });

    test('the upload is named after the recipe when the file name is missing', async () => {
      const { service, mediaLibraryService } = setup();
      await service.uploadImage('BR', 'senior-beef', upload, actor);
      expect(mediaLibraryService.upload).toHaveBeenCalledWith(expect.objectContaining({ kind: 'banner', originalFilename: 'senior-beef-banner' }), actor);
    });

    test('a 1200 x 800 upload is refused by the real image check and keeps the current banner', async () => {
      const sharp = require('sharp');
      const { MediaLibraryService } = require('../src/services/media-library.service');
      const { processRecipeImage } = require('../src/infrastructure/imaging/recipe-image');
      const { rows, repository } = setup({ stored: LINKED });
      const writeAsset = jest.fn();
      const realLibrary = new MediaLibraryService({ repository: {}, imageStorage: { writeAsset }, processImage: processRecipeImage });
      const service = new RecipeContentService({ repository, catalogRepository: { listRecipeVariations: async () => [] }, mediaLibraryService: realLibrary });
      const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 244, g: 239, b: 227 } } }).png().toBuffer();

      await expect(service.uploadImage('BR', 'senior-beef', { mimeType: 'image/png', imageBase64: png.toString('base64') }, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'recipe_image_invalid', width: 1200, height: 800, expectedWidth: 1024, expectedHeight: 636 } });
      expect(writeAsset).not.toHaveBeenCalled();
      expect(rows.get('BR:senior-beef').imageAssetId).toBe(31);
    });

    test('refuses to remove the banner while a variation of the flavor is active', async () => {
      const stored = { market: 'US', flavorSlug: 'beef', imageUrl: '/recipe-images/banner-us-32.webp', imageAssetId: 32, label: null };
      const { service, repository } = setup({ stored, variations: [{ id: '11', name: 'Beef 300g', sku: 'B-300', active: true }] });

      await expect(service.removeImage('US', 'beef', actor)).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'recipe_content_in_use', activeVariations: ['11'] }
      });
      expect(repository.setImage).not.toHaveBeenCalled();
    });

    test('removing the banner with every variation inactive only unlinks it, and it links again to the same URL', async () => {
      const { service, auditService, library } = setup({ stored: LINKED });

      const removed = await service.removeImage('BR', 'senior-beef', actor);
      const linkedAgain = await service.uploadImage('BR', 'senior-beef', { assetId: 31 }, actor);

      expect(removed).toMatchObject({ imageUrl: null, imageAssetId: null });
      expect(library.get(31)).toMatchObject({ archived: false, url: '/recipe-images/banner-br-31.webp' });
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'catalog.recipe.image.delete',
        metadata: { market: 'BR', flavorSlug: 'senior-beef', assetId: 31 }
      }));
      expect(linkedAgain.imageUrl).toBe('/recipe-images/banner-br-31.webp');
    });

    test('removing a recipe without a banner changes nothing', async () => {
      const { service, repository } = setup();
      await service.removeImage('BR', 'senior-beef', actor);
      expect(repository.setImage).not.toHaveBeenCalled();
    });
  });

  describe('plan thumbnail', () => {
    const LINKED = { market: 'BR', flavorSlug: 'senior-beef', name: 'Sênior Carne', lifeStage: 'senior', imageUrl: '/recipe-images/banner.webp', planImageUrl: '/recipe-images/plan-br-12.webp', planImageAssetId: 12, label: null };

    test('links an existing library image by id, keeping the banner', async () => {
      const { service, repository, auditService, rows } = setup();

      const result = await service.uploadPlanImage('BR', 'senior-beef', { assetId: 12 }, actor);

      expect(repository.setPlanImage).toHaveBeenCalledWith({ market: 'BR', flavorSlug: 'senior-beef', assetId: 12, actorId: 7 });
      expect(result).toMatchObject({ planImageAssetId: 12, planImageUrl: '/recipe-images/plan-br-12.webp' });
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'catalog.recipe.plan_image.update',
        metadata: { market: 'BR', flavorSlug: 'senior-beef', assetId: 12 }
      }));
      expect(rows.get('BR:senior-beef').imageUrl).toBeNull();
    });

    test('refuses an image of another market and keeps the current thumbnail', async () => {
      const { service, repository } = setup({ stored: LINKED });

      await expect(service.uploadPlanImage('BR', 'senior-beef', { assetId: 13 }, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'media_asset_invalid' } });
      expect(repository.setPlanImage).not.toHaveBeenCalled();
    });

    test('refuses an archived image and an unknown one, keeping the current thumbnail', async () => {
      const { service, rows } = setup({ stored: LINKED });

      await expect(service.uploadPlanImage('BR', 'senior-beef', { assetId: 14 }, actor))
        .rejects.toMatchObject({ statusCode: 409, details: { code: 'media_asset_archived' } });
      await expect(service.uploadPlanImage('BR', 'senior-beef', { assetId: 99 }, actor)).rejects.toMatchObject({ statusCode: 404 });
      expect(rows.get('BR:senior-beef').planImageAssetId).toBe(12);
    });

    test('refuses a body with both an asset id and an image, or with neither', async () => {
      const { service } = setup();
      await expect(service.uploadPlanImage('BR', 'senior-beef', { assetId: 12, ...upload }, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'media_asset_invalid' } });
      await expect(service.uploadPlanImage('BR', 'senior-beef', {}, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'media_asset_invalid' } });
    });

    test('an upload goes into the library of the recipe market and replaces the link, keeping the old image', async () => {
      const { service, mediaLibraryService, library } = setup({ stored: LINKED });

      const result = await service.uploadPlanImage('BR', 'senior-beef', { ...upload, originalFilename: 'senior-carne_400.png' }, actor);

      expect(mediaLibraryService.upload).toHaveBeenCalledWith(
        { kind: 'plan', market: 'BR', originalFilename: 'senior-carne_400.png', mimeType: 'image/png', imageBase64: upload.imageBase64 },
        actor
      );
      expect(result.planImageAssetId).not.toBe(12);
      expect(result.planImageUrl).toBe(library.get(result.planImageAssetId).url);
      expect(library.get(12)).toBeTruthy();
    });

    test('unlinks the thumbnail even with an active variation, keeping the banner and the library image', async () => {
      const { service, auditService, library } = setup({
        variations: SENIOR_BEEF_BR.map((item) => ({ ...item, active: true })),
        stored: LINKED
      });

      const result = await service.removePlanImage('BR', 'senior-beef', actor);
      const linkedAgain = await service.uploadPlanImage('BR', 'senior-beef', { assetId: 12 }, actor);

      expect(result).toMatchObject({ imageUrl: '/recipe-images/banner.webp', planImageUrl: null, planImageAssetId: null });
      expect(library.get(12).archived).toBe(false);
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'catalog.recipe.plan_image.delete',
        metadata: { market: 'BR', flavorSlug: 'senior-beef', assetId: 12 }
      }));
      expect(linkedAgain.planImageUrl).toBe('/recipe-images/plan-br-12.webp');
    });

    test('deleting an unused recipe only unlinks its banner and its thumbnail', async () => {
      const { service, library } = setup({
        variations: [],
        stored: { ...LINKED, flavorSlug: 'senior-lamb', imageUrl: '/recipe-images/banner-br-31.webp', imageAssetId: 31 }
      });

      await service.remove('BR', 'senior-lamb', actor);

      expect(library.get(12)).toBeTruthy();
      expect(library.get(31)).toBeTruthy();
    });

    test('a 200 x 200 upload is refused by the real image check and keeps the current thumbnail', async () => {
      const sharp = require('sharp');
      const { MediaLibraryService } = require('../src/services/media-library.service');
      const { processRecipeImage } = require('../src/infrastructure/imaging/recipe-image');
      const { rows, repository } = setup({ stored: LINKED });
      const writeAsset = jest.fn();
      const realLibrary = new MediaLibraryService({ repository: {}, imageStorage: { writeAsset }, processImage: processRecipeImage });
      const service = new RecipeContentService({ repository, catalogRepository: { listRecipeVariations: async () => [] }, mediaLibraryService: realLibrary });
      const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 244, g: 239, b: 227 } } }).png().toBuffer();

      await expect(service.uploadPlanImage('BR', 'senior-beef', { mimeType: 'image/png', imageBase64: png.toString('base64') }, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'recipe_image_invalid', width: 200, expectedWidth: 400 } });
      expect(writeAsset).not.toHaveBeenCalled();
      expect(rows.get('BR:senior-beef').planImageAssetId).toBe(12);
    });

    test('the store view carries the thumbnail', async () => {
      const { service } = setup({
        variations: SENIOR_BEEF_BR.map((item) => ({ ...item, active: true })),
        stored: { market: 'BR', flavorSlug: 'senior-beef', name: 'Sênior Carne', imageUrl: null, planImageUrl: '/recipe-images/plan.webp', label: null }
      });

      await expect(service.getPublic('senior-beef', 'BR')).resolves.toMatchObject({ imageUrl: null, planImageUrl: '/recipe-images/plan.webp' });
    });
  });

  test('records one audit event per upload and removal, with market, flavor and library image', async () => {
    const { service, auditService } = setup();

    const uploaded = await service.uploadImage('BR', 'senior-beef', upload, actor);
    await service.removeImage('BR', 'senior-beef', actor);

    expect(auditService.record.mock.calls.map(([event]) => [event.action, event.metadata])).toEqual([
      ['catalog.recipe.image.update', { market: 'BR', flavorSlug: 'senior-beef', assetId: uploaded.imageAssetId }],
      ['catalog.recipe.image.delete', { market: 'BR', flavorSlug: 'senior-beef', assetId: uploaded.imageAssetId }]
    ]);
    expect(auditService.record.mock.calls[0][0].actor).toBe(actor);
  });

  test('refuses an unknown market', async () => {
    const { service } = setup();
    await expect(service.get('AR', 'beef')).rejects.toMatchObject({ statusCode: 400 });
  });

  describe('labels', () => {
    const complete = {
      ingredients: ['Beef', 'Potatoes'],
      analysis: [{ nutrient: 'Crude Protein (min)', value: '9.0%' }],
      energyKg: '1,200 kcal/kg',
      energyPackage: '360 kcal per package',
      notices: ['Not formulated to meet AAFCO nutrient profiles for complete and balanced nutrition.']
    };

    test('stores an incomplete US label as a draft and names what is missing', async () => {
      const { service, repository } = setup({ variations: [{ id: '11', name: 'Beef 300g', sku: 'B', active: false }] });

      const result = await service.saveLabel('US', 'beef', { ingredients: ['Beef'] }, actor);

      expect(repository.upsertLabel).toHaveBeenCalled();
      expect(result).toMatchObject({ labelStatus: 'incomplete', labelMissing: ['analysis', 'energyKg', 'energyPackage', 'notices'] });
    });

    test('a complete US label reports complete', async () => {
      const { service } = setup({ variations: [{ id: '11', name: 'Beef 300g', sku: 'B', active: true }] });
      const result = await service.saveLabel('US', 'beef', complete, actor);
      expect(result).toMatchObject({ labelStatus: 'complete', labelMissing: [] });
    });

    test('refuses to make the label of an active US recipe incomplete', async () => {
      const stored = { market: 'US', flavorSlug: 'beef', imageUrl: null, label: complete };
      const { service, repository } = setup({ stored, variations: [{ id: '11', name: 'Beef 300g', sku: 'B', active: true }] });

      await expect(service.saveLabel('US', 'beef', { ...complete, analysis: [] }, actor)).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'recipe_content_in_use', activeVariations: ['11'], missing: ['analysis'] }
      });
      expect(repository.upsertLabel).not.toHaveBeenCalled();
      expect((await service.get('US', 'beef')).label).toEqual(complete);
    });

    test('Brazil has no lock on an active recipe label', async () => {
      const { service } = setup({ variations: [{ id: '301', name: 'Sênior Carne 300g', sku: 'S', active: true }] });
      const result = await service.saveLabel('BR', 'senior-beef', { ingredients: ['Carne'] }, actor);
      expect(result.labelStatus).toBe('incomplete');
    });

    test('audits the label save with market and flavor', async () => {
      const { service, auditService } = setup();
      await service.saveLabel('BR', 'senior-beef', complete, actor);
      expect(auditService.record).toHaveBeenCalledWith({
        actor,
        action: 'catalog.recipe.label.update',
        metadata: { market: 'BR', flavorSlug: 'senior-beef' }
      });
    });

    test('refuses a malformed label', async () => {
      const { service } = setup();
      await expect(service.saveLabel('BR', 'senior-beef', { analysis: [{ nutrient: 'Fat' }] }, actor)).rejects.toMatchObject({
        statusCode: 422,
        details: { code: 'recipe_label_invalid', field: 'analysis[0]' }
      });
    });
  });
  describe('presentation', () => {
    const beefBr = {
      tag: 'Carne',
      title: 'Receita de Carne',
      tagline: 'Força & Vitalidade',
      resume: 'Rica em proteína e ferro, nossa receita de carne bovina apoia músculos fortes e energia duradoura.',
      highlights: ['Batatas', 'Carne bovina', 'Arroz branco'],
      colors: { color: '#C97B6C', accentColor: '#EAB8A8', pillBg: '#E8CCBC', pillText: '#5A2010', pillBorder: '#C0907C' }
    };

    function withBeef() {
      const context = setup();
      context.rows.set('BR:beef', { market: 'BR', flavorSlug: 'beef', name: 'Bovino', label: null, presentation: null });
      return context;
    }

    test('Save a presentation in BR: only the BR recipe changes and one audit event is recorded', async () => {
      const { service, repository, auditService, rows } = withBeef();

      const result = await service.savePresentation('br', 'beef', beefBr, actor);

      expect(result.presentation).toEqual(beefBr);
      expect(repository.upsertPresentation).toHaveBeenCalledWith({ market: 'BR', flavorSlug: 'beef', presentation: beefBr, actorId: 7 });
      expect(rows.get('US:beef').presentation).toBeUndefined();
      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith({
        actor,
        action: 'catalog.recipe.presentation.update',
        metadata: { market: 'BR', flavorSlug: 'beef' }
      });
    });

    test('Invalid color: refused with the field and nothing stored', async () => {
      const { service, repository, auditService, rows } = withBeef();

      await expect(service.savePresentation('BR', 'beef', { ...beefBr, colors: { ...beefBr.colors, pillBg: 'red' } }, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'recipe_presentation_invalid', fields: ['colors.pillBg'] } });
      expect(repository.upsertPresentation).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
      expect(rows.get('BR:beef').presentation).toBeNull();
    });

    test('needs a registered recipe of the market', async () => {
      const { service, repository } = setup();
      await expect(service.savePresentation('BR', 'fish', beefBr, actor)).rejects.toMatchObject({ statusCode: 404 });
      expect(repository.upsertPresentation).not.toHaveBeenCalled();
    });
  });
});
