const { AdminCatalogService } = require('../src/services/admin-catalog.service');

// catalog-products: a product is one recipe of one market. Content rows are keyed by product id.
function contentStore(rows = []) {
  const byId = new Map(rows.map((row) => [String(row.productId), { flavorAliases: '', shortLabel: '', label: null, presentation: null, imageUrl: null, ...row }]));
  return {
    byId,
    findByProductId: jest.fn(async (id) => byId.get(String(id)) || null),
    findByMarketAndSlug: jest.fn(async (market, slug) => [...byId.values()].find((row) => row.market === market && row.flavorSlug === slug) || null),
    createForProduct: jest.fn(async ({ productId, market, flavorSlug, name, lifeStage }) => {
      const row = { productId: String(productId), market, flavorSlug, name, lifeStage, flavorAliases: '', shortLabel: '', label: null, presentation: null, imageUrl: null };
      byId.set(String(productId), row);
      return row;
    }),
    updateProductFields: jest.fn(async (id, fields) => {
      const row = { ...byId.get(String(id)) };
      for (const key of ['name', 'lifeStage', 'flavorAliases', 'shortLabel']) {
        if (fields[key] !== undefined) row[key] = fields[key] || '';
      }
      byId.set(String(id), row);
      return row;
    }),
    deleteByProductId: jest.fn(async (id) => byId.delete(String(id)))
  };
}

const BEEF_BR = { productId: '100', market: 'BR', flavorSlug: 'beef', name: 'Bovino', lifeStage: 'adult', flavorAliases: 'bovino,carne', shortLabel: 'Carne' };

function setup({ product = {}, contents = [BEEF_BR], stripeBilling } = {}) {
  let stored = { id: '100', active: false, planCountry: 'BR', namePt: 'Bovino', variants: [], ...product };
  const repository = {
    // A product created in the test (id 300) reads back as a new draft without variations.
    getProduct: jest.fn(async (id) => {
      if (String(id) === String(stored.id)) return stored;
      return String(id) === '300' ? { id: '300', active: false, planCountry: 'BR', variants: [] } : null;
    }),
    createProduct: jest.fn().mockResolvedValue('300'),
    assignCategory: jest.fn().mockResolvedValue(true),
    deleteProduct: jest.fn().mockResolvedValue(true),
    upsertPostMeta: jest.fn(),
    updatePost: jest.fn(),
    updatePostStatus: jest.fn(async (_id, status) => {
      stored = { ...stored, active: status === 'publish' };
    }),
    createVariation: jest.fn().mockResolvedValue('3001'),
    updateVariation: jest.fn(async ({ id, regularPrice }) => {
      stored = { ...stored, variants: stored.variants.map((item) => (item.id === id && regularPrice != null ? { ...item, regularPrice } : item)) };
    }),
    rewriteFlavorCopies: jest.fn(),
    listProducts: jest.fn(async () => ({ total: 1, items: [stored] })),
    fingerprint: jest.fn().mockReturnValue('fp')
  };
  const recipeContentRepository = contentStore(contents);
  const auditService = { record: jest.fn() };
  const recipeImageStorage = { delete: jest.fn() };
  const service = new AdminCatalogService({ repository, recipeContentRepository, auditService, recipeImageStorage, stripeBilling });
  return { service, repository, recipeContentRepository, auditService, recipeImageStorage, getStored: () => stored };
}

const actor = { userId: '7' };
const audits = (auditService, action) => auditService.record.mock.calls.map(([event]) => event).filter((event) => event.action === action);

