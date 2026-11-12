const { AdminCatalogRepository } = require('../src/infrastructure/repositories/admin-catalog.repository');

describe('AdminCatalogRepository', () => {
  test('lists products with created_at from the Node catalog schema', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{
          id: 10,
          name: 'Plano 28 dias',
          slug: 'plano-28',
          status: 'publish',
          createdAt: '2026-08-01 10:00:00',
          planCountry: 'BR',
          planDays: '28'
        }])
        .mockResolvedValueOnce([
          {
            variationId: 21,
            name: 'Frango',
            status: 'publish',
            meta_key: '_regular_price',
            meta_value: '129.90'
          },
          {
            variationId: 21,
            name: 'Frango',
            status: 'publish',
            meta_key: '_stripe_price_id',
            meta_value: 'price_brl_21'
          },
          {
            variationId: 21,
            name: 'Frango',
            status: 'publish',
            meta_key: '_stripe_price_ids_by_currency',
            meta_value: '{"brl":"price_brl_21"}'
          }
        ])
    };
    const repository = new AdminCatalogRepository(dataSource);
    const result = await repository.listProducts({ market: 'BR', offset: 0, perPage: 20 });

    expect(dataSource.query.mock.calls[1][0]).toContain('p.created_at AS createdAt');
    expect(dataSource.query.mock.calls[1][0]).toContain('ORDER BY p.created_at DESC');
    expect(dataSource.query.mock.calls[1][0]).not.toContain('post_date');
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: '10',
      slug: 'plano-28',
      planCountry: 'BR',
      variants: [
        expect.objectContaining({
          id: '21',
          name: 'Frango',
          regularPrice: 129.9,
          stripePriceId: 'price_brl_21',
          stripePriceIdsByCurrency: { brl: 'price_brl_21' }
        })
      ]
    });
  });

  test('maps empty variation titles from flavor attributes and zone prices', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{
          id: 100,
          name: 'Flavors BR',
          slug: 'flavors-br',
          status: 'publish',
          createdAt: '2026-08-01 10:00:00',
          planCountry: 'BR',
          planDays: '30'
        }])
        .mockResolvedValueOnce([
          { variationId: 1001, name: '', status: 'publish', meta_key: '_br_regular_price', meta_value: '25.00' },
          { variationId: 1001, name: '', status: 'publish', meta_key: 'attribute_pa_flavor', meta_value: 'Beef' },
          { variationId: 1001, name: '', status: 'publish', meta_key: 'attribute_pa_weight', meta_value: '300g' },
          { variationId: 1001, name: '', status: 'publish', meta_key: '_stripe_product_id', meta_value: 'prod_seed_br_beef_300g' },
          { variationId: 1001, name: '', status: 'publish', meta_key: '_stripe_price_id', meta_value: 'price_seed_br_beef_300g' }
        ])
    };
    const repository = new AdminCatalogRepository(dataSource);
    const result = await repository.listProducts({ market: 'BR', offset: 0, perPage: 20 });

    expect(result.items[0].variants[0]).toMatchObject({
      id: '1001',
      sku: '1001',
      name: 'Beef 300g',
      flavor: 'Beef',
      regularPrice: 25,
      stripeProductId: 'prod_seed_br_beef_300g',
      syncStatus: 'price_mismatch'
    });
  });

  test('loads a product by id using created_at', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{
          id: 10,
          name: 'Plano 28 dias',
          slug: 'plano-28',
          status: 'draft',
          createdAt: '2026-08-01 10:00:00',
          planCountry: 'US',
          planDays: '28'
        }])
        .mockResolvedValueOnce([])
    };
    const repository = new AdminCatalogRepository(dataSource);
    const product = await repository.getProduct(10);

    expect(dataSource.query.mock.calls[0][0]).toContain('p.created_at AS createdAt');
    expect(dataSource.query.mock.calls[0][0]).not.toContain('post_date');
    expect(product.planCountry).toBe('US');
    expect(product.variants).toEqual([]);
  });

  test('deletes a product with its variations and related rows', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{
          id: 2011,
          name: 'Teste',
          slug: 'teste',
          status: 'publish',
          createdAt: '2026-08-20 10:00:00',
          planCountry: 'BR',
          planDays: '30'
        }])
        .mockResolvedValueOnce([
          { variationId: 3001, name: 'Frango 300g', status: 'publish', meta_key: '_regular_price', meta_value: '25.00' }
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
    };
    const repository = new AdminCatalogRepository(dataSource);

    await expect(repository.deleteProduct('2011')).resolves.toBe(true);
    expect(dataSource.query.mock.calls[2][0]).toContain('DELETE FROM `wp_postmeta`');
    expect(dataSource.query.mock.calls[2][1]).toEqual([2011, 3001]);
    expect(dataSource.query.mock.calls[3][0]).toContain('DELETE FROM `wp_term_relationships`');
    expect(dataSource.query.mock.calls[4][0]).toContain('DELETE FROM `wp_posts`');
    expect(dataSource.query.mock.calls[4][1]).toEqual([2011, 3001]);
  });

  test('deletes a variation that belongs to the product', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ id: 3001 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
    };
    const repository = new AdminCatalogRepository(dataSource);

    await expect(repository.deleteVariation('2011', '3001')).resolves.toBe(true);
    expect(dataSource.query.mock.calls[0][0]).toContain("post_type` = 'product_variation'");
    expect(dataSource.query.mock.calls[0][1]).toEqual([3001, 2011]);
    expect(dataSource.query.mock.calls[1][1]).toEqual([3001]);
  });

  test('creates a product after every existing one in the store order', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ nextId: 2042 }])
        .mockResolvedValueOnce([{ nextOrder: 17 }])
        .mockResolvedValue([])
    };
    const repository = new AdminCatalogRepository(dataSource);

    await expect(repository.createProduct({ name: 'Cordeiro', slug: 'lamb-br', planCountry: 'BR' })).resolves.toBe('2042');

    expect(dataSource.query.mock.calls[1][0]).toContain("MAX(`menu_order`)");
    expect(dataSource.query.mock.calls[1][0]).toContain("`post_type` = 'product'");
    const insert = dataSource.query.mock.calls.find((call) => String(call[0]).startsWith('INSERT INTO `wp_posts`'));
    expect(insert[1]).toEqual([2042, 'Cordeiro', 'lamb-br', 17]);
  });

  test('creates a variation and stores the flavor attribute', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ nextId: 3001 }])
        .mockResolvedValue([])
    };
    const repository = new AdminCatalogRepository(dataSource);

    await expect(repository.createVariation({
      productId: 100,
      name: 'Lamb 300g',
      sku: 'LAMB-300',
      flavor: 'Lamb',
      regularPrice: 40,
      zoneId: 'br',
      menuOrder: 3
    })).resolves.toBe('3001');

    const flavorInsert = dataSource.query.mock.calls.find((call) => (
      String(call[0]).includes('INSERT INTO `wp_postmeta`')
      && Array.isArray(call[1])
      && call[1][1] === 'attribute_pa_flavor'
    ));
    expect(flavorInsert[1]).toEqual([3001, 'attribute_pa_flavor', 'Lamb']);
  });

  test('reads the life stage line of each variation, adult when the meta is missing', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ id: 100, name: 'Flavors BR', slug: 'flavors-br', status: 'draft', createdAt: '2026-08-01 10:00:00', planCountry: 'BR', planDays: '30' }])
        .mockResolvedValueOnce([
          { variationId: 1001, name: 'Beef 300g', status: 'publish', meta_key: 'attribute_pa_flavor', meta_value: 'Beef' },
          { variationId: 3001, name: 'Senior Beef 300g', status: 'publish', meta_key: '_life_stage', meta_value: 'senior' }
        ])
    };
    const repository = new AdminCatalogRepository(dataSource);
    const result = await repository.listProducts({ market: 'BR', offset: 0, perPage: 20 });

    const lines = Object.fromEntries(result.items[0].variants.map((variant) => [variant.id, variant.lifeStage]));
    expect(lines).toEqual({ 1001: 'adult', 3001: 'senior' });
  });

  test('stores the life stage line on create, adult by default, and on update only when given', async () => {
    const lineWrites = (dataSource) => dataSource.query.mock.calls
      .filter((call) => Array.isArray(call[1]) && call[1].includes('_life_stage'))
      .map((call) => call[1].filter((value) => value !== '_life_stage'));

    const created = { isInitialized: true, query: jest.fn().mockResolvedValueOnce([{ nextId: 3001 }]).mockResolvedValue([]) };
    await new AdminCatalogRepository(created).createVariation({ productId: 100, name: 'Senior Beef 300g', lifeStage: 'senior', zoneId: 'br' });
    expect(lineWrites(created).flat()).toContain('senior');

    const defaulted = { isInitialized: true, query: jest.fn().mockResolvedValueOnce([{ nextId: 3002 }]).mockResolvedValue([]) };
    await new AdminCatalogRepository(defaulted).createVariation({ productId: 100, name: 'Lamb 300g', zoneId: 'br' });
    expect(lineWrites(defaulted).flat()).toContain('adult');

    const untouched = { isInitialized: true, query: jest.fn().mockResolvedValue([]) };
    await new AdminCatalogRepository(untouched).updateVariation({ id: 1001, name: 'Beef 300g', zoneId: 'br' });
    expect(lineWrites(untouched)).toEqual([]);

    const updated = { isInitialized: true, query: jest.fn().mockResolvedValue([]) };
    await new AdminCatalogRepository(updated).updateVariation({ id: 1001, lifeStage: 'puppy', zoneId: 'br' });
    expect(lineWrites(updated).flat()).toContain('puppy');
  });

  test('creates every new variation as draft', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValueOnce([{ nextId: 3001 }]).mockResolvedValue([]) };
    await new AdminCatalogRepository(dataSource).createVariation({ productId: 100, name: 'Senior Beef 300g', zoneId: 'br' });

    const insert = dataSource.query.mock.calls.find((call) => String(call[0]).includes("'product_variation'"));
    expect(insert[0]).toContain("'product_variation', 'draft'");
  });

  test('stores and reads the final-image and label-data confirmations', async () => {
    const written = { isInitialized: true, query: jest.fn().mockResolvedValue([]) };
    await new AdminCatalogRepository(written).updateVariation({ id: 3001, finalImageReady: true, labelDataReady: false, zoneId: 'us' });
    const flags = written.query.mock.calls
      .filter((call) => Array.isArray(call[1]) && call[1].some((value) => String(value).endsWith('_ready')))
      .map((call) => call[1].filter((value) => value !== 3001));
    expect(flags).toEqual(expect.arrayContaining([['_final_image_ready', 'yes'], ['_label_data_ready', 'no']].map((pair) => expect.arrayContaining(pair))));

    const read = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ id: 200, name: 'Flavors US', slug: 'flavors-us', status: 'publish', createdAt: '2026-08-01 10:00:00', planCountry: 'US', planDays: '30' }])
        .mockResolvedValueOnce([
          { variationId: 3001, name: 'Senior Beef 10.6oz', status: 'draft', meta_key: '_final_image_ready', meta_value: 'yes' },
          { variationId: 3002, name: 'Senior Chicken 10.6oz', status: 'draft', meta_key: '_label_data_ready', meta_value: 'no' }
        ])
    };
    const result = await new AdminCatalogRepository(read).listProducts({ market: 'US', offset: 0, perPage: 20 });
    const byId = Object.fromEntries(result.items[0].variants.map((item) => [item.id, [item.active, item.finalImageReady, item.labelDataReady]]));
    expect(byId).toEqual({ 3001: [false, true, false], 3002: [false, false, false] });
  });

  test('returns an empty catalog when the table does not exist', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockRejectedValue({
        code: 'ER_NO_SUCH_TABLE',
        errno: 1146,
        message: "Table 'eden_bowls.wp_posts' doesn't exist"
      })
    };
    const repository = new AdminCatalogRepository(dataSource);

    await expect(repository.listProducts({ offset: 0, perPage: 20 })).resolves.toEqual({
      total: 0,
      items: []
    });
  });

  test('lists the variations of one product, and every product of a market with its variations', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([
        { variationId: 1001, name: 'Beef 300g', sku: '1001', productId: 2025, productName: 'Bovino', market: 'BR', variationStatus: 'draft', productStatus: 'publish', flavorSlug: 'beef', recipeKey: 'beef', label: 'Bovino', shortLabel: null, lifeStage: 'adult' },
        { variationId: 1005, name: 'Beef 500g', sku: '1005', productId: 2025, productName: 'Bovino', market: 'BR', variationStatus: 'publish', productStatus: 'publish', flavorSlug: 'beef', recipeKey: 'beef', label: 'Bovino', shortLabel: null, lifeStage: 'adult' },
        { variationId: 1003, name: 'Porco 300g', sku: '1003', productId: 2029, productName: 'Porco', market: 'BR', variationStatus: 'publish', productStatus: 'publish', flavorSlug: 'pork', recipeKey: 'pork', label: 'Bovino', shortLabel: null, lifeStage: 'adult' },
        { variationId: 2001, name: 'Beef 300g', sku: '2001', productId: 2026, productName: 'Beef', market: 'US', variationStatus: 'publish', productStatus: 'publish', flavorSlug: 'beef', recipeKey: 'beef', label: 'Beef', shortLabel: null, lifeStage: 'adult' }
      ])
    };
    const repository = new AdminCatalogRepository(dataSource);

    // A flavor alias does not link a variation: the Porco variation labelled Bovino stays out of the beef product.
    expect(await repository.listProductVariations('2025')).toEqual([
      { id: '1001', name: 'Beef 300g', sku: '1001', active: false, productId: '2025', productName: 'Bovino' },
      { id: '1005', name: 'Beef 500g', sku: '1005', active: true, productId: '2025', productName: 'Bovino' }
    ]);
    const byProduct = await repository.listMarketProductVariations('br');
    expect([...byProduct.keys()]).toEqual(['2025', '2029']);
  });

  test('puts a product in the flavors category', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValueOnce([{ id: 100 }]).mockResolvedValueOnce([]) };
    const repository = new AdminCatalogRepository(dataSource);

    await expect(repository.assignCategory('300', 'flavors')).resolves.toBe(true);

    expect(dataSource.query.mock.calls[0][0]).toContain("tt.taxonomy = 'product_cat' AND t.slug = ?");
    expect(dataSource.query.mock.calls[0][1]).toEqual(['flavors']);
    expect(dataSource.query.mock.calls[1]).toEqual([expect.stringContaining('INSERT INTO `wp_term_relationships`'), [300, 100]]);
  });

  test('writes the flavor copies on every variation of a product', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValueOnce([{ id: 1001 }, { id: 1005 }]) };
    const repository = new AdminCatalogRepository(dataSource);
    repository.upsertPostMeta = jest.fn();

    await repository.rewriteFlavorCopies('2025', { flavor: 'Bovino', flavorSlug: 'beef', flavorAliases: 'bovino,carne', lifeStage: 'adult', shortLabel: '' });

    const written = repository.upsertPostMeta.mock.calls.filter(([id]) => id === 1005).map(([, key, value]) => [key, value]);
    expect(written).toEqual([
      ['attribute_pa_flavor', 'Bovino'], ['_flavor_slug', 'beef'], ['_recipe_key', 'beef'],
      ['_flavor_aliases', 'bovino,carne'], ['_life_stage', 'adult'], ['_short_label', '']
    ]);
    expect(repository.upsertPostMeta.mock.calls.filter(([id]) => id === 1001)).toHaveLength(6);
  });

  test('stores, keeps or clears the weight of a variation and reads the Stripe lookup product', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue([]) };
    const repository = new AdminCatalogRepository(dataSource);
    repository.upsertPostMeta = jest.fn();
    repository.updatePost = jest.fn();

    await repository.updateVariation({ id: '1001', weight: '300g' });
    await repository.updateVariation({ id: '1002', weight: '' });
    await repository.updateVariation({ id: '1003' });

    const weights = repository.upsertPostMeta.mock.calls.filter(([, key]) => key === 'attribute_pa_weight');
    expect(weights).toEqual([['1001', 'attribute_pa_weight', '300g'], ['1002', 'attribute_pa_weight', '']]);

    dataSource.query.mockResolvedValueOnce([
      { variationId: 1001, name: 'Bovino 300g', status: 'publish', meta_key: '_stripe_lookup_product_id', meta_value: '100' }
    ]);
    const [variation] = await repository.listVariations(2025, 'BR');
    expect(variation.lookupProductId).toBe('100');
  });

  test('stores, keeps or clears the recipe key of a variation', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue([]) };
    const repository = new AdminCatalogRepository(dataSource);
    repository.upsertPostMeta = jest.fn();
    repository.updatePost = jest.fn();

    await repository.updateVariation({ id: '1001', recipeKey: 'beef' });
    await repository.updateVariation({ id: '1002', recipeKey: null });
    await repository.updateVariation({ id: '1003' });

    const keyWrites = repository.upsertPostMeta.mock.calls.filter(([, key]) => key === '_recipe_key');
    expect(keyWrites).toEqual([['1001', '_recipe_key', 'beef'], ['1002', '_recipe_key', '']]);
  });
});
