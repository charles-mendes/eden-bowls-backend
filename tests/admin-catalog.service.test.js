const { AdminCatalogService } = require('../src/services/admin-catalog.service');

describe('AdminCatalogService', () => {
  test('health counts mapped Stripe prices and gaps for the requested currency', async () => {
    const repository = {
      listProducts: jest.fn().mockResolvedValue({
        total: 1,
        items: [
          {
            variants: [
              { id: '21', stripePriceId: 'price_brl_21', stripePriceIdsByCurrency: { brl: 'price_brl_21' } },
              { id: '22', stripePriceId: null, stripePriceIdsByCurrency: {} }
            ]
          }
        ]
      })
    };
    const service = new AdminCatalogService({ repository });

    await expect(service.health({ market: 'BR', currency: 'BRL' })).resolves.toEqual({
      market: 'BR',
      currency: 'BRL',
      totalExpected: 2,
      totalMapped: 1,
      gaps: ['22']
    });
    expect(repository.listProducts).toHaveBeenCalledWith({
      market: 'BR',
      offset: 0,
      perPage: 500
    });
  });

  test('health tolerates missing variants and price maps', async () => {
    const repository = {
      listProducts: jest.fn().mockResolvedValue({
        total: 1,
        items: [{ id: '10' }]
      })
    };
    const service = new AdminCatalogService({ repository });

    await expect(service.health({ market: 'US', currency: 'USD' })).resolves.toEqual({
      market: 'US',
      currency: 'USD',
      totalExpected: 0,
      totalMapped: 0,
      gaps: []
    });
  });

  test('patchProduct updates existing variations and creates new ones', async () => {
    const product = {
      id: '100',
      active: false,
      planCountry: 'BR',
      planDays: 30,
      variants: [{ id: '1001', name: 'Beef 300g', sku: 'Beef-300g', regularPrice: 25 }]
    };
    const repository = {
      getProduct: jest.fn().mockResolvedValue(product),
      upsertPostMeta: jest.fn(),
      createVariation: jest.fn().mockResolvedValue('3001'),
      updateVariation: jest.fn(),
      updatePostStatus: jest.fn()
    };
    const service = new AdminCatalogService({ repository });

    await service.patchProduct('100', {
      planCountry: 'BR',
      planDays: 30,
      variants: [
        { id: '1001', name: 'Beef 300g', sku: 'Beef-300g', regularPrice: 28 },
        { name: 'Lamb 300g', sku: 'LAMB-300', regularPrice: 40 }
      ]
    });

    expect(repository.updateVariation).toHaveBeenCalledWith({
      id: '1001',
      name: 'Beef 300g',
      sku: 'Beef-300g',
      regularPrice: 28,
      zoneId: 'br',
      priceChanged: true
    });
    expect(repository.createVariation).toHaveBeenCalledWith({
      productId: '100',
      name: 'Lamb 300g',
      sku: 'LAMB-300',
      regularPrice: 40,
      zoneId: 'br',
      menuOrder: 2
    });
  });

  test('sync lookup key includes unit amount so a price change creates a new Stripe price', async () => {
    const repository = {
      getProduct: jest.fn().mockResolvedValue({
        id: '100',
        namePt: 'Flavors BR',
        planCountry: 'BR',
        variants: [{
          id: '1001',
          name: 'Beef 300g',
          sku: '1001',
          regularPrice: 30,
          stripePriceId: 'price_old',
          stripePriceIdsByCurrency: { brl: 'price_old' }
        }]
      }),
      fingerprint: jest.fn().mockReturnValue('fp-30'),
      upsertPostMeta: jest.fn()
    };
    const stripeBilling = {
      ensureRecurringPrice: jest.fn().mockResolvedValue('price_new_30')
    };
    const service = new AdminCatalogService({ repository, stripeBilling });

    await service.sync({ productId: '100' });

    expect(stripeBilling.ensureRecurringPrice).toHaveBeenCalledWith({
      lookupKey: 'eden_100_1001_brl_3000',
      currency: 'brl',
      unitAmount: 3000,
      nickname: 'Flavors BR - Beef 300g'
    });
  });

  test('patchProduct saves variation prices before publishing', async () => {
    let stored = {
      id: '100',
      active: false,
      planCountry: 'BR',
      planDays: 30,
      namePt: 'Flavors BR',
      variants: [{
        id: '1001',
        name: 'Beef 300g',
        sku: '1001',
        regularPrice: 25,
        active: true,
        stripePriceId: 'price_old',
        stripePriceIdsByCurrency: { brl: 'price_old' }
      }]
    };
    const repository = {
      getProduct: jest.fn(async () => stored),
      upsertPostMeta: jest.fn(),
      updateVariation: jest.fn(async ({ regularPrice }) => {
        stored = {
          ...stored,
          variants: [{ ...stored.variants[0], regularPrice }]
        };
      }),
      updatePostStatus: jest.fn(async (_id, status) => {
        stored = { ...stored, active: status === 'publish' };
      }),
      fingerprint: jest.fn().mockReturnValue('fp-30')
    };
    const stripeBilling = {
      ensureRecurringPrice: jest.fn().mockResolvedValue('price_new_30')
    };
    const service = new AdminCatalogService({ repository, stripeBilling });

    const result = await service.patchProduct('100', {
      active: true,
      planCountry: 'BR',
      planDays: 30,
      variants: [{ id: '1001', name: 'Beef 300g', sku: '1001', regularPrice: 30 }]
    });

    expect(repository.updateVariation).toHaveBeenCalledWith(expect.objectContaining({
      id: '1001',
      regularPrice: 30,
      priceChanged: true
    }));
    expect(stripeBilling.ensureRecurringPrice).toHaveBeenCalledWith(expect.objectContaining({
      unitAmount: 3000,
      lookupKey: 'eden_100_1001_brl_3000'
    }));
    expect(repository.updatePostStatus).toHaveBeenCalledWith('100', 'publish');
    expect(result.active).toBe(true);
    expect(result.variants[0].regularPrice).toBe(30);
  });

  test('patchProduct rejects a new variation without name or SKU', async () => {
    const repository = {
      getProduct: jest.fn().mockResolvedValue({
        id: '100',
        active: false,
        planCountry: 'BR',
        variants: []
      })
    };
    const service = new AdminCatalogService({ repository });

    await expect(service.patchProduct('100', {
      variants: [{ regularPrice: 10 }]
    })).rejects.toMatchObject({
      statusCode: 422,
      message: 'New variations require a name or SKU.'
    });
  });
});