describe('A product is one recipe of one market', () => {
  test('Create a recipe product', async () => {
    const { service, repository, recipeContentRepository, auditService } = setup({ contents: [] });

    await service.createProduct({ name: 'Receita de Cordeiro', planCountry: 'BR', code: 'adult-lamb', lifeStage: 'adult' }, actor);

    expect(repository.createProduct).toHaveBeenCalledWith({ name: 'Receita de Cordeiro', slug: 'adult-lamb-br', planCountry: 'BR' });
    expect(recipeContentRepository.createForProduct).toHaveBeenCalledWith({
      productId: '300', market: 'BR', flavorSlug: 'adult-lamb', name: 'Receita de Cordeiro', lifeStage: 'adult', actorId: 7
    });
    expect(repository.assignCategory).toHaveBeenCalledWith('300', 'flavors');
    expect(repository.createVariation).not.toHaveBeenCalled();
    expect(audits(auditService, 'catalog.product.create')[0].metadata).toEqual({
      productId: '300', market: 'BR', code: 'adult-lamb', name: 'Receita de Cordeiro', lifeStage: 'adult'
    });
  });

  test('creating also makes the Stripe product of the market', async () => {
    const stripeBilling = { createCatalogProduct: jest.fn().mockResolvedValue('prod_live_300') };
    const { service, repository } = setup({ contents: [], stripeBilling });

    await service.createProduct({ name: 'Receita de Cordeiro', planCountry: 'BR', code: 'adult-lamb', lifeStage: 'adult' });

    expect(stripeBilling.createCatalogProduct).toHaveBeenCalledWith({ name: 'Receita de Cordeiro', metadata: { catalog_product_id: '300', market: 'BR' } });
    expect(repository.upsertPostMeta).toHaveBeenCalledWith('300', '_stripe_product_ids_by_currency', JSON.stringify({ brl: 'prod_live_300' }));
  });

  test('Code taken in the market', async () => {
    const { service, repository } = setup();

    await expect(service.createProduct({ name: 'Outra carne', planCountry: 'BR', code: 'beef', lifeStage: 'adult' }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'product_code_taken' } });
    expect(repository.createProduct).not.toHaveBeenCalled();
  });

  test('a create that loses the code to a concurrent one takes its product back out', async () => {
    const { service, repository, recipeContentRepository } = setup({ contents: [] });
    recipeContentRepository.createForProduct.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }));

    await expect(service.createProduct({ name: 'Bovino', planCountry: 'BR', code: 'beef', lifeStage: 'adult' }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'product_code_taken' } });
    expect(repository.deleteProduct).toHaveBeenCalledWith('300');
    expect(repository.assignCategory).not.toHaveBeenCalled();
  });

  test('Same code in the other market', async () => {
    const { service, recipeContentRepository } = setup();

    await service.createProduct({ name: 'Beef', planCountry: 'US', code: 'beef', lifeStage: 'adult' });

    expect(recipeContentRepository.createForProduct).toHaveBeenCalledWith(expect.objectContaining({ market: 'US', flavorSlug: 'beef' }));
  });

  test.each([
    [{ name: '', code: 'adult-lamb', lifeStage: 'adult', planCountry: 'BR' }, 'product_name_invalid'],
    [{ name: 'x'.repeat(121), code: 'adult-lamb', lifeStage: 'adult', planCountry: 'BR' }, 'product_name_invalid'],
    [{ name: 'Cordeiro', code: 'Adult Lamb', lifeStage: 'adult', planCountry: 'BR' }, 'product_code_invalid'],
    [{ name: 'Cordeiro', code: 'adult--lamb', lifeStage: 'adult', planCountry: 'BR' }, 'product_code_invalid'],
    [{ name: 'Cordeiro', lifeStage: 'adult', planCountry: 'BR' }, 'product_code_invalid'],
    [{ name: 'Cordeiro', code: 'adult-lamb', lifeStage: 'kitten', planCountry: 'BR' }, 'product_life_stage_invalid'],
    [{ name: 'Cordeiro', code: 'adult-lamb', lifeStage: 'adult' }, 'product_country_not_configured']
  ])('refuses %j', async (payload, code) => {
    const { service, repository } = setup({ contents: [] });
    await expect(service.createProduct(payload)).rejects.toMatchObject({ statusCode: 422, details: { code } });
    expect(repository.createProduct).not.toHaveBeenCalled();
  });
});

