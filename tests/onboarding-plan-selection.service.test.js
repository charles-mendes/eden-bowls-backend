const { MARKETS } = require('../src/core/market');
const { OnboardingPlanSelectionService } = require('../src/services/onboarding-plan-selection.service');

const payload = {
  subscription_term_months: 1,
  pets: [{
    pet_id: 'pet-1',
    pet_name: 'Luna',
    enabled: true,
    selected_flavors: ['chicken'],
    flavor_weights: [8]
  }]
};

const resolvedPlan = {
  subscription_term_months: 1,
  country: 'BR',
  currency: 'BRL',
  catalog_pricing: {
    currency: 'BRL',
    subtotal: 80,
    discounted_first_month_total: 80,
    line_items: [{
      pet_id: 'pet-1',
      flavor: 'chicken',
      quantity: 8,
      variation_id: 9,
      unit_price: 10,
      line_total: 80
    }]
  },
  flavors_by_pet: [{ pet_id: 'pet-1', flavors: { chicken: 8 } }],
  pets: [{ pet_id: 'pet-1', pet_name: 'Luna', enabled: true, selected_flavors: ['chicken'] }]
};

describe('OnboardingPlanSelectionService', () => {
  test('echoes the payload without persisting when the user is anonymous', async () => {
    const repository = { setPlanSelection: jest.fn() };
    const service = new OnboardingPlanSelectionService(repository, {
      planPreviewRepository: { previewPlan: jest.fn() }
    });

    const result = await service.setPlanSelection({
      userId: null,
      payload,
      market: MARKETS.BR
    });

    expect(result.success).toBe(true);
    expect(result.data.plan_selection).toEqual(expect.objectContaining({
      subscription_term_months: 1,
      country: 'BR',
      currency: 'BRL'
    }));
    expect(repository.setPlanSelection).not.toHaveBeenCalled();
  });

  test('resolves catalog pricing before persisting an authenticated plan selection', async () => {
    const repository = {
      setPlanSelection: jest.fn().mockImplementation(async (_userId, planSelection) => ({
        plan_selection: planSelection
      }))
    };
    const planPreviewRepository = {
      previewPlan: jest.fn().mockResolvedValue(resolvedPlan)
    };
    const service = new OnboardingPlanSelectionService(repository, { planPreviewRepository });

    const result = await service.setPlanSelection({
      userId: 7,
      payload,
      market: MARKETS.BR
    });

    expect(planPreviewRepository.previewPlan).toHaveBeenCalledWith(7, payload, MARKETS.BR);
    expect(repository.setPlanSelection).toHaveBeenCalledWith(7, expect.objectContaining({
      pets: payload.pets,
      catalog_pricing: resolvedPlan.catalog_pricing,
      country: 'BR',
      currency: 'BRL'
    }));
    expect(result.data.plan_selection.catalog_pricing.subtotal).toBe(80);
  });

  test('rejects an authenticated payload without an enabled pet', async () => {
    const service = new OnboardingPlanSelectionService(
      { setPlanSelection: jest.fn() },
      { planPreviewRepository: { previewPlan: jest.fn() } }
    );

    await expect(service.setPlanSelection({
      userId: 7,
      payload: { subscription_term_months: 1, pets: [] },
      market: MARKETS.US
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_plan_selection' }
    });
  });
});
