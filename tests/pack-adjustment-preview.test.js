const { SubscriptionsEditPreviewRepository } = require('../src/infrastructure/repositories/subscriptions-edit-preview.repository');
const { SubscriptionsEditPreviewService } = require('../src/services/subscriptions-edit-preview.service');
const { OnboardingPlanPreviewRepository } = require('../src/infrastructure/repositories/onboarding-plan-preview.repository');
const { buildPackAdjustment } = require('../src/core/pack-adjustment');

// US fallback catalog at 10.6 oz (about 300 g): beef 25.00, turkey (Chicken) 22.50 per pack.
const PACK_GRAMS = 300;

function ledgerRow(overrides = {}) {
  return {
    userId: 7,
    stripeSubscriptionId: 'sub_123',
    stripeAccount: 'us',
    status: 'active',
    subscriptionTermMonths: 3,
    address: { country: 'US', postal_code: '94105' },
    shipping: { cost: 12.9 },
    planSelection: {
      catalog_pricing: { subtotal: 237.5 },
      flavors_by_pet: [{ pet_id: 'pet_1', pet_name: 'Milo', flavors: { beef: 5, turkey: 5 } }]
    },
    ...overrides
  };
}

function buildRepo({ suggested = 10, row = ledgerRow(), prorationAmount = 0 } = {}) {
  const resolveSubscriptionItems = jest.fn(async (selection) => selection.catalog_pricing.line_items.map((line) => ({
    price: `price_${line.flavor}`,
    quantity: line.quantity
  })));
  const stripeBilling = {
    retrieveSubscription: jest.fn().mockResolvedValue({
      id: 'sub_123',
      items: { data: [
        { id: 'si_beef', price: { id: 'price_beef' }, quantity: 5 },
        { id: 'si_turkey', price: { id: 'price_turkey' }, quantity: 5 }
      ] }
    }),
    previewProration: jest.fn().mockResolvedValue({ amount_due: prorationAmount, total: prorationAmount, currency: 'usd' }),
    previewSubscriptionInvoice: jest.fn()
  };
  const planPreviewRepository = new OnboardingPlanPreviewRepository({
    allowCatalogFallback: true,
    recommendationRepository: {
      getRecommendation: jest.fn().mockResolvedValue({
        simplified: { pets: [{ pet_id: 'pet_1', pet_name: 'Milo', packs: { count: suggested, pack_size_grams: PACK_GRAMS } }] }
      })
    }
  });
  const repository = new SubscriptionsEditPreviewRepository({
    ledgerRepository: { findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(row) },
    stripeBilling,
    planPreviewRepository,
    resolveSubscriptionItems
  });
  return { repository, stripeBilling, resolveSubscriptionItems };
}

function packPayload(beef, turkey, overrides = {}) {
  return {
    subscription_term_months: 3,
    delivery_id: 'current',
    pets: [{ pet_id: 'pet_1', pet_name: 'Milo', enabled: true, selected_flavors: ['beef', 'turkey'], flavor_weights: [beef, turkey] }],
    ...overrides
  };
}