describe('Product code and market do not change', () => {
  test('Change the market', async () => {
    const { service, repository, recipeContentRepository } = setup();

    await expect(service.patchProduct('100', { planCountry: 'US', name: 'Beef' })).rejects.toMatchObject({
      statusCode: 422, details: { code: 'product_identity_locked', field: 'planCountry' }
    });
    expect(repository.upsertPostMeta).not.toHaveBeenCalled();
    expect(recipeContentRepository.updateProductFields).not.toHaveBeenCalled();
  });

  test('a different code is refused and the same code and market pass', async () => {
    const { service } = setup();

    await expect(service.patchProduct('100', { code: 'pork' })).rejects.toMatchObject({ details: { code: 'product_identity_locked', field: 'code' } });
    await expect(service.patchProduct('100', { code: 'beef', planCountry: 'br' })).resolves.toMatchObject({ id: '100' });
  });

  test('Rename keeps the code', async () => {
    const { service, repository, recipeContentRepository, auditService } = setup();

    const result = await service.patchProduct('100', { name: 'Carne bovina' }, actor);

    expect(repository.updatePost).toHaveBeenCalledWith('100', { title: 'Carne bovina' });
    expect(recipeContentRepository.updateProductFields).toHaveBeenCalledWith('100', { name: 'Carne bovina', actorId: 7 });
    expect(repository.rewriteFlavorCopies).toHaveBeenCalledWith('100', {
      flavor: 'Carne bovina', flavorSlug: 'beef', flavorAliases: 'bovino,carne', lifeStage: 'adult', shortLabel: 'Carne'
    });
    expect(result.content).toMatchObject({ code: 'beef', name: 'Carne bovina' });
    expect(audits(auditService, 'catalog.product.update').map((event) => event.metadata)).toEqual([
      { productId: '100', market: 'BR', field: 'name', from: 'Bovino', to: 'Carne bovina' }
    ]);
  });

  test('aliases and short label are stored and audited, an unchanged value records nothing', async () => {
    const { service, recipeContentRepository, auditService } = setup();

    await service.patchProduct('100', { name: 'Bovino', flavorAliases: 'Bovino, Carne, Boi', shortLabel: '' }, actor);

    expect(recipeContentRepository.updateProductFields).toHaveBeenCalledWith('100', { flavorAliases: 'bovino,carne,boi', shortLabel: '', actorId: 7 });
    expect(audits(auditService, 'catalog.product.update').map((event) => event.metadata.field)).toEqual(['flavorAliases', 'shortLabel']);
  });
});

describe('Variations inherit the product flavor fields', () => {
  test('Life stage change reaches active variations', async () => {
    const { service, repository } = setup({
      product: { active: true, variants: [{ id: '1001', active: true, weight: '300g' }] }
    });

    await service.patchProduct('100', { lifeStage: 'senior' }, actor);

    expect(repository.rewriteFlavorCopies).toHaveBeenCalledWith('100', expect.objectContaining({ lifeStage: 'senior' }));
  });

  test('Variation sends its own recipe', async () => {
    const { service, repository } = setup({ product: { variants: [{ id: '1001', weight: '300g' }] } });

    await service.patchProduct('100', { variants: [{
      id: '1001', recipeKey: 'pork', flavor: 'Porco', flavorSlug: 'pork', flavorAliases: 'porco', lifeStage: 'puppy', shortLabel: 'Porco'
    }] });

    expect(repository.updateVariation).toHaveBeenCalledWith(expect.objectContaining({
      id: '1001', flavor: 'Bovino', flavorSlug: 'beef', recipeKey: 'beef', flavorAliases: 'bovino,carne', lifeStage: 'adult', shortLabel: 'Carne'
    }));
  });

  test('Two sizes share the flavor', async () => {
    const { service, repository } = setup({
      contents: [{ productId: '100', market: 'BR', flavorSlug: 'senior-beef', name: 'Bovino Sênior', lifeStage: 'senior', shortLabel: 'Bovino · Sênior' }],
      product: { variants: [{ id: '1001', weight: '300g' }] }
    });

    await service.patchProduct('100', { variants: [{ name: 'Bovino Sênior 500g', sku: 'SB-500', weight: '500g', regularPrice: 45 }] });

    expect(repository.createVariation).toHaveBeenCalledWith(expect.objectContaining({
      productId: '100', weight: '500g', flavorSlug: 'senior-beef', recipeKey: 'senior-beef', lifeStage: 'senior', shortLabel: 'Bovino · Sênior', menuOrder: 2
    }));
  });

  test('stores the digits of the NCM and the origin code, and absent fields keep what is stored', async () => {
    const { service, repository } = setup({ product: { variants: [{ id: '3000', weight: '300g' }] } });

    await service.patchProduct('100', { variants: [{ id: '3000', ncm: '2309.10.00', origin: 1 }] });
    await service.patchProduct('100', { variants: [{ id: '3000', name: 'Bovino' }] });

    expect(repository.updateVariation.mock.calls[0][0]).toMatchObject({ ncm: '23091000', origin: 1 });
    expect(repository.updateVariation.mock.calls[1][0]).toMatchObject({ ncm: undefined, origin: undefined, weight: undefined });
  });

  test.each([
    [{ ncm: '2309' }, 'invalid_ncm'],
    [{ origin: 9 }, 'invalid_origin'],
    [{ weight: 'grande' }, 'variation_weight_invalid']
  ])('refuses %j', async (fields, code) => {
    const { service } = setup({ product: { variants: [{ id: '3000' }] } });
    await expect(service.patchProduct('100', { variants: [{ id: '3000', ...fields }] })).rejects.toMatchObject({ statusCode: 422, details: { code } });
  });

  test('rejects a new variation without name or SKU', async () => {
    const { service, repository } = setup();
    await expect(service.patchProduct('100', { variants: [{ regularPrice: 10 }] }))
      .rejects.toMatchObject({ statusCode: 422, message: 'New variations require a name or SKU.' });
    expect(repository.createVariation).not.toHaveBeenCalled();
  });

  test('an active variation of a published product cannot be edited', async () => {
    const { service, repository } = setup({ product: { active: true, variants: [{ id: '3000', active: true }] } });
    await expect(service.patchProduct('100', { variants: [{ id: '3000', name: 'X' }] })).rejects.toMatchObject({
      statusCode: 409, details: { code: 'variation_active_locked' }
    });
    expect(repository.updateVariation).not.toHaveBeenCalled();
  });
});

