const { AdminCatalogService } = require('../src/services/admin-catalog.service');

const actor = { userId: '7', email: 'ops@edenbowls.com' };

function variant(overrides = {}) {
  return {
    id: '3001',
    name: 'Senior Beef 300g',
    active: false,
    regularPrice: 40,
    stripePriceId: null,
    stripePriceIdsByCurrency: { brl: 'price_senior_beef_300' },
    finalImageReady: true,
    labelDataReady: false,
    ...overrides
  };
}

function serviceFor({ product, activeCount = 0 }) {
  const state = { product };
  const repository = {
    getProduct: jest.fn(async () => state.product),
    updatePostStatus: jest.fn(),
    upsertPostMeta: jest.fn(),
    createVariation: jest.fn().mockResolvedValue('3002'),
    updateVariation: jest.fn()
  };
  const ledgerRepository = {
    findReferencedCatalogIds: jest.fn().mockResolvedValue({ variationIds: [], priceIds: [] }),
    countActiveSubscriptionsForCatalog: jest.fn().mockResolvedValue(activeCount)
  };
  const auditService = { record: jest.fn() };
  const service = new AdminCatalogService({ repository, ledgerRepository, auditService });
  service.sync = jest.fn();
  return { service, repository, ledgerRepository, auditService };
}

function published(country, variants) {
  return { id: '100', active: true, planCountry: country, planDays: 30, variants };
}

describe('AdminCatalogService.setVariationActive', () => {
  test('activates a ready BR variation without label data and audits it', async () => {
    const { service, repository, auditService } = serviceFor({ product: published('BR', [variant()]) });

    await service.setVariationActive('100', '3001', true, actor);

    expect(service.sync).toHaveBeenCalledWith({ productId: '100', market: 'BR', currency: 'BRL' });
    expect(repository.updatePostStatus).toHaveBeenCalledWith('3001', 'publish');
    expect(auditService.record).toHaveBeenCalledWith({
      actor,
      action: 'catalog.variation.activate',
      metadata: { productId: '100', variationId: '3001', market: 'BR' }
    });
  });

  test('refuses a US variation listing every missing item, and keeps it inactive', async () => {
    const { service, repository, auditService } = serviceFor({
      product: published('US', [variant({ stripePriceIdsByCurrency: {}, finalImageReady: false, labelDataReady: false })])
    });

    await expect(service.setVariationActive('100', '3001', true, actor)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'recipe_publish_refused', missing: ['stripe_price', 'final_image', 'label_data'] }
    });
    expect(repository.updatePostStatus).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  test('refuses a variation without a price', async () => {
    const { service } = serviceFor({ product: published('BR', [variant({ regularPrice: null })]) });

    await expect(service.setVariationActive('100', '3001', true, actor)).rejects.toMatchObject({
      details: { code: 'recipe_publish_refused', missing: ['price'] }
    });
  });

  test('refuses to deactivate a variation used by three active subscriptions', async () => {
    const { service, repository, ledgerRepository } = serviceFor({
      product: published('BR', [variant({ id: '1001', active: true })]),
      activeCount: 3
    });

    await expect(service.setVariationActive('100', '1001', false, actor)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Variation is used by 3 active subscriptions and cannot be deactivated.',
      details: { code: 'variation_in_active_subscriptions', activeSubscriptions: 3 }
    });
    expect(ledgerRepository.countActiveSubscriptionsForCatalog).toHaveBeenCalledWith({
      variationIds: ['1001'],
      priceIds: ['price_senior_beef_300']
    });
    expect(repository.updatePostStatus).not.toHaveBeenCalled();
  });

  test('names one active subscription in the singular', async () => {
    const { service } = serviceFor({ product: published('BR', [variant({ active: true })]), activeCount: 1 });

    await expect(service.setVariationActive('100', '3001', false, actor)).rejects.toMatchObject({
      message: 'Variation is used by 1 active subscription and cannot be deactivated.'
    });
  });

  test('deactivates a variation no active subscription uses and audits it', async () => {
    const { service, repository, auditService } = serviceFor({ product: published('BR', [variant({ active: true })]) });

    await service.setVariationActive('100', '3001', false, actor);

    expect(repository.updatePostStatus).toHaveBeenCalledWith('3001', 'draft');
    expect(auditService.record.mock.calls[0][0].action).toBe('catalog.variation.deactivate');
  });

  test('rejects a missing active flag and an unknown variation', async () => {
    const { service } = serviceFor({ product: published('BR', [variant()]) });

    await expect(service.setVariationActive('100', '3001', 'yes', actor)).rejects.toMatchObject({ statusCode: 422 });
    await expect(service.setVariationActive('100', '9999', true, actor)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('AdminCatalogService variations of a published product', () => {
  test('refuses to edit an active variation and writes nothing', async () => {
    const { service, repository } = serviceFor({ product: published('BR', [variant({ id: '1001', active: true, regularPrice: 25 })]) });

    await expect(service.patchProduct('100', {
      variants: [{ id: '1001', name: 'Beef 300g', regularPrice: 30 }]
    }, actor)).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'variation_active_locked', variationIds: ['1001'] }
    });
    expect(repository.updateVariation).not.toHaveBeenCalled();
    expect(repository.createVariation).not.toHaveBeenCalled();
  });

  test('saves an inactive variation and a new one, and audits flag changes only', async () => {
    const { service, repository, auditService } = serviceFor({
      product: published('US', [variant({ finalImageReady: false })])
    });

    await service.patchProduct('100', {
      variants: [
        { id: '3001', regularPrice: 45, finalImageReady: true, labelDataReady: false },
        { name: 'Senior Chicken 300g', sku: 'SENIOR-CHICKEN-300', lifeStage: 'senior', finalImageReady: false, labelDataReady: true }
      ]
    }, actor);

    expect(repository.updateVariation.mock.calls[0][0]).toMatchObject({ id: '3001', regularPrice: 45, finalImageReady: true, labelDataReady: false });
    expect(repository.createVariation.mock.calls[0][0]).toMatchObject({ lifeStage: 'senior', labelDataReady: true });
    const flagEvents = auditService.record.mock.calls.map(([event]) => [event.action, event.metadata.variationId, event.metadata.flag, event.metadata.to]);
    expect(flagEvents).toEqual([
      ['catalog.variation.flag', '3001', 'finalImageReady', true],
      ['catalog.variation.flag', '3002', 'labelDataReady', true]
    ]);
  });
});