describe('pack adjustment preview (4.1)', () => {
  test('8 chosen packs out of 10 suggested returns 80 percent and the designer warning', async () => {
    const { repository } = buildRepo();
    const result = await repository.preview(7, 'sub_123', packPayload(4, 4));

    expect(result.packs.delivery_id).toBe('current');
    expect(result.packs.suggested_count).toBe(10);
    expect(result.packs.chosen_count).toBe(8);
    const [pet] = result.packs.pets;
    expect(pet.suggested_count).toBe(10);
    expect(pet.suggested_split).toEqual({ beef: 5, turkey: 5 });
    // Every catalog recipe is listed with its unit price, including recipes the pet does not eat yet.
    expect(pet.recipes).toEqual(expect.arrayContaining([
      expect.objectContaining({ flavor: 'beef', unit_price: 25, quantity: 4 }),
      expect.objectContaining({ flavor: 'turkey', unit_price: 22.5, quantity: 4 }),
      expect.objectContaining({ flavor: 'fish', unit_price: 35, quantity: 0 }),
      expect.objectContaining({ flavor: 'pork', unit_price: 25, quantity: 0 })
    ]));
    expect(pet.recipes).toHaveLength(4);
    expect(pet.chosen_count).toBe(8);
    expect(pet.portion).toEqual({
      percent: 80,
      warning: 'With 8 packs, Milo gets about 80% of the recommended daily portion. Add other food or go back to 10 packs.'
    });
  });

  test('10 out of 10 omits the warning', async () => {
    const { repository } = buildRepo();
    const result = await repository.preview(7, 'sub_123', packPayload(5, 5));
    expect(result.packs.pets[0].portion).toEqual({ percent: 100, warning: null });
  });

  test('totals are merchandise only, without shipping, and nothing is charged now', async () => {
    const { repository, stripeBilling } = buildRepo({ prorationAmount: 5000 });
    const result = await repository.preview(7, 'sub_123', packPayload(4, 4));

    expect(result.packs.previous_merchandise_total).toBe(237.5);
    expect(result.packs.new_merchandise_total).toBe(190);
    expect(result.packs.shipping_included).toBe(false);
    expect(result.next_cycle.subtotal).toBe(190);
    expect(stripeBilling.previewSubscriptionInvoice).not.toHaveBeenCalled();
    expect(stripeBilling.previewProration).toHaveBeenCalledWith(expect.objectContaining({ prorationBehavior: 'none' }));
    expect(result.proration).toEqual({ direction: 'none', amount_due_now: 0, credit_applied: 0, currency: 'USD' });
  });

  test('a zero quantity is not priced as one pack', async () => {
    const { repository, resolveSubscriptionItems } = buildRepo();
    const result = await repository.preview(7, 'sub_123', packPayload(0, 8));

    expect(result.packs.new_merchandise_total).toBe(180);
    expect(result.packs.chosen_count).toBe(8);
    const items = await resolveSubscriptionItems.mock.results[0].value;
    expect(items).toEqual([{ price: 'price_turkey', quantity: 8 }]);
    expect(result.proposed.items).toEqual([{ price: 'price_turkey', quantity: 8 }]);
  });

  test('a preview whose quantities are all zero is rejected', async () => {
    const { repository } = buildRepo();
    const service = new SubscriptionsEditPreviewService(repository);
    await expect(service.preview({ subscriptionId: 'sub_123', userId: 7, payload: packPayload(0, 0) }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'no_packs' } });
  });

  test('a pack preview cannot change the term', async () => {
    const { repository } = buildRepo();
    await expect(repository.preview(7, 'sub_123', packPayload(5, 5, { subscription_term_months: 6 })))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'term_change_not_allowed' } });
  });

  test('without a suggestion there is no portion object', async () => {
    const result = buildPackAdjustment({
      deliveryId: 'current',
      resolved: {
        pets: [{ pet_id: 'pet_1', pet_name: 'Milo', suggested_packs: null }],
        catalog_pricing: { subtotal: 90, line_items: [{ pet_id: 'pet_1', quantity: 4 }] }
      },
      currency: 'usd'
    });
    expect(result.pets[0].portion).toBeNull();
    expect(result.suggested_count).toBeNull();
    expect(result.previous_merchandise_total).toBeNull();
  });

  test('the Brazilian account gets the Portuguese warning', () => {
    const result = buildPackAdjustment({
      deliveryId: 'current',
      resolved: {
        pets: [{ pet_id: 'pet_1', pet_name: 'Milo', suggested_packs: 10 }],
        catalog_pricing: { subtotal: 300, line_items: [{ pet_id: 'pet_1', quantity: 8 }] }
      },
      language: 'pt',
      currency: 'brl'
    });
    expect(result.pets[0].portion.warning).toBe(
      'Com 8 packs, Milo recebe cerca de 80% da porção diária sugerida. Complete com outro alimento ou volte para 10 packs.'
    );
  });
});
