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
      planDays: 28,
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
});
