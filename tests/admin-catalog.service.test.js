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
      markets: ['BR'],
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
        { id: '1001', name: 'Beef 300g', sku: 'Beef-300g', flavor: 'Beef', regularPrice: 28 },
        { name: 'Lamb 300g', sku: 'LAMB-300', flavor: 'Lamb', regularPrice: 40 }
      ]
    });

    expect(repository.updateVariation).toHaveBeenCalledWith({
      id: '1001',
      name: 'Beef 300g',
      sku: 'Beef-300g',
      flavor: 'Beef',
      flavorSlug: 'beef',
      flavorAliases: 'bovino,carne',
      regularPrice: 28,
      zoneId: 'br',
      priceChanged: true
    });
    expect(repository.createVariation).toHaveBeenCalledWith({
      productId: '100',
      name: 'Lamb 300g',
      sku: 'LAMB-300',
      flavor: 'Lamb',
      flavorSlug: 'lamb',
      flavorAliases: undefined,
      regularPrice: 40,
      zoneId: 'br',
      menuOrder: 2
    });
  });

  test('patchProduct with only one variation leaves plan fields and sibling variations untouched', async () => {
    const product = {
      id: '100',
      active: false,
      planCountry: 'BR',
      planDays: 30,
      variants: [
        { id: '1001', name: 'Beef 300g', sku: 'Beef-300g', regularPrice: 25 },
        { id: '1002', name: 'Lamb 300g', sku: 'LAMB-300', regularPrice: 40 }
      ]
    };
    const repository = {
      getProduct: jest.fn().mockResolvedValue(product),
      upsertPostMeta: jest.fn(),
      createVariation: jest.fn(),
      updateVariation: jest.fn(),
      updatePostStatus: jest.fn()
    };
    const service = new AdminCatalogService({ repository });

    await service.patchProduct('100', {
      variants: [{ id: '1001', name: 'Beef 300g', sku: 'Beef-300g', flavor: 'Beef', regularPrice: 28 }]
    });

    const metaKeys = repository.upsertPostMeta.mock.calls.map((call) => call[1]);
    expect(metaKeys).not.toContain('_cmpb_plan_country');
    expect(metaKeys).not.toContain('_cmpb_plan_days');
    expect(repository.updateVariation).toHaveBeenCalledTimes(1);
    expect(repository.updateVariation).toHaveBeenCalledWith(expect.objectContaining({ id: '1001' }));
    expect(repository.updateVariation).not.toHaveBeenCalledWith(expect.objectContaining({ id: '1002' }));
    expect(repository.createVariation).not.toHaveBeenCalled();
  });

  test('createProduct stores a Stripe product and optional first variation', async () => {
    const repository = {
      createProduct: jest.fn().mockResolvedValue('301'),
      upsertPostMeta: jest.fn(),
      getProduct: jest.fn()
        .mockResolvedValueOnce({
          id: '301',
          namePt: 'Plano novo',
          planCountry: 'BR',
          stripeProductId: 'prod_live_301',
          variants: []
        })
        .mockResolvedValue({
          id: '301',
          namePt: 'Plano novo',
          planCountry: 'BR',
          stripeProductId: 'prod_live_301',
          variants: [{ id: '401', name: 'Frango 300g', regularPrice: 30 }]
        }),
      createVariation: jest.fn().mockResolvedValue('401'),
      fingerprint: jest.fn().mockReturnValue('fp'),
      updateVariation: jest.fn()
    };
    const stripeBilling = {
      createCatalogProduct: jest.fn().mockResolvedValue('prod_live_301'),
      ensureRecurringPrice: jest.fn().mockResolvedValue({ priceId: 'price_live_401', productId: 'prod_live_301' })
    };
    const service = new AdminCatalogService({ repository, stripeBilling });

    const created = await service.createProduct({
      name: 'Plano novo',
      planCountry: 'BR',
      planDays: 30,
      variants: [{ name: 'Frango 300g', sku: 'FR-300', regularPrice: 30 }]
    });

    expect(repository.createProduct).toHaveBeenCalledWith({
      name: 'Plano novo',
      slug: undefined,
      planCountry: 'BR',
      planDays: 30
    });
    expect(stripeBilling.createCatalogProduct).toHaveBeenCalledWith({
      name: 'Plano novo',
      metadata: { catalog_product_id: '301', market: 'BR' }
    });
    expect(repository.createVariation).toHaveBeenCalledWith(expect.objectContaining({
      productId: '301',
      name: 'Frango 300g',
      sku: 'FR-300',
      regularPrice: 30
    }));
    expect(created.id).toBe('301');
    expect(created.stripeProductId).toBe('prod_live_301');
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

  test('deleteProduct archives live Stripe products then removes the catalog row', async () => {
    const repository = {
      getProduct: jest.fn().mockResolvedValue({
        id: '2011',
        stripeProductId: 'prod_live_2011',
        variants: [{ id: '3001', stripeProductId: 'prod_live_3001' }]
      }),
      deleteProduct: jest.fn().mockResolvedValue(true)
    };
    const stripeBilling = {
      archiveCatalogProduct: jest.fn().mockResolvedValue('prod_live_2011')
    };
    const service = new AdminCatalogService({ repository, stripeBilling });

    await expect(service.deleteProduct('2011')).resolves.toEqual({ deleted: true, id: '2011' });
    expect(stripeBilling.archiveCatalogProduct).toHaveBeenCalledWith('prod_live_2011');
    expect(stripeBilling.archiveCatalogProduct).toHaveBeenCalledWith('prod_live_3001');
    expect(repository.deleteProduct).toHaveBeenCalledWith('2011');
  });

  test('deleteProduct keeps the catalog row when Stripe archive fails', async () => {
    const repository = {
      getProduct: jest.fn().mockResolvedValue({
        id: '2011',
        stripeProductId: 'prod_live_2011',
        variants: []
      }),
      deleteProduct: jest.fn().mockResolvedValue(true)
    };
    const stripeBilling = {
      archiveCatalogProduct: jest.fn().mockRejectedValue(new Error('stripe down'))
    };
    const service = new AdminCatalogService({ repository, stripeBilling });

    await expect(service.deleteProduct('2011')).rejects.toMatchObject({
      statusCode: 502,
      details: { code: 'stripe_product_archive_failed' }
    });
    expect(repository.deleteProduct).not.toHaveBeenCalled();
  });

  test('deleteProduct skips seed Stripe ids and still removes the catalog row', async () => {
    const repository = {
      getProduct: jest.fn().mockResolvedValue({
        id: '2011',
        stripeProductId: 'prod_seed_2011',
        variants: []
      }),
      deleteProduct: jest.fn().mockResolvedValue(true)
    };
    const stripeBilling = {
      archiveCatalogProduct: jest.fn()
    };
    const service = new AdminCatalogService({ repository, stripeBilling });

    await expect(service.deleteProduct('2011')).resolves.toEqual({ deleted: true, id: '2011' });
    expect(stripeBilling.archiveCatalogProduct).not.toHaveBeenCalled();
    expect(repository.deleteProduct).toHaveBeenCalledWith('2011');
  });

  test('catalog reads mark canDelete false when only a line-item price is referenced', async () => {
    const repository = {
      listProducts: jest.fn().mockResolvedValue({
        total: 1,
        items: [{
          id: '10',
          active: true,
          variants: [
            { id: '21', stripePriceId: 'price_used', stripePriceIdsByCurrency: { brl: 'price_used' } },
            { id: '22', stripePriceId: 'price_free', stripePriceIdsByCurrency: { brl: 'price_free' } }
          ]
        }]
      }),
      getProduct: jest.fn().mockResolvedValue({
        id: '10',
        active: true,
        variants: [
          { id: '21', stripePriceId: 'price_used', stripePriceIdsByCurrency: { brl: 'price_used' } },
          { id: '22', stripePriceId: 'price_free', stripePriceIdsByCurrency: { brl: 'price_free' } }
        ]
      })
    };
    const ledgerRepository = {
      findReferencedCatalogIds: jest.fn().mockResolvedValue({
        variationIds: [],
        priceIds: ['price_used']
      })
    };
    const service = new AdminCatalogService({ repository, ledgerRepository });

    const list = await service.listProducts({}, { offset: 0, perPage: 20, page: 1 });
    expect(list.items[0].canDelete).toBe(false);
    expect(list.items[0].variants.map((item) => item.canDelete)).toEqual([false, true]);
    expect(ledgerRepository.findReferencedCatalogIds).toHaveBeenCalledWith({
      variationIds: ['21', '22'],
      priceIds: ['price_used', 'price_free']
    });

    const detail = await service.getProduct('10');
    expect(detail.canDelete).toBe(false);
    expect(detail.variants.find((item) => item.id === '22').canDelete).toBe(true);
  });

  test('deleteProduct rejects a linked product before Stripe archive', async () => {
    const repository = {
      getProduct: jest.fn().mockResolvedValue({
        id: '2011',
        stripeProductId: 'prod_live_2011',
        variants: [{ id: '3001', stripePriceId: 'price_used' }]
      }),
      deleteProduct: jest.fn()
    };
    const stripeBilling = { archiveCatalogProduct: jest.fn() };
    const ledgerRepository = {
      findReferencedCatalogIds: jest.fn().mockResolvedValue({
        variationIds: [],
        priceIds: ['price_used']
      })
    };
    const service = new AdminCatalogService({ repository, stripeBilling, ledgerRepository });

    await expect(service.deleteProduct('2011')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'product_in_use' }
    });
    expect(stripeBilling.archiveCatalogProduct).not.toHaveBeenCalled();
    expect(repository.deleteProduct).not.toHaveBeenCalled();
  });

  test('mixed variations block the product and the linked variation only', async () => {
    const product = {
      id: '2011',
      planCountry: 'BR',
      stripeProductId: 'prod_live_2011',
      variants: [
        { id: 'A', stripeProductId: 'prod_live_a', stripePriceId: 'price_a' },
        { id: 'B', stripeProductId: 'prod_live_b', stripePriceId: 'price_b' }
      ]
    };
    const repository = {
      getProduct: jest.fn()
        .mockResolvedValueOnce(product)
        .mockResolvedValueOnce(product)
        .mockResolvedValueOnce({ ...product, variants: [product.variants[0]] })
        .mockResolvedValueOnce(product),
      deleteProduct: jest.fn(),
      deleteVariation: jest.fn().mockResolvedValue(true)
    };
    const stripeBilling = {
      archiveCatalogProduct: jest.fn().mockResolvedValue('prod_live_b')
    };
    const ledgerRepository = {
      findReferencedCatalogIds: jest.fn().mockImplementation(async ({ variationIds }) => ({
        variationIds: variationIds.includes('A') ? ['A'] : [],
        priceIds: []
      }))
    };
    const service = new AdminCatalogService({ repository, stripeBilling, ledgerRepository });

    await expect(service.deleteProduct('2011')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'product_in_use' }
    });
    expect(stripeBilling.archiveCatalogProduct).not.toHaveBeenCalled();
    expect(repository.deleteProduct).not.toHaveBeenCalled();

    const remaining = await service.deleteVariation('2011', 'B');
    expect(stripeBilling.archiveCatalogProduct).toHaveBeenCalledWith('prod_live_b');
    expect(stripeBilling.archiveCatalogProduct).not.toHaveBeenCalledWith('prod_live_a');
    expect(repository.deleteVariation).toHaveBeenCalledWith('2011', 'B');
    expect(remaining.variants.map((item) => item.id)).toEqual(['A']);

    await expect(service.deleteVariation('2011', 'A')).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'variation_in_use' }
    });
  });

  test('deleteVariation archives the variation Stripe product and returns the remaining product', async () => {
    const product = {
      id: '2011',
      stripeProductId: 'prod_parent',
      variants: [{ id: '3001', stripeProductId: 'prod_live_3001' }]
    };
    const repository = {
      getProduct: jest.fn()
        .mockResolvedValueOnce(product)
        .mockResolvedValue({ ...product, variants: [] }),
      deleteVariation: jest.fn().mockResolvedValue(true)
    };
    const stripeBilling = {
      archiveCatalogProduct: jest.fn().mockResolvedValue('prod_live_3001')
    };
    const service = new AdminCatalogService({ repository, stripeBilling });

    const result = await service.deleteVariation('2011', '3001');

    expect(stripeBilling.archiveCatalogProduct).toHaveBeenCalledWith('prod_live_3001');
    expect(stripeBilling.archiveCatalogProduct).not.toHaveBeenCalledWith('prod_parent');
    expect(repository.deleteVariation).toHaveBeenCalledWith('2011', '3001');
    expect(result.variants).toEqual([]);
  });

  test('deleteVariation returns 404 when the variation does not belong to the product', async () => {
    const repository = {
      getProduct: jest.fn().mockResolvedValue({
        id: '2011',
        variants: [{ id: '3001' }]
      })
    };
    const service = new AdminCatalogService({ repository });

    await expect(service.deleteVariation('2011', '9999')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Variation not found.'
    });
  });

  test('skips BR catalog sync when Stripe Brazil creation is disabled', async () => {
    const repository = {
      listProducts: jest.fn().mockResolvedValue({
        items: [{
          id: '100',
          planCountry: 'BR',
          namePt: 'Bowl BR',
          variants: [{ id: '1001', regularPrice: 30, name: 'Beef' }]
        }]
      })
    };
    const stripeAccounts = {
      getForCreation: jest.fn(() => {
        const error = new Error('Stripe Brazil is not enabled.');
        error.statusCode = 503;
        error.details = { code: 'stripe_br_disabled', stripe_account: 'br' };
        throw error;
      })
    };
    const service = new AdminCatalogService({ repository, stripeAccounts });

    const result = await service.sync({ market: 'BR', currency: 'BRL' });

    expect(result.summary.skipped).toEqual([
      { variationId: '1001', reason: 'stripe_br_disabled' }
    ]);
  });

  test('lists products for the actor markets and 404s an out-of-scope product', async () => {
    const repository = {
      listProducts: jest.fn().mockResolvedValue({ total: 0, items: [] }),
      getProduct: jest.fn().mockResolvedValue({ id: '91', planCountry: 'US', variants: [] })
    };
    const service = new AdminCatalogService({ repository });
    const actor = { roles: ['operator'], markets: ['BR'] };

    await service.listProducts({}, { offset: 0, perPage: 20, page: 1 }, actor);

    expect(repository.listProducts).toHaveBeenCalledWith(expect.objectContaining({
      markets: ['BR']
    }));
    await expect(service.getProduct('91', actor)).rejects.toMatchObject({ statusCode: 404 });
  });
});
