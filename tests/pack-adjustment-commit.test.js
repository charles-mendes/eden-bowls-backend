const { SubscriptionsEditCommitRepository } = require('../src/infrastructure/repositories/subscriptions-edit-commit.repository');
const { SubscriptionsEditCommitService } = require('../src/services/subscriptions-edit-commit.service');
const { OnboardingPlanPreviewRepository } = require('../src/infrastructure/repositories/onboarding-plan-preview.repository');
const { buildCurrentHash } = require('../src/core/subscription-edit-hash');
const { HttpError } = require('../src/core/http-error');

// Milo eats beef and turkey; Bento eats turkey. Stripe keeps one turkey item for both pets.
const STRIPE_ITEMS = [
  { id: 'si_beef', price: 'price_beef', quantity: 3 },
  { id: 'si_turkey', price: 'price_turkey', quantity: 7 }
];
const LEDGER_ROW = {
  userId: 7,
  stripeSubscriptionId: 'sub_123',
  stripeCustomerId: 'cus_1',
  stripeAccount: 'us',
  status: 'active',
  subscriptionTermMonths: 3,
  address: { country: 'US', postal_code: '94105' },
  shipping: { cost: 12.9 },
  planSelection: {
    catalog_pricing: { subtotal: 232.5 },
    flavors_by_pet: [
      { pet_id: 'pet_1', pet_name: 'Milo', flavors: { beef: 3, turkey: 3 } },
      { pet_id: 'pet_2', pet_name: 'Bento', flavors: { turkey: 4 } }
    ]
  }
};
const HASH = buildCurrentHash({
  items: STRIPE_ITEMS.map((item) => ({ price: item.price, quantity: item.quantity })),
  termMonths: 3,
  address: LEDGER_ROW.address,
  shipping: LEDGER_ROW.shipping
});

function build({ guard } = {}) {
  const stripeBilling = {
    retrieveSubscription: jest.fn().mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      default_payment_method: { id: 'pm_123' },
      items: { data: STRIPE_ITEMS.map((item) => ({ id: item.id, price: { id: item.price }, quantity: item.quantity })) },
      metadata: {}
    }),
    previewProration: jest.fn().mockResolvedValue({ amount_due: 4000, total: 4000, currency: 'usd' }),
    updateSubscriptionItems: jest.fn().mockResolvedValue({ latest_invoice: {}, default_payment_method: { id: 'pm_123' } }),
    resolvePaymentState: jest.fn().mockReturnValue('paid')
  };
  const ledgerRepository = {
    findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(LEDGER_ROW),
    listByUserId: jest.fn().mockResolvedValue([LEDGER_ROW]),
    upsert: jest.fn().mockResolvedValue(LEDGER_ROW)
  };
  const repository = new SubscriptionsEditCommitRepository({
    ledgerRepository,
    stripeBilling,
    planPreviewRepository: new OnboardingPlanPreviewRepository({
      allowCatalogFallback: true,
      recommendationRepository: {
        getRecommendation: jest.fn().mockResolvedValue({
          simplified: { pets: [
            { pet_id: 'pet_1', pet_name: 'Milo', packs: { count: 6, pack_size_grams: 300 } },
            { pet_id: 'pet_2', pet_name: 'Bento', packs: { count: 4, pack_size_grams: 300 } }
          ] }
        })
      }
    }),
    resolveSubscriptionItems: async (selection) => selection.catalog_pricing.line_items.map((line) => ({
      price: `price_${line.flavor}`,
      quantity: line.quantity
    }))
  });
  const deliveryGuard = guard || {
    loadSubscription: jest.fn().mockResolvedValue({ id: 'sub_123' }),
    commitPacks: jest.fn().mockResolvedValue({})
  };
  const service = new SubscriptionsEditCommitService(repository, {
    authService: { assertCriticalOperationAllowed: jest.fn().mockResolvedValue(undefined) },
    ledgerRepository,
    deliveryGuard
  });
  return { service, stripeBilling, deliveryGuard };
}

function miloPacks(beef, turkey, overrides = {}) {
  return {
    subscription_term_months: 3,
    delivery_id: 'current',
    expected_current_hash: HASH,
    pets: [{ pet_id: 'pet_1', pet_name: 'Milo', enabled: true, selected_flavors: ['beef', 'turkey'], flavor_weights: [beef, turkey] }],
    ...overrides
  };
}

