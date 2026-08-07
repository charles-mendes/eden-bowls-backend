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
});