describe('A product has one variation per weight', () => {
  const twoSizes = { variants: [{ id: '1001', weight: '300g' }, { id: '1002', weight: '500g' }] };

  test('Second 300 g variation', async () => {
    const { service, repository } = setup({ product: twoSizes });

    await expect(service.patchProduct('100', { variants: [{ name: 'Bovino 300g', sku: 'B-300-2', weight: '300g' }] }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'variation_weight_taken' } });
    expect(repository.createVariation).not.toHaveBeenCalled();
  });

  test('editing a variation to the weight of another is refused and nothing is written', async () => {
    const { service, repository } = setup({ product: twoSizes });

    await expect(service.patchProduct('100', { variants: [{ id: '1002', name: 'X', weight: '300 G' }] }))
      .rejects.toMatchObject({ details: { code: 'variation_weight_taken' } });
    expect(repository.updateVariation).not.toHaveBeenCalled();
  });

  test('two new variations with the same weight in one save are refused', async () => {
    const { service, repository } = setup();

    await expect(service.patchProduct('100', { variants: [
      { name: 'A', weight: '400g' },
      { name: 'B', weight: '400g' }
    ] })).rejects.toMatchObject({ details: { code: 'variation_weight_taken' } });
    expect(repository.createVariation).not.toHaveBeenCalled();
  });

  test('a variation keeps its own weight and swapping is allowed when the old one is freed', async () => {
    const { service, repository } = setup({ product: twoSizes });

    await service.patchProduct('100', { variants: [{ id: '1001', name: 'Bovino 300g', weight: '300g' }] });
    await service.patchProduct('100', { variants: [{ id: '1001', weight: '700g' }, { name: 'Novo', weight: '300g' }] });

    expect(repository.updateVariation).toHaveBeenCalledTimes(2);
    expect(repository.createVariation).toHaveBeenCalledWith(expect.objectContaining({ weight: '300g' }));
  });
});

describe('Product detail reports each variation content', () => {
  test('Flavor with stored image and no label', async () => {
    const { service } = setup({
      contents: [{ ...BEEF_BR, imageUrl: '/recipe-images/beef.webp' }],
      product: { variants: [{ id: '1001', weight: '300g' }, { id: '1005', weight: '500g' }] }
    });

    const detail = await service.getProduct('100');

    expect(detail.content).toMatchObject({
      code: 'beef', name: 'Bovino', lifeStage: 'adult', flavorAliases: 'bovino,carne', shortLabel: 'Carne',
      imageUrl: '/recipe-images/beef.webp', labelStatus: 'missing', label: null, presentation: null
    });
    expect(detail.variants.map(({ id, recipeImageUrl, recipeLabelStatus }) => ({ id, recipeImageUrl, recipeLabelStatus }))).toEqual([
      { id: '1001', recipeImageUrl: '/recipe-images/beef.webp', recipeLabelStatus: 'missing' },
      { id: '1005', recipeImageUrl: '/recipe-images/beef.webp', recipeLabelStatus: 'missing' }
    ]);
  });

  test('the list carries a content summary and filters by code', async () => {
    const { service, repository } = setup();

    const list = await service.listProducts({ market: 'BR', code: 'beef' }, { page: 1, perPage: 20, offset: 0 });

    expect(repository.listProducts).toHaveBeenCalledWith(expect.objectContaining({ productIds: ['100'] }));
    expect(list.items[0].content).toMatchObject({ code: 'beef', labelStatus: 'missing' });
    expect(list.items[0].content).not.toHaveProperty('label');
  });

  test('a code no product has lists nothing', async () => {
    const { service, repository } = setup();
    await service.listProducts({ market: 'BR', code: 'bovino' }, { page: 1, perPage: 20, offset: 0 });
    expect(repository.listProducts).toHaveBeenCalledWith(expect.objectContaining({ productIds: [] }));
  });
});

