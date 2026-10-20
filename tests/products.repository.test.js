const { ProductsRepository } = require('../src/infrastructure/repositories/products.repository');

describe('ProductsRepository', () => {
  test('filters out variations without strict stripe bindings for flavors', () => {
    const priceZonePolicyRepository = {
      findActiveZoneId: jest.fn().mockResolvedValue('br')
    };

    const repository = new ProductsRepository(
      { isInitialized: true, query: jest.fn() },
      { priceZonePolicyRepository }
    );

    const variations = repository.mapVariations(
      [
        {
          variation_id: 1,
          meta: {
            _br_regular_price: '29.90',
            _stripe_product_id: 'prod_abc',
            _stripe_price_id: 'price_123',
            _stripe_price_ids_by_currency: '{"brl":"price_123"}',
            attribute_pa_flavor: 'Frango',
            attribute_pa_weight: '300g'
          }
        },
        {
          variation_id: 2,
          meta: {
            _br_regular_price: '31.50',
            _stripe_product_id: 'bad',
            _stripe_price_id: 'price_456',
            _stripe_price_ids_by_currency: '{"brl":"price_456"}',
            attribute_pa_flavor: 'Carne',
            attribute_pa_weight: '300g'
          }
        }
      ],
      'br',
      'BRL',
      'flavors'
    );

    expect(variations).toEqual([
      {
        variation_id: 1,
        flavor: 'Frango',
        flavor_key: 'turkey',
        life_stage: 'adult',
        flavor_aliases: [],
        weight: '300g',
        price: 29.9,
        currency: 'BRL'
      }
    ]);
  });

  test('uses zone sale price when active and falls back to zone regular price', () => {
    const repository = new ProductsRepository(
      { isInitialized: true, query: jest.fn() },
      {
        nowProvider: () => new Date('2026-08-07T00:00:00Z')
      }
    );

    expect(
      repository.resolveVariationPrice({
        meta: {
          _br_sale_price: '27.90',
          _br_regular_price: '29.90',
          _br_sale_price_dates_from: '1754092800',
          _br_sale_price_dates_to: '1798761600'
        }
      }, 'br')
    ).toBe(27.9);

    expect(
      repository.resolveVariationPrice({
        meta: {
          _br_sale_price: '27.90',
          _br_regular_price: '29.90',
          _br_sale_price_dates_from: '1798761600',
          _br_sale_price_dates_to: '1811894400'
        }
      }, 'br')
    ).toBe(29.9);
  });

  test('returns null when zone is not configured for currency', () => {
    const repository = new ProductsRepository({ isInitialized: true, query: jest.fn() });

    expect(
      repository.resolveVariationPrice(
        {
          meta: {
            _br_regular_price: '29.90'
          }
        },
        null
      )
    ).toBeNull();
  });

  test('reads zone id from policy repository', async () => {
    const priceZonePolicyRepository = {
      findActiveZoneId: jest.fn().mockResolvedValue('us')
    };
    const repository = new ProductsRepository(
      { isInitialized: true, query: jest.fn() },
      { priceZonePolicyRepository }
    );

    await expect(repository.findZoneIdByCountryCurrency('US', 'USD')).resolves.toBe('us');
    expect(priceZonePolicyRepository.findActiveZoneId).toHaveBeenCalledWith('US', 'USD');
  });

  test('lists published flavor labels for a country', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([
        { flavor: 'Beef', menu_order: 1, variation_id: 1001 },
        { flavor: 'Lamb', menu_order: 2, variation_id: 1005 }
      ])
    };
    const repository = new ProductsRepository(dataSource);

    await expect(repository.listFlavorLabelsByCountry('BR')).resolves.toEqual(['Beef', 'Lamb']);
    expect(dataSource.query.mock.calls[0][0]).toContain('attribute_pa_flavor');
    expect(dataSource.query.mock.calls[0][1]).toEqual(['BR']);
  });

  test('lists published flavor identities with slug and aliases', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([
        { label: 'Frango', slug: 'turkey', aliases: 'chicken,frango,peru', menu_order: 1, variation_id: 1004 }
      ])
    };
    const repository = new ProductsRepository(dataSource);

    await expect(repository.listFlavorOptionsByCountry('BR')).resolves.toEqual([
      { key: 'turkey', label: 'Frango', aliases: ['chicken', 'frango', 'peru'] }
    ]);
    expect(dataSource.query.mock.calls[0][0]).toContain('_flavor_slug');
  });

  test('returns an empty flavor list when catalog tables are missing', async () => {
    const repository = new ProductsRepository({
      isInitialized: true,
      query: jest.fn().mockRejectedValue({
        code: 'ER_NO_SUCH_TABLE',
        errno: 1146,
        message: "Table 'eden_bowls.wp_posts' doesn't exist"
      })
    });

    await expect(repository.listFlavorLabelsByCountry('US')).resolves.toEqual([]);
  });

  test('throws 503 when datasource is not initialized', async () => {
    const repository = new ProductsRepository({ isInitialized: false, query: jest.fn() });

    await expect(
      repository.listByCategory({
        categorySlug: 'flavors',
        country: 'BR',
        currency: 'BRL'
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      message: 'Database connection is not initialized.'
    });
  });

  test('throws catalog_not_initialized when catalog tables are missing', async () => {
    const repository = new ProductsRepository(
      {
        isInitialized: true,
        query: jest.fn().mockRejectedValue({
          code: 'ER_NO_SUCH_TABLE',
          errno: 1146,
          message: "Table 'eden_bowls.wp_terms' doesn't exist"
        })
      },
      {
        priceZonePolicyRepository: {
          findActiveZoneId: jest.fn().mockResolvedValue('br')
        }
      }
    );

    await expect(
      repository.listByCategory({
        categorySlug: 'flavors',
        country: 'BR',
        currency: 'BRL'
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      message: 'Products catalog is not initialized. Run migrations and seed data.',
      details: { code: 'catalog_not_initialized' }
    });
  });

  test('accepts the BRL binding a BR catalog sync writes', () => {
    const repository = new ProductsRepository({ isInitialized: true, query: jest.fn() });
    const variation = {
      meta: {
        _stripe_product_id: 'prod_br_new',
        _stripe_price_id: 'price_br_new',
        _stripe_price_ids_by_currency: JSON.stringify({ brl: 'price_br_new' })
      }
    };

    expect(repository.hasStrictStripeBinding(variation, 'BRL')).toBe(true);
    expect(repository.hasStrictStripeBinding(variation, 'USD')).toBe(false);
  });

  test('reads the life stage line of each variation and filters by it', async () => {
    const meta = (flavor, extra = {}) => ({
      _br_regular_price: '40.00',
      _stripe_product_id: 'prod_abc',
      _stripe_price_id: 'price_1',
      _stripe_price_ids_by_currency: '{"brl":"price_1"}',
      attribute_pa_flavor: flavor,
      attribute_pa_weight: '300g',
      ...extra
    });
    const repository = new ProductsRepository(
      { isInitialized: true, query: jest.fn() },
      { priceZonePolicyRepository: { findActiveZoneId: jest.fn().mockResolvedValue('br') } }
    );
    const rows = [
      { variation_id: 1, meta: meta('Bovino') },
      { variation_id: 2, meta: meta('Receita de Carne para Cães Sênior', { _flavor_slug: 'senior-beef', _life_stage: 'senior' }) }
    ];
    expect(repository.mapVariations(rows, 'br', 'BRL', 'flavors').map((item) => [item.flavor_key, item.life_stage]))
      .toEqual([['beef', 'adult'], ['senior-beef', 'senior']]);

    repository.ensureDataSourceReady = jest.fn();
    repository.findCategoryBySlug = jest.fn().mockResolvedValue({ id: 10, slug: 'flavors', name: 'Flavors' });
    repository.findProducts = jest.fn().mockResolvedValue([{ id: 100, name: 'Flavors BR', slug: 'flavors-br', days: 30 }]);
    repository.findZoneIdByCountryCurrency = jest.fn().mockResolvedValue('br');
    repository.findVariationRowsByProductId = jest.fn().mockResolvedValue(rows);
    repository.findProductTags = jest.fn().mockResolvedValue([]);

    const senior = await repository.listByCategory({ categorySlug: 'flavors', country: 'BR', currency: 'BRL', lifeStage: 'senior' });
    expect(senior.products[0].variations.map((item) => item.variation_id)).toEqual([2]);
    const puppy = await repository.listByCategory({ categorySlug: 'flavors', country: 'BR', currency: 'BRL', lifeStage: 'puppy' });
    expect(puppy.products).toEqual([]);
  });
});
