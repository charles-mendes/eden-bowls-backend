const { HttpError } = require('../src/core/http-error');
const { MARKETS } = require('../src/core/market');
const { OnboardingPlanPreviewRepository } = require('../src/infrastructure/repositories/onboarding-plan-preview.repository');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');

function anonymousPayload(overrides = {}) {
  return {
    subscription_term_months: 1,
    pets: [{
      pet_id: 'pet-1',
      pet_name: 'Luna',
      enabled: true,
      selected_flavors: ['beef'],
      flavor_weights: [8],
      ...overrides
    }]
  };
}

describe('OnboardingPlanPreviewRepository', () => {
  test('prices an anonymous preview with the 300 g fallback pack', async () => {
    const repository = new OnboardingPlanPreviewRepository();
    const resolved = await repository.previewPlan(null, anonymousPayload(), MARKETS.BR);

    expect(resolved.country).toBe('BR');
    expect(resolved.currency).toBe('BRL');
    expect(resolved.catalog_pricing.subtotal).toBe(200);
    expect(resolved.catalog_pricing.discounted_first_month_total).toBe(200);
    expect(resolved.catalog_pricing.line_items[0]).toMatchObject({
      pet_id: 'pet-1',
      pet_name: 'Luna',
      flavor: 'beef',
      quantity: 8,
      pack_size_grams: 300,
      pack_size_label: '300 g',
      unit_price: 25,
      line_total: 200
    });
  });

  test('uses the recommended 500 g pack when a JWT pet matches', async () => {
    const repository = new OnboardingPlanPreviewRepository({
      recommendationRepository: {
        getRecommendation: jest.fn().mockResolvedValue({
          version: 'v1',
          simplified: {
            pets: [{ pet_id: 'pet-1', pet_name: 'Luna', packs: { pack_size_grams: 500 } }]
          }
        })
      }
    });

    const resolved = await repository.previewPlan(7, anonymousPayload(), MARKETS.BR);

    expect(resolved.catalog_pricing.subtotal).toBe(360);
    expect(resolved.catalog_pricing.line_items[0]).toMatchObject({
      pack_size_grams: 500,
      pack_size_label: '500 g',
      unit_price: 45,
      line_total: 360
    });
    expect(resolved.validated_with.recommendation_version).toBe('v1');
  });

  test('uses recommended pack size for anonymous pets that include a nutritional profile', async () => {
    const repository = new OnboardingPlanPreviewRepository({
      recommendationRepository: new OnboardingRecommendationRepository()
    });

    const resolved = await repository.previewPlan(null, {
      subscription_term_months: 1,
      pets: [{
        pet_id: 'local-luna',
        pet_name: 'luna',
        enabled: true,
        selected_flavors: ['fish'],
        flavor_weights: [2],
        weight: 13,
        weight_unit: 'kg',
        activity_level: 'high',
        pet_condition: 'overweight',
        neutered: false
      }]
    }, MARKETS.BR);

    expect(resolved.pets[0]).toMatchObject({
      pet_id: 'local-luna',
      pet_name: 'luna'
    });
    expect(resolved.catalog_pricing.line_items[0].pack_size_grams).toBeGreaterThan(0);
    expect(resolved.validated_with.recommendation_version).toBe('v1');
  });

  test('does not apply a subscription-term discount', async () => {
    const repository = new OnboardingPlanPreviewRepository();
    const resolved = await repository.previewPlan(null, {
      ...anonymousPayload(),
      subscription_term_months: 6
    }, MARKETS.BR);

    expect(resolved.subscription_term_months).toBe(6);
    expect(resolved.catalog_pricing.subtotal).toBe(200);
    expect(resolved.catalog_pricing.discounted_first_month_total).toBe(200);
  });

  test('prices United States 300 g targets from the 10.6 oz variation', async () => {
    const repository = new OnboardingPlanPreviewRepository();
    const resolved = await repository.previewPlan(null, anonymousPayload(), MARKETS.US);

    expect(resolved.currency).toBe('USD');
    expect(resolved.catalog_pricing.line_items[0]).toMatchObject({
      pack_size_label: '10.6 oz',
      unit_price: 25,
      line_total: 200
    });
  });

  test('uses the products catalog when flavors are available', async () => {
    const productsRepository = {
      listByCategory: jest.fn().mockResolvedValue({
        products: [{
          product_id: 100,
          tags: [{ slug: 'beef' }],
          variations: [
            { variation_id: 9, flavor: 'Beef', weight: '300g', price: 25, currency: 'BRL' }
          ]
        }]
      })
    };
    const repository = new OnboardingPlanPreviewRepository({ productsRepository });
    const resolved = await repository.previewPlan(null, anonymousPayload(), MARKETS.BR);

    expect(productsRepository.listByCategory).toHaveBeenCalledWith({
      categorySlug: 'flavors',
      country: 'BR',
      currency: 'BRL'
    });
    expect(resolved.catalog_pricing.line_items[0].variation_id).toBe(9);
    expect(resolved.catalog_pricing.subtotal).toBe(200);
  });

  test('falls back to the local catalog when the database catalog is not initialized', async () => {
    const productsRepository = {
      listByCategory: jest.fn().mockRejectedValue(new HttpError(503, 'missing', { code: 'catalog_not_initialized' }))
    };
    const repository = new OnboardingPlanPreviewRepository({ productsRepository });
    const resolved = await repository.previewPlan(null, anonymousPayload(), MARKETS.BR);

    expect(resolved.catalog_pricing.subtotal).toBe(200);
  });

  test('returns catalog_pricing_unavailable when the flavors category is missing', async () => {
    const repository = new OnboardingPlanPreviewRepository({
      productsRepository: {
        listByCategory: jest.fn().mockRejectedValue(new HttpError(404, 'not found', { code: 'category_not_found' }))
      }
    });

    await expect(repository.previewPlan(null, anonymousPayload(), MARKETS.BR)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'catalog_pricing_unavailable' }
    });
  });

  test('rejects a JWT preview when the pet is not in the recommendation', async () => {
    const repository = new OnboardingPlanPreviewRepository({
      recommendationRepository: {
        getRecommendation: jest.fn().mockResolvedValue({ simplified: { pets: [] }, version: 'v1' })
      }
    });

    await expect(repository.previewPlan(7, anonymousPayload(), MARKETS.US)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'plan_selection_snapshot_mismatch' }
    });
  });

  test('rejects duplicate flavor slugs that desync the weight list', async () => {
    const repository = new OnboardingPlanPreviewRepository();

    await expect(repository.previewPlan(null, {
      subscription_term_months: 1,
      pets: [{
        pet_id: 'pet-1',
        pet_name: 'Luna',
        enabled: true,
        selected_flavors: ['beef', 'beef'],
        flavor_weights: [4, 4]
      }]
    }, MARKETS.BR)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'plan_selection_snapshot_mismatch' }
    });
  });
});
