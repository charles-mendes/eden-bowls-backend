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

function setup({ variations = SENIOR_BEEF_BR, stored = null, processImage } = {}) {
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
    upsertImage: jest.fn(async ({ market, flavorSlug, imageUrl }) => {
      const row = { ...(rows.get(`${market}:${flavorSlug}`) || { market, flavorSlug, label: null }), imageUrl };
      rows.set(`${market}:${flavorSlug}`, row);
      return row;
    }),
    upsertLabel: jest.fn(async ({ market, flavorSlug, label }) => {
      const row = { ...(rows.get(`${market}:${flavorSlug}`) || { market, flavorSlug, imageUrl: null }), label };
      rows.set(`${market}:${flavorSlug}`, row);
      return row;
    }),
    clearImage: jest.fn(async ({ market, flavorSlug }) => {
      const row = { ...rows.get(`${market}:${flavorSlug}`), imageUrl: null };
      rows.set(`${market}:${flavorSlug}`, row);
      return row;
    })
  };
  const catalogRepository = {
    listRecipeVariations: jest.fn(async (market, key) => (market === 'BR' && key === 'senior-beef') || (market === 'US' && key === 'beef') ? variations : []),
    setRecipeLifeStage: jest.fn().mockResolvedValue(undefined)
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
  test('one image serves every size of the flavor in that market only', async () => {
    const { service, repository } = setup();

    const result = await service.uploadImage('br', 'senior-beef', upload, actor);

    expect(result).toMatchObject({
      market: 'BR',
      flavorSlug: 'senior-beef',
      name: 'Sênior Carne',
      imageUrl: '/recipe-images/recipe-br-senior-beef-1.webp',
      labelStatus: 'missing',
      variations: SENIOR_BEEF_BR
    });
    expect(repository.upsertImage).toHaveBeenCalledWith({ market: 'BR', flavorSlug: 'senior-beef', imageUrl: result.imageUrl, actorId: 7 });
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
        { key: 'senior-beef', name: 'Sênior Carne', lifeStage: 'senior', imageUrl: null, labelStatus: 'missing', variations: SENIOR_BEEF_BR },
        { key: 'senior-lamb', name: 'Sênior Cordeiro', lifeStage: 'senior', imageUrl: '/recipe-images/lamb.webp', labelStatus: 'missing', variations: [] }
      ]
    });
  });

  describe('registration', () => {
    test('registers a recipe without variations that can then hold an image', async () => {
      const { service, repository, auditService } = setup({ variations: [] });

      const created = await service.create('BR', { key: 'senior-duck', name: '  Sênior Pato  ', lifeStage: 'senior' }, actor);
      const withImage = await service.uploadImage('BR', 'senior-duck', upload, actor);

      expect(repository.createRecipe).toHaveBeenCalledWith({ market: 'BR', flavorSlug: 'senior-duck', name: 'Sênior Pato', lifeStage: 'senior', actorId: 7 });
      expect(created).toMatchObject({ flavorSlug: 'senior-duck', name: 'Sênior Pato', lifeStage: 'senior', variations: [], imageUrl: null });
      expect(withImage.imageUrl).toBe('/recipe-images/recipe-br-senior-duck-1.webp');
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

    test('deletes an unused recipe with its image file', async () => {
      const { service, repository, imageStorage, auditService } = setup({ variations: [] });

      const result = await service.remove('BR', 'senior-lamb', actor);

      expect(result).toEqual({ deleted: true, market: 'BR', flavorSlug: 'senior-lamb' });
      expect(repository.deleteRecipe).toHaveBeenCalledWith({ market: 'BR', flavorSlug: 'senior-lamb' });
      expect(imageStorage.delete).toHaveBeenCalledWith('/recipe-images/lamb.webp');
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'catalog.recipe.delete' }));
      await expect(service.get('BR', 'senior-lamb')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  test('a refused image keeps the current one', async () => {
    const refusal = Object.assign(new Error('Image must be 1024 x 636 pixels.'), {
      statusCode: 422,
      details: { code: 'recipe_image_invalid', reason: 'dimensions', width: 1200, height: 800, expectedWidth: 1024, expectedHeight: 636 }
    });
    const stored = { market: 'BR', flavorSlug: 'senior-beef', imageUrl: '/recipe-images/old.webp', label: null };
    const { service, repository, imageStorage } = setup({ stored, processImage: jest.fn().mockRejectedValue(refusal) });

    await expect(service.uploadImage('BR', 'senior-beef', upload, actor)).rejects.toBe(refusal);
    expect(imageStorage.write).not.toHaveBeenCalled();
    expect(repository.upsertImage).not.toHaveBeenCalled();
    expect((await service.get('BR', 'senior-beef')).imageUrl).toBe('/recipe-images/old.webp');
  });

  test('refuses empty image data', async () => {
    const { service } = setup();
    await expect(service.uploadImage('BR', 'senior-beef', { mimeType: 'image/png', imageBase64: '' }, actor))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'recipe_image_invalid', reason: 'data' } });
  });

  test('a new image replaces the old one and the old file goes after the row is saved', async () => {
    const stored = { market: 'BR', flavorSlug: 'senior-beef', imageUrl: '/recipe-images/old.webp', label: null };
    const { service, repository, imageStorage } = setup({ stored });

    const result = await service.uploadImage('BR', 'senior-beef', upload, actor);

    expect(result.imageUrl).toBe('/recipe-images/recipe-br-senior-beef-1.webp');
    expect(imageStorage.delete).toHaveBeenCalledWith('/recipe-images/old.webp');
    expect(repository.upsertImage.mock.invocationCallOrder[0]).toBeLessThan(imageStorage.delete.mock.invocationCallOrder[0]);
  });

  test('a failed save removes the new file and keeps the old one', async () => {
    const stored = { market: 'BR', flavorSlug: 'senior-beef', imageUrl: '/recipe-images/old.webp', label: null };
    const { service, repository, imageStorage } = setup({ stored });
    repository.upsertImage.mockRejectedValueOnce(new Error('db down'));

    await expect(service.uploadImage('BR', 'senior-beef', upload, actor)).rejects.toThrow('db down');
    expect(imageStorage.delete).toHaveBeenCalledWith('/recipe-images/recipe-br-senior-beef-1.webp');
    expect(imageStorage.delete).not.toHaveBeenCalledWith('/recipe-images/old.webp');
  });

  test('refuses to remove the image while a variation of the flavor is active', async () => {
    const stored = { market: 'US', flavorSlug: 'beef', imageUrl: '/recipe-images/beef.webp', label: null };
    const { service, repository, imageStorage } = setup({ stored, variations: [{ id: '11', name: 'Beef 300g', sku: 'B-300', active: true }] });

    await expect(service.removeImage('US', 'beef', actor)).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'recipe_content_in_use', activeVariations: ['11'] }
    });
    expect(repository.clearImage).not.toHaveBeenCalled();
    expect(imageStorage.delete).not.toHaveBeenCalled();
  });

  test('removes the image when every variation is inactive', async () => {
    const stored = { market: 'BR', flavorSlug: 'senior-beef', imageUrl: '/recipe-images/old.webp', label: null };
    const { service, imageStorage } = setup({ stored });

    const result = await service.removeImage('BR', 'senior-beef', actor);

    expect(result.imageUrl).toBeNull();
    expect(imageStorage.delete).toHaveBeenCalledWith('/recipe-images/old.webp');
  });

  test('records one audit event per upload and removal, with market and flavor', async () => {
    const { service, auditService } = setup();

    await service.uploadImage('BR', 'senior-beef', upload, actor);
    await service.removeImage('BR', 'senior-beef', actor);

    expect(auditService.record.mock.calls.map(([event]) => [event.action, event.metadata])).toEqual([
      ['catalog.recipe.image.update', { market: 'BR', flavorSlug: 'senior-beef' }],
      ['catalog.recipe.image.delete', { market: 'BR', flavorSlug: 'senior-beef' }]
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
});
