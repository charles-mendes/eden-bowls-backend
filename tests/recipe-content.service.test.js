const { RecipeContentService } = require('../src/services/recipe-content.service');

const SENIOR_BEEF_BR = [
  { id: '301', name: 'Sênior Carne 300g', sku: 'SENIOR-BEEF-300', active: false },
  { id: '302', name: 'Sênior Carne 500g', sku: 'SENIOR-BEEF-500', active: false }
];

// Product content every test starts with; `stored` replaces one of them by product id.
const PRODUCTS = [
  { productId: '500', market: 'BR', flavorSlug: 'senior-beef', name: 'Sênior Carne', lifeStage: 'senior', imageUrl: null, label: null },
  { productId: '600', market: 'US', flavorSlug: 'senior-beef', name: 'Senior Beef', lifeStage: 'senior', imageUrl: null, label: null },
  { productId: '610', market: 'US', flavorSlug: 'beef', name: 'Beef', imageUrl: null, label: null },
  { productId: '700', market: 'BR', flavorSlug: 'senior-lamb', name: 'Sênior Cordeiro', lifeStage: 'senior', imageUrl: '/recipe-images/lamb.webp', label: null },
  { productId: '800', market: 'BR', flavorSlug: 'beef', name: 'Bovino', label: null, presentation: null }
];

