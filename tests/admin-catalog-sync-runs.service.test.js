const { AdminCatalogService } = require('../src/services/admin-catalog.service');

function product(id, planCountry, variants) {
  return { id, planCountry, namePt: `Bowl ${id}`, variants };
}

function serviceWith({ products, ensureRecurringPrice, runs = [] }) {
  const repository = {
    listProducts: jest.fn().mockResolvedValue({ items: products }),
    fingerprint: jest.fn(() => 'fp'),
    upsertPostMeta: jest.fn().mockResolvedValue()
  };
  const stripeBilling = {
    ensureRecurringPrice: ensureRecurringPrice || jest.fn().mockResolvedValue({ priceId: 'price_1', productId: 'prod_1' })
  };
  const syncRunsRepository = {
    insert: jest.fn(async (run) => {
      runs.push(run);
    }),
    latestByMarket: jest.fn(async (markets) => Object.fromEntries(
      markets.filter((market) => runs.some((run) => run.market === market))
        .map((market) => {
          const run = runs.filter((item) => item.market === market).at(-1);
          return [market, { ...run, updatedAt: run.finishedAt }];
        })
    ))
  };
  const service = new AdminCatalogService({
    repository,
    stripeAccounts: { getForCreation: () => stripeBilling, get: () => stripeBilling },
    stripeBrEnabled: true,
    syncRunsRepository
  });
  return { service, syncRunsRepository, runs };
}

describe('catalog sync runs', () => {
  test('stores one completed run per market the sync touched', async () => {
    const { service, runs } = serviceWith({
      products: [
        product('1', 'BR', [{ id: '11', regularPrice: 30, name: 'A' }, { id: '12', regularPrice: 0, name: 'B' }]),
        product('2', 'US', [{ id: '21', regularPrice: 40, name: 'C', stripePriceId: 'price_old' }])
      ]
    });

    const result = await service.sync({});

    expect(result.summary.created).toBe(1);
    expect(runs).toEqual([
      expect.objectContaining({ market: 'BR', currency: 'brl', scope: 'market', status: 'completed', summary: { created: 1, updated: 0, skipped: [{ variationId: '12', reason: 'missing_price' }] } }),
      expect.objectContaining({ market: 'US', currency: 'usd', status: 'completed', summary: { created: 0, updated: 1, skipped: [] } })
    ]);
  });

  test('stores a failed run with the error and still throws it', async () => {
    const failure = new Error('No such product');
    const { service, runs } = serviceWith({
      products: [product('2', 'US', [{ id: '21', regularPrice: 40, name: 'C' }])],
      ensureRecurringPrice: jest.fn().mockRejectedValue(failure)
    });

    await expect(service.sync({ market: 'US', currency: 'USD' })).rejects.toBe(failure);

    expect(runs).toEqual([expect.objectContaining({ market: 'US', status: 'failed', error: 'No such product' })]);
  });

  test('records a failure before any product was read against the requested market', async () => {
    const { service, runs } = serviceWith({ products: [] });
    service.repository.listProducts.mockRejectedValue(new Error('db down'));

    await expect(service.sync({ market: 'BR' })).rejects.toThrow('db down');

    expect(runs).toEqual([expect.objectContaining({ market: 'BR', status: 'failed', error: 'db down', summary: null })]);
  });

  test('does not hide the sync result when storing the run fails', async () => {
    const { service, syncRunsRepository } = serviceWith({ products: [product('1', 'BR', [{ id: '11', regularPrice: 30, name: 'A' }])] });
    syncRunsRepository.insert.mockRejectedValue(new Error('table missing'));

    await expect(service.sync({ market: 'BR' })).resolves.toMatchObject({ status: 'completed' });
  });

  test('status shows only the markets in the caller scope', async () => {
    const { service, syncRunsRepository } = serviceWith({ products: [] });
    syncRunsRepository.latestByMarket.mockResolvedValue({ US: { status: 'completed', market: 'US', updatedAt: '2026-10-08T10:00:00.000Z' } });

    const status = await service.status({ markets: ['US'] });

    expect(syncRunsRepository.latestByMarket).toHaveBeenCalledWith(['US']);
    expect(status).toEqual({ status: 'completed', market: 'US', updatedAt: '2026-10-08T10:00:00.000Z', byMarket: { US: expect.any(Object) } });
  });

  test('status puts the newest market on top for an admin', async () => {
    const { service, syncRunsRepository } = serviceWith({ products: [] });
    syncRunsRepository.latestByMarket.mockResolvedValue({
      BR: { status: 'failed', market: 'BR', updatedAt: '2026-10-08T11:00:00.000Z' },
      US: { status: 'completed', market: 'US', updatedAt: '2026-10-08T10:00:00.000Z' }
    });

    const status = await service.status({ markets: ['BR', 'US'] });

    expect(status.market).toBe('BR');
    expect(Object.keys(status.byMarket)).toEqual(['BR', 'US']);
  });

  test('status is empty when nothing ran', async () => {
    const { service } = serviceWith({ products: [] });
    await expect(service.status({ markets: ['BR', 'US'] })).resolves.toEqual({ status: null, byMarket: {} });
  });
});
