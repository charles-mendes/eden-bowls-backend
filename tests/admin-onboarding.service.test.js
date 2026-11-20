const { AdminOnboardingService } = require('../src/services/admin-onboarding.service');

describe('AdminOnboardingService.getByUserId', () => {
  test('returns pets and subscriptions for a customer who never reached checkout', async () => {
    const service = new AdminOnboardingService({
      repository: {
        getCheckout: jest.fn().mockResolvedValue({
          userId: '91',
          email: 'ana@x.com',
          market: 'BR',
          checkoutReference: null,
          planSelection: null,
          address: null,
          pets: [{ id: '7', name: 'Rex', ageYears: 2, ageMonths: 0, weightInput: 10, weightUnit: 'kg' }]
        })
      },
      ledgerRepository: {
        listByUserId: jest.fn().mockResolvedValue([{ id: 3, stripeSubscriptionId: 'sub_1', stripeAccount: 'br', status: 'active' }])
      }
    });

    const result = await service.getByUserId('91', { roles: ['operator'], markets: ['BR'] });

    expect(result).toMatchObject({
      userId: '91',
      empty: true,
      pets: [{ id: '7', name: 'Rex' }],
      subscriptions: [{ id: '3', stripeSubscriptionId: 'sub_1' }],
      lineItems: []
    });
  });

  test('the checkout detail sizes a puppy with the growth factor of its line, as the store does', async () => {
    const service = new AdminOnboardingService({
      repository: {
        getCheckout: jest.fn().mockResolvedValue({
          userId: '91', market: 'BR', checkoutReference: null, planSelection: null, address: { country: 'BR' },
          pets: [{ id: '7', name: 'Rex', ageYears: 0, ageMonths: 4, weightInput: 2, weightUnit: 'kg', neutered: true }]
        })
      },
      ledgerRepository: { listByUserId: jest.fn().mockResolvedValue([]) },
      lifeStageService: { resolveMany: jest.fn().mockResolvedValue([{ lifeStage: 'puppy' }]) },
      recipeEnergyService: { forLifeStage: jest.fn().mockResolvedValue(1500) }
    });

    const result = await service.getByUserId('91', { roles: ['operator'], markets: ['BR'] });

    // 140 × 2^0,75 = 235 kcal ÷ 1500 kcal/kg = 157 g; the adult matrix (95) would give 107 g.
    expect(result.pets[0].simplified.daily.grams).toBe(157);
  });

    test('checkout-history: one checkout per subscription, newest purchase first, complete or partial', async () => {
    const snapshot = {
      version: 1,
      source: 'checkout',
      captured_at: '2026-11-01T10:00:00.000Z',
      checkout_reference: { stripe_subscription_id: 'sub_new', stripe_promotion_code_id: 'promo_1', total: 99 },
      plan_selection: { catalog_pricing: { line_items: [{ sku: 'A' }] } },
      pets_snapshot: { pet_ids: ['7'] },
      address: { city: 'São Paulo' },
      shipping: { cost: 10 },
      recurrence: { frequency: 'monthly' },
      subscription_term_months: 6
    };
    const service = new AdminOnboardingService({
      repository: {
        getCheckout: jest.fn().mockResolvedValue({
          userId: '91', market: 'BR', checkoutReference: { stripe_subscription_id: 'sub_new' }, planSelection: null, address: null, pets: []
        })
      },
      ledgerRepository: {
        // listByUserId orders by updated_at: the old one was touched by a webhook last.
        listByUserId: jest.fn().mockResolvedValue([
          { id: 1, stripeSubscriptionId: 'sub_old', stripeAccount: 'br', status: 'active', createdAt: '2026-01-05 10:00:00', updatedAt: '2026-11-10 10:00:00', planSelection: { catalog_pricing: { line_items: [{ sku: 'B' }] } }, address: { city: 'Rio' }, checkoutSnapshot: null },
          { id: 2, stripeSubscriptionId: 'sub_new', stripeAccount: 'br', status: 'incomplete', createdAt: '2026-11-01 10:00:00', updatedAt: '2026-11-01 10:00:00', planSelection: { edited: true }, checkoutSnapshot: snapshot }
        ])
      }
    });

    const { checkouts } = await service.getByUserId('91', { roles: ['operator'], markets: ['BR'] });

    expect(checkouts.map((item) => item.stripeSubscriptionId)).toEqual(['sub_new', 'sub_old']);
    expect(checkouts[0]).toMatchObject({
      subscriptionId: '2',
      completeness: 'complete',
      source: 'checkout',
      capturedAt: '2026-11-01T10:00:00.000Z',
      planSelection: snapshot.plan_selection,
      lineItems: [{ sku: 'A' }],
      recurrence: { frequency: 'monthly' },
      subscriptionTermMonths: 6,
      discount: { promotionCodeId: 'promo_1' },
      checkoutReference: snapshot.checkout_reference
    });
    expect(checkouts[1]).toMatchObject({
      subscriptionId: '1',
      completeness: 'partial',
      source: 'ledger',
      lineItems: [{ sku: 'B' }],
      address: { city: 'Rio' },
      recurrence: null,
      discount: null,
      checkoutReference: null
    });
  });

  describe('pets carry the subscriptions that own them', () => {
    const plan = (...ids) => ({ pets: ids.map((id) => ({ pet_id: id, enabled: true })) });

    async function petsFor(rows, actor = { roles: ['operator'], markets: ['BR', 'US'] }) {
      const service = new AdminOnboardingService({
        repository: {
          getCheckout: jest.fn().mockResolvedValue({
            userId: '91',
            market: 'BR',
            checkoutReference: null,
            planSelection: null,
            address: null,
            pets: [
              { id: '7', name: 'Rex', ageYears: 2, ageMonths: 0, weightInput: 10, weightUnit: 'kg' },
              { id: '8', name: 'Luna', ageYears: 3, ageMonths: 0, weightInput: 8, weightUnit: 'kg' }
            ]
          })
        },
        ledgerRepository: { listByUserId: jest.fn().mockResolvedValue(rows) }
      });
      const result = await service.getByUserId('91', actor);
      return Object.fromEntries(result.pets.map((pet) => [pet.name, pet.subscriptions]));
    }

    test('a pet on an active subscription gets that subscription', async () => {
      const pets = await petsFor([
        { id: 3, stripeSubscriptionId: 'sub_1', stripeAccount: 'br', status: 'active', planLabel: 'Plano Rex', planSelection: plan('7') }
      ]);
      expect(pets.Rex).toEqual([{ id: '3', stripeSubscriptionId: 'sub_1', status: 'active', planLabel: 'Plano Rex' }]);
    });

    test('a pet on no subscription, or only on a canceled one, gets none', async () => {
      const pets = await petsFor([
        { id: 3, stripeSubscriptionId: 'sub_1', stripeAccount: 'br', status: 'canceled', planSelection: plan('7', '8') }
      ]);
      expect(pets.Rex).toEqual([]);
      expect(pets.Luna).toEqual([]);
    });

    test('a pet on a paused and an active subscription gets both, newest first', async () => {
      const pets = await petsFor([
        { id: 3, stripeSubscriptionId: 'sub_old', stripeAccount: 'br', status: 'paused', createdAt: '2026-10-01 10:00:00', planSelection: plan('7') },
        { id: 4, stripeSubscriptionId: 'sub_new', stripeAccount: 'br', status: 'active', createdAt: '2026-11-01 10:00:00', planSelection: plan('7') }
      ]);
      expect(pets.Rex.map((item) => [item.stripeSubscriptionId, item.status])).toEqual([['sub_new', 'active'], ['sub_old', 'paused']]);
    });

    test('a subscription of another market is not shown to a Brazil operator', async () => {
      const pets = await petsFor([
        { id: 5, stripeSubscriptionId: 'sub_us', stripeAccount: 'us', status: 'active', planSelection: plan('7') }
      ], { roles: ['operator'], markets: ['BR'] });
      expect(pets.Rex).toEqual([]);
    });
  });

  test('returns 404 for an out-of-scope session', async () => {
    const service = new AdminOnboardingService({
      repository: {
        getCheckout: jest.fn().mockResolvedValue({
          userId: '91',
          market: 'US',
          pets: [],
          address: { country: 'US' }
        })
      }
    });

    await expect(service.getByUserId('91', { roles: ['operator'], markets: ['BR'] })).rejects.toMatchObject({
      statusCode: 404
    });
  });
});