describe('pack adjustment commit (4.3)', () => {
  const previousRuntime = process.env.EDEN_RUNTIME;
  beforeAll(() => { process.env.EDEN_RUNTIME = 'qa'; });
  afterAll(() => {
    if (previousRuntime === undefined) delete process.env.EDEN_RUNTIME;
    else process.env.EDEN_RUNTIME = previousRuntime;
  });

  test('updates the Stripe items with no proration so nothing is charged now', async () => {
    const { service, stripeBilling } = build();
    const result = await service.commit({ subscriptionId: 'sub_123', userId: 7, payload: miloPacks(4, 4) });

    expect(stripeBilling.previewProration).not.toHaveBeenCalled();
    expect(stripeBilling.updateSubscriptionItems).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_123',
      prorationBehavior: 'none',
      items: [
        { id: 'si_beef', price: 'price_beef', quantity: 4 },
        { id: 'si_turkey', price: 'price_turkey', quantity: 8 }
      ]
    }));
    expect(result.data.proration).toMatchObject({ direction: 'none', amount_due_now: 0 });
    expect(result.data.edit_payment_pending).toBe(false);
  });

  test("setting one pet's shared recipe to zero leaves the other pet's quantity on that price", async () => {
    const { service, stripeBilling } = build();
    await service.commit({ subscriptionId: 'sub_123', userId: 7, payload: miloPacks(6, 0) });

    const { items } = stripeBilling.updateSubscriptionItems.mock.calls[0][0];
    expect(items).toEqual([
      { id: 'si_beef', price: 'price_beef', quantity: 6 },
      { id: 'si_turkey', price: 'price_turkey', quantity: 4 }
    ]);
  });

  test('deletes an item only when no pet still uses the recipe', async () => {
    const { service, stripeBilling } = build();
    await service.commit({ subscriptionId: 'sub_123', userId: 7, payload: miloPacks(0, 6) });

    const { items } = stripeBilling.updateSubscriptionItems.mock.calls[0][0];
    expect(items).toEqual([
      { id: 'si_beef', deleted: true },
      { id: 'si_turkey', price: 'price_turkey', quantity: 10 }
    ]);
  });

  test('a stale preview hash is rejected', async () => {
    const { service, stripeBilling } = build();
    await expect(service.commit({
      subscriptionId: 'sub_123',
      userId: 7,
      payload: miloPacks(4, 4, { expected_current_hash: 'stale' })
    })).rejects.toMatchObject({ statusCode: 409, details: { code: 'subscription_state_changed' } });
    expect(stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
  });

  test('a locked delivery is not written', async () => {
    const guard = {
      loadSubscription: jest.fn().mockResolvedValue({ id: 'sub_123' }),
      commitPacks: jest.fn().mockRejectedValue(new HttpError(409, 'This delivery can no longer be changed.', { code: 'delivery_locked' }))
    };
    const { service, stripeBilling } = build({ guard });
    await expect(service.commit({ subscriptionId: 'sub_123', userId: 7, payload: miloPacks(4, 4) }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'delivery_locked' } });
    expect(guard.commitPacks).toHaveBeenCalledWith({ id: 'sub_123' }, 7, { deliveryId: 'current' });
    expect(stripeBilling.retrieveSubscription).not.toHaveBeenCalled();
    expect(stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
  });

  test('an all-zero split is rejected', async () => {
    const { service, stripeBilling, deliveryGuard } = build();
    await expect(service.commit({ subscriptionId: 'sub_123', userId: 7, payload: miloPacks(0, 0) }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'no_packs' } });
    expect(deliveryGuard.commitPacks).not.toHaveBeenCalled();
    expect(stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
  });

  test('a pack save cannot change the term or the address', async () => {
    const { service, stripeBilling } = build();
    await expect(service.commit({ subscriptionId: 'sub_123', userId: 7, payload: miloPacks(4, 4, { subscription_term_months: 6 }) }))
      .rejects.toMatchObject({ details: { code: 'term_change_not_allowed' } });
    await expect(service.commit({ subscriptionId: 'sub_123', userId: 7, payload: miloPacks(4, 4, { address: { country: 'US' } }) }))
      .rejects.toMatchObject({ details: { code: 'address_change_not_allowed' } });
    expect(stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
  });
});