function setup({ variations = { 500: SENIOR_BEEF_BR }, stored = null, processImage } = {}) {
  const rows = new Map(PRODUCTS.map((row) => [row.productId, { ...row }]));
  if (stored) {
    rows.set(stored.productId, { ...rows.get(stored.productId), ...stored });
  }
  const save = (fields) => jest.fn(async ({ productId, ...values }) => {
    const row = { ...rows.get(String(productId)), ...fields(values) };
    rows.set(String(productId), row);
    return row;
  });
  const repository = {
    findByProductId: jest.fn(async (productId) => rows.get(String(productId)) || null),
    findByMarketAndSlug: jest.fn(async (market, slug) => [...rows.values()].find((row) => row.market === market && row.flavorSlug === slug) || null),
    listByMarket: jest.fn(async (market) => [...rows.values()].filter((row) => row.market === market)
      .sort((left, right) => left.flavorSlug.localeCompare(right.flavorSlug))),
    setImage: save(({ imageUrl }) => ({ imageUrl })),
    setPlanImage: save(({ imageUrl }) => ({ planImageUrl: imageUrl })),
    setLabel: save(({ label }) => ({ label })),
    setPresentation: save(({ presentation }) => ({ presentation }))
  };
  const catalogRepository = {
    listProductVariations: jest.fn(async (productId) => variations[productId] || []),
    listMarketProductVariations: jest.fn(async () => new Map(Object.entries(variations)))
  };
  let counter = 0;
  const imageStorage = {
    write: jest.fn(async ({ market, flavorSlug }) => `/recipe-images/recipe-${market.toLowerCase()}-${flavorSlug}-${++counter}.webp`),
    delete: jest.fn().mockResolvedValue(undefined)
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new RecipeContentService({
    repository,
    catalogRepository,
    imageStorage,
    auditService,
    processImage: processImage || jest.fn(async () => ({ buffer: Buffer.from('webp'), ext: 'webp', mimeType: 'image/webp' }))
  });
  return { service, repository, catalogRepository, imageStorage, auditService, rows };
}

const actor = { userId: '7', email: 'ops@edenbowls.com' };
const upload = { mimeType: 'image/png', imageBase64: Buffer.from('png').toString('base64') };

describe('RecipeContentService', () => {
  test('Two sizes share one image', async () => {
    const { service, repository, rows } = setup();

    const result = await service.uploadImage('500', upload, actor);

    expect(result).toMatchObject({
      productId: '500',
      market: 'BR',
      flavorSlug: 'senior-beef',
      name: 'Sênior Carne',
      imageUrl: '/recipe-images/recipe-br-senior-beef-1.webp',
      labelStatus: 'missing',
      variations: SENIOR_BEEF_BR
    });
    expect(repository.setImage).toHaveBeenCalledWith({ productId: '500', imageUrl: result.imageUrl, actorId: 7 });
    expect(rows.get('600').imageUrl).toBeNull();
  });

  test('Unregistered key: a product id that does not exist answers 404 product_not_found', async () => {
    const { service, repository } = setup();

    await expect(service.uploadImage('999', upload, actor)).rejects.toMatchObject({ statusCode: 404, details: { code: 'product_not_found' } });
    await expect(service.saveLabel('abc', { ingredients: ['Carne'] }, actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(repository.setLabel).not.toHaveBeenCalled();
  });

  test('A flavor alias does not link a variation: content reads the variations of its product', async () => {
    const { service, catalogRepository } = setup({ variations: { 800: [{ id: '11', name: 'Bovino 300g', sku: 'B', active: false }] } });

    const result = await service.saveLabel('800', { ingredients: ['Carne'] }, actor);

    expect(catalogRepository.listProductVariations).toHaveBeenCalledWith(800);
    expect(result.variations.map((variation) => variation.id)).toEqual(['11']);
  });

  describe('public list', () => {
    test('senior line launched in BR only', async () => {
      const { service } = setup({
        variations: {
          500: [{ id: '301', name: 'Sênior Carne 300g', sku: 'SENIOR-BEEF-300', active: true }],
          610: [{ id: '11', name: 'Beef', sku: 'B', active: true }]
        }
      });

      await expect(service.listPublic('br')).resolves.toEqual({
        market: 'BR',
        items: [{ key: 'senior-beef', name: 'Sênior Carne', lifeStage: 'senior', title: null, tag: null }]
      });
      const us = await service.listPublic('US');
      expect(us.items.map((item) => item.key)).toEqual(['beef']);
    });

    test('Unlaunched recipe is not exposed', async () => {
      const { service } = setup();

      await expect(service.listPublic('BR')).resolves.toEqual({ market: 'BR', items: [] });
      await expect(service.getPublic('senior-beef', 'BR')).rejects.toMatchObject({ statusCode: 404 });
    });

    test('every listed key resolves on the single-recipe route', async () => {
      const { service } = setup({
        variations: {
          500: [{ id: '301', name: 'Sênior Carne 300g', sku: 'SENIOR-BEEF-300', active: true }, SENIOR_BEEF_BR[1]],
          700: [{ id: '401', name: 'Sênior Cordeiro 300g', sku: 'SENIOR-LAMB-300', active: true }]
        }
      });

      const { items } = await service.listPublic('BR');

      expect(items.map((item) => item.key)).toEqual(['senior-beef', 'senior-lamb']);
      for (const item of items) {
        await expect(service.getPublic(item.key, 'BR')).resolves.toMatchObject({ key: item.key, market: 'BR' });
      }
    });

    test('Alias resolves: chicken reaches the US turkey product', async () => {
      const { service, rows } = setup({ variations: { 620: [{ id: '21', name: 'Turkey', sku: 'T', active: true }] } });
      rows.set('620', { productId: '620', market: 'US', flavorSlug: 'turkey', name: 'Turkey', imageUrl: '/recipe-images/turkey.webp', label: null });

      await expect(service.getPublic('chicken', 'US')).resolves.toMatchObject({ key: 'turkey', imageUrl: '/recipe-images/turkey.webp' });
    });

    test('an unknown market is refused', async () => {
      const { service } = setup();

      await expect(service.listPublic('AR')).rejects.toMatchObject({ statusCode: 400, details: { code: 'invalid_market' } });
    });
  });

  test('a refused image keeps the current one', async () => {
    const refusal = Object.assign(new Error('Image must be 1024 x 636 pixels.'), {
      statusCode: 422,
      details: { code: 'recipe_image_invalid', reason: 'dimensions', width: 1200, height: 800, expectedWidth: 1024, expectedHeight: 636 }
    });
    const stored = { productId: '500', imageUrl: '/recipe-images/old.webp' };
    const { service, repository, imageStorage, rows } = setup({ stored, processImage: jest.fn().mockRejectedValue(refusal) });

    await expect(service.uploadImage('500', upload, actor)).rejects.toBe(refusal);
    expect(imageStorage.write).not.toHaveBeenCalled();
    expect(repository.setImage).not.toHaveBeenCalled();
    expect(rows.get('500').imageUrl).toBe('/recipe-images/old.webp');
  });

  test('refuses empty image data', async () => {
    const { service } = setup();
    await expect(service.uploadImage('500', { mimeType: 'image/png', imageBase64: '' }, actor))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'recipe_image_invalid', reason: 'data' } });
  });

  test('a new image replaces the old one and the old file goes after the row is saved', async () => {
    const { service, repository, imageStorage } = setup({ stored: { productId: '500', imageUrl: '/recipe-images/old.webp' } });

    const result = await service.uploadImage('500', upload, actor);

    expect(result.imageUrl).toBe('/recipe-images/recipe-br-senior-beef-1.webp');
    expect(imageStorage.delete).toHaveBeenCalledWith('/recipe-images/old.webp');
    expect(repository.setImage.mock.invocationCallOrder[0]).toBeLessThan(imageStorage.delete.mock.invocationCallOrder[0]);
  });

  test('a failed save removes the new file and keeps the old one', async () => {
    const { service, repository, imageStorage } = setup({ stored: { productId: '500', imageUrl: '/recipe-images/old.webp' } });
    repository.setImage.mockRejectedValueOnce(new Error('db down'));

    await expect(service.uploadImage('500', upload, actor)).rejects.toThrow('db down');
    expect(imageStorage.delete).toHaveBeenCalledWith('/recipe-images/recipe-br-senior-beef-1.webp');
    expect(imageStorage.delete).not.toHaveBeenCalledWith('/recipe-images/old.webp');
  });

  test('Remove with an active variation', async () => {
    const { service, repository, imageStorage } = setup({
      stored: { productId: '610', imageUrl: '/recipe-images/beef.webp' },
      variations: { 610: [{ id: '11', name: 'Beef 300g', sku: 'B-300', active: true }] }
    });

    await expect(service.removeImage('610', actor)).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'recipe_content_in_use', activeVariations: ['11'] }
    });
    expect(repository.setImage).not.toHaveBeenCalled();
    expect(imageStorage.delete).not.toHaveBeenCalled();
  });

  test('Remove with only inactive variations', async () => {
    const { service, imageStorage } = setup({ stored: { productId: '500', imageUrl: '/recipe-images/old.webp' } });

    const result = await service.removeImage('500', actor);

    expect(result.imageUrl).toBeNull();
    expect(imageStorage.delete).toHaveBeenCalledWith('/recipe-images/old.webp');
  });

  describe('plan thumbnail', () => {
    test('stores a square thumbnail apart from the banner and replaces the previous file', async () => {
      const { service, imageStorage, repository, auditService } = setup({
        stored: { productId: '500', imageUrl: '/recipe-images/banner.webp', planImageUrl: '/recipe-images/old-plan.webp' }
      });

      const result = await service.uploadPlanImage('500', upload, actor);

      expect(service.processImage).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png', kind: 'plan' }));
      expect(imageStorage.write).toHaveBeenCalledWith(expect.objectContaining({ market: 'BR', flavorSlug: 'senior-beef-plan' }));
      expect(repository.setPlanImage).toHaveBeenCalledWith(expect.objectContaining({ productId: '500', imageUrl: result.planImageUrl }));
      expect(result).toMatchObject({ imageUrl: '/recipe-images/banner.webp', planImageUrl: '/recipe-images/recipe-br-senior-beef-plan-1.webp' });
      expect(imageStorage.delete).toHaveBeenCalledWith('/recipe-images/old-plan.webp');
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'catalog.recipe.plan_image.update' }));
    });

    test('removes the thumbnail even with an active variation, keeping the banner', async () => {
      const { service, imageStorage } = setup({
        variations: { 500: SENIOR_BEEF_BR.map((item) => ({ ...item, active: true })) },
        stored: { productId: '500', imageUrl: '/recipe-images/banner.webp', planImageUrl: '/recipe-images/plan.webp' }
      });

      const result = await service.removePlanImage('500', actor);

      expect(result).toMatchObject({ imageUrl: '/recipe-images/banner.webp', planImageUrl: null });
      expect(imageStorage.delete).toHaveBeenCalledWith('/recipe-images/plan.webp');
    });

    test('the store view carries the thumbnail', async () => {
      const { service } = setup({
        variations: { 500: SENIOR_BEEF_BR.map((item) => ({ ...item, active: true })) },
        stored: { productId: '500', planImageUrl: '/recipe-images/plan.webp' }
      });

      await expect(service.getPublic('senior-beef', 'BR')).resolves.toMatchObject({ imageUrl: null, planImageUrl: '/recipe-images/plan.webp' });
    });
  });

  test('records one audit event per upload and removal, with product, market and code', async () => {
    const { service, auditService } = setup();

    await service.uploadImage('500', upload, actor);
    await service.removeImage('500', actor);

    expect(auditService.record.mock.calls.map(([event]) => [event.action, event.metadata])).toEqual([
      ['catalog.recipe.image.update', { productId: '500', market: 'BR', flavorSlug: 'senior-beef' }],
      ['catalog.recipe.image.delete', { productId: '500', market: 'BR', flavorSlug: 'senior-beef' }]
    ]);
    expect(auditService.record.mock.calls[0][0].actor).toBe(actor);
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
      const { service, repository } = setup({ variations: { 610: [{ id: '11', name: 'Beef 300g', sku: 'B', active: false }] } });

      const result = await service.saveLabel('610', { ingredients: ['Beef'] }, actor);

      expect(repository.setLabel).toHaveBeenCalled();
      expect(result).toMatchObject({ labelStatus: 'incomplete', labelMissing: ['analysis', 'energyKg', 'energyPackage', 'notices'] });
    });

    test('a complete US label reports complete', async () => {
      const { service } = setup({ variations: { 610: [{ id: '11', name: 'Beef 300g', sku: 'B', active: true }] } });
      const result = await service.saveLabel('610', complete, actor);
      expect(result).toMatchObject({ labelStatus: 'complete', labelMissing: [] });
    });

    test('Clearing analysis of an active US recipe', async () => {
      const { service, repository, rows } = setup({
        stored: { productId: '610', label: complete },
        variations: { 610: [{ id: '11', name: 'Beef 300g', sku: 'B', active: true }] }
      });

      await expect(service.saveLabel('610', { ...complete, analysis: [] }, actor)).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'recipe_content_in_use', activeVariations: ['11'], missing: ['analysis'] }
      });
      expect(repository.setLabel).not.toHaveBeenCalled();
      expect(rows.get('610').label).toEqual(complete);
    });

    test('Brazil has no lock on an active recipe label', async () => {
      const { service } = setup({ variations: { 500: [{ id: '301', name: 'Sênior Carne 300g', sku: 'S', active: true }] } });
      const result = await service.saveLabel('500', { ingredients: ['Carne'] }, actor);
      expect(result.labelStatus).toBe('incomplete');
    });

    test('audits the label save with product, market and code', async () => {
      const { service, auditService } = setup();
      await service.saveLabel('500', complete, actor);
      expect(auditService.record).toHaveBeenCalledWith({
        actor,
        action: 'catalog.recipe.label.update',
        metadata: { productId: '500', market: 'BR', flavorSlug: 'senior-beef' }
      });
    });

    test('refuses a malformed label', async () => {
      const { service } = setup();
      await expect(service.saveLabel('500', { analysis: [{ nutrient: 'Fat' }] }, actor)).rejects.toMatchObject({
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

    test('Save a presentation in BR: only the BR product changes and one audit event is recorded', async () => {
      const { service, repository, auditService, rows } = setup();

      const result = await service.savePresentation('800', beefBr, actor);

      expect(result.presentation).toEqual(beefBr);
      expect(repository.setPresentation).toHaveBeenCalledWith({ productId: '800', presentation: beefBr, actorId: 7 });
      expect(rows.get('610').presentation).toBeUndefined();
      expect(auditService.record).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith({
        actor,
        action: 'catalog.recipe.presentation.update',
        metadata: { productId: '800', market: 'BR', flavorSlug: 'beef' }
      });
    });

    test('Invalid color: refused with the field and nothing stored', async () => {
      const { service, repository, auditService, rows } = setup();

      await expect(service.savePresentation('800', { ...beefBr, colors: { ...beefBr.colors, pillBg: 'red' } }, actor))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'recipe_presentation_invalid', fields: ['colors.pillBg'] } });
      expect(repository.setPresentation).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
      expect(rows.get('800').presentation).toBeNull();
    });

    test('needs an existing product', async () => {
      const { service, repository } = setup();
      await expect(service.savePresentation('404', beefBr, actor)).rejects.toMatchObject({ statusCode: 404, details: { code: 'product_not_found' } });
      expect(repository.setPresentation).not.toHaveBeenCalled();
    });
  });
});
