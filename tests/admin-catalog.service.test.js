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
});