describe('Delete removes the content with the product', () => {
  test('Product content goes with the product', async () => {
    const stripeBilling = { archiveCatalogProduct: jest.fn().mockResolvedValue(true) };
    const { service, repository, recipeContentRepository, recipeImageStorage } = setup({
      stripeBilling,
      contents: [{ ...BEEF_BR, imageUrl: '/recipe-images/beef.webp', planImageUrl: '/recipe-images/beef-plan.webp' }],
      product: { stripeProductId: 'prod_live_100', variants: [] }
    });

    await expect(service.deleteProduct('100')).resolves.toEqual({ deleted: true, id: '100' });
    expect(repository.deleteProduct).toHaveBeenCalledWith('100');
    expect(recipeContentRepository.deleteByProductId).toHaveBeenCalledWith('100');
    expect(recipeImageStorage.delete.mock.calls.map(([url]) => url)).toEqual(['/recipe-images/beef.webp', '/recipe-images/beef-plan.webp']);
  });

  test('Archive failure keeps the catalog', async () => {
    const stripeBilling = { archiveCatalogProduct: jest.fn().mockRejectedValue(new Error('stripe down')) };
    const { service, repository, recipeContentRepository, recipeImageStorage } = setup({
      stripeBilling,
      contents: [{ ...BEEF_BR, imageUrl: '/recipe-images/beef.webp' }],
      product: { stripeProductId: 'prod_live_100', variants: [] }
    });

    await expect(service.deleteProduct('100')).rejects.toMatchObject({ statusCode: 502, details: { code: 'stripe_product_archive_failed' } });
    expect(repository.deleteProduct).not.toHaveBeenCalled();
    expect(recipeContentRepository.deleteByProductId).not.toHaveBeenCalled();
    expect(recipeImageStorage.delete).not.toHaveBeenCalled();
  });
});

describe('Stripe prices of moved variations', () => {
  test('Moved variation keeps its Stripe price: the lookup key uses the old plan product', async () => {
    const stripeBilling = { ensureRecurringPrice: jest.fn().mockResolvedValue({ priceId: 'price_old', productId: 'prod_1' }) };
    const { service } = setup({
      stripeBilling,
      product: {
        id: '2025',
        variants: [{ id: '1001', name: 'Bovino 300g', regularPrice: 30, lookupProductId: '100', stripePriceId: 'price_old', stripePriceIdsByCurrency: { brl: 'price_old' }, stripeProductIdsByCurrency: { brl: 'prod_1' } }]
      },
      contents: [{ ...BEEF_BR, productId: '2025' }]
    });

    await service.sync({ productId: '2025' });

    expect(stripeBilling.ensureRecurringPrice).toHaveBeenCalledWith(expect.objectContaining({ lookupKey: 'eden_100_1001_brl_3000' }));
  });

  test('a variation created on the recipe product uses its own product id', async () => {
    const stripeBilling = { ensureRecurringPrice: jest.fn().mockResolvedValue({ priceId: 'price_new', productId: 'prod_1' }) };
    const { service } = setup({
      stripeBilling,
      product: { id: '2025', variants: [{ id: '3001', name: 'Bovino 700g', regularPrice: 50, stripePriceIdsByCurrency: {} }] },
      contents: [{ ...BEEF_BR, productId: '2025' }]
    });

    await service.sync({ productId: '2025' });

    expect(stripeBilling.ensureRecurringPrice).toHaveBeenCalledWith(expect.objectContaining({ lookupKey: 'eden_2025_3001_brl_5000' }));
  });

  test('variation prices are saved before publishing', async () => {
    const stripeBilling = { ensureRecurringPrice: jest.fn().mockResolvedValue('price_new_30') };
    const { service, repository } = setup({
      stripeBilling,
      product: { variants: [{ id: '1001', name: 'Beef 300g', sku: '1001', regularPrice: 25, active: true, stripePriceId: 'price_old', stripePriceIdsByCurrency: { brl: 'price_old' } }] }
    });

    const result = await service.patchProduct('100', { active: true, planCountry: 'BR', variants: [{ id: '1001', name: 'Beef 300g', regularPrice: 30 }] });

    expect(repository.updateVariation).toHaveBeenCalledWith(expect.objectContaining({ id: '1001', regularPrice: 30, priceChanged: true }));
    expect(stripeBilling.ensureRecurringPrice).toHaveBeenCalledWith(expect.objectContaining({ unitAmount: 3000, lookupKey: 'eden_100_1001_brl_3000' }));
    expect(repository.updatePostStatus).toHaveBeenCalledWith('100', 'publish');
    expect(result.active).toBe(true);
  });
});
