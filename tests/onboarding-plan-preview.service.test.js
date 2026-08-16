const { HttpError } = require('../src/core/http-error');
const { MARKETS } = require('../src/core/market');
const { OnboardingPlanPreviewService } = require('../src/services/onboarding-plan-preview.service');

function validPayload(overrides = {}) {
  return {
    subscription_term_months: 1,
    pets: [{
      pet_id: 'pet-1',
      pet_name: 'Luna',
      enabled: true,
      selected_flavors: ['beef'],
      flavor_weights: [8]
    }],
    ...overrides
  };
}

function resolvedPlan(overrides = {}) {
  return {
    subscription_term_months: 1,
    country: 'BR',
    currency: 'BRL',
    catalog_pricing: {
      currency: 'BRL',
      subtotal: 360,
      discounted_first_month_total: 360,
      line_items: [{
        pet_id: 'pet-1',
        pet_name: 'Luna',
        flavor: 'beef',
        quantity: 8,
        pack_size_grams: 500,
        pack_size_label: '500 g',
        variation_id: 1005,
        product_id: 100,
        currency: 'BRL',
        unit_price: 45,
        line_total: 360
      }]
    },
    ...overrides
  };
}

describe('OnboardingPlanPreviewService', () => {
  test('creates a quote without a user and returns catalog totals', async () => {
    const repository = { previewPlan: jest.fn().mockResolvedValue(resolvedPlan()) };
    const quotesRepository = {
      createQuote: jest.fn().mockImplementation(async (input) => ({ id: input.id }))
    };
    const service = new OnboardingPlanPreviewService(repository, { quotesRepository });

    const result = await service.previewPlan({
      userId: null,
      payload: validPayload(),
      market: MARKETS.BR
    });

    expect(repository.previewPlan).toHaveBeenCalledWith(null, validPayload(), MARKETS.BR);
    expect(quotesRepository.createQuote).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      pricing: expect.objectContaining({
        grand_total: 360,
        grand_total_monthly: 360,
        first_month_total: 360
      })
    }));
    expect(result.success).toBe(true);
    expect(result.data.quote_id).toMatch(/^q_[a-f0-9]+$/);
    expect(result.data.pets[0]).toEqual({
      pet_id: 'pet-1',
      pet_name: 'Luna',
      monthly_total: 360,
      total: 360,
      first_month_total: 360
    });
    expect(result.data.quote_payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('rejects enabled pets without flavors', async () => {
    const repository = { previewPlan: jest.fn() };
    const service = new OnboardingPlanPreviewService(repository, { quotesRepository: { createQuote: jest.fn() } });

    await expect(service.previewPlan({
      payload: validPayload({
        pets: [{ pet_name: 'Luna', enabled: true, selected_flavors: [], flavor_weights: [] }]
      }),
      market: MARKETS.US
    })).rejects.toMatchObject({
      statusCode: 422,
      details: {
        code: 'invalid_plan_preview_payload',
        errors: { 'pets.0.selected_flavors': expect.any(String) }
      }
    });
    expect(repository.previewPlan).not.toHaveBeenCalled();
  });

  test('rejects flavor weights that do not match selected flavors', async () => {
    const service = new OnboardingPlanPreviewService(
      { previewPlan: jest.fn() },
      { quotesRepository: { createQuote: jest.fn() } }
    );

    await expect(service.previewPlan({
      payload: validPayload({
        pets: [{ pet_name: 'Luna', enabled: true, selected_flavors: ['beef'], flavor_weights: [1, 2] }]
      }),
      market: MARKETS.US
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_plan_preview_payload' }
    });
  });

  test('rejects a payload with no enabled pets', async () => {
    const service = new OnboardingPlanPreviewService(
      { previewPlan: jest.fn() },
      { quotesRepository: { createQuote: jest.fn() } }
    );

    await expect(service.previewPlan({
      payload: validPayload({
        pets: [{ pet_name: 'Luna', enabled: false, selected_flavors: ['beef'], flavor_weights: [8] }]
      }),
      market: MARKETS.US
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_plan_selection' }
    });
  });

  test('rejects a second-pass invalid subscription term', async () => {
    const service = new OnboardingPlanPreviewService(
      { previewPlan: jest.fn() },
      { quotesRepository: { createQuote: jest.fn() } }
    );

    await expect(service.previewPlan({
      payload: validPayload({ subscription_term_months: 2 }),
      market: MARKETS.US
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_subscription_term' }
    });
  });

  test('rejects a zero-total contract before creating a quote', async () => {
    const quotesRepository = { createQuote: jest.fn() };
    const service = new OnboardingPlanPreviewService({
      previewPlan: jest.fn().mockResolvedValue(resolvedPlan({
        catalog_pricing: { subtotal: 0, line_items: [] }
      }))
    }, { quotesRepository });

    await expect(service.previewPlan({
      payload: validPayload(),
      market: MARKETS.BR
    })).rejects.toMatchObject({
      statusCode: 502,
      details: { code: 'invalid_plan_preview_contract' }
    });
    expect(quotesRepository.createQuote).not.toHaveBeenCalled();
  });

  test('throws 503 when the quotes repository is missing', async () => {
    const service = new OnboardingPlanPreviewService({ previewPlan: jest.fn() });

    await expect(service.previewPlan({ payload: validPayload(), market: MARKETS.US })).rejects.toBeInstanceOf(HttpError);
    await expect(service.previewPlan({ payload: validPayload(), market: MARKETS.US })).rejects.toMatchObject({
      statusCode: 503
    });
  });
});
