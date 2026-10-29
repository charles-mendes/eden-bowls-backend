const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { buildSizeClassSeedRows } = require('../src/core/life-stage-seed');
const { listFallbackCatalogItems } = require('../src/core/plan-catalog-pricing');
const { createCheckoutLockStore } = require('../src/core/checkout-idempotency');
const { ShippingQuoteSigner } = require('../src/core/shipping-quote-token');
const { LifeStageService } = require('../src/services/life-stage.service');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');
const { OnboardingPlanPreviewRepository } = require('../src/infrastructure/repositories/onboarding-plan-preview.repository');
const { OnboardingPlanPreviewService } = require('../src/services/onboarding-plan-preview.service');
const { OnboardingPlanSelectionService } = require('../src/services/onboarding-plan-selection.service');
const { OnboardingSubscriptionCheckoutService } = require('../src/services/onboarding-subscription-checkout.service');

const NOW = new Date('2026-10-19T12:00:00Z');
const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const LINE_BY_KEY = { beef: 'adult', pork: 'adult', fish: 'adult', turkey: 'adult', 'puppy-chicken-pork': 'puppy', 'senior-beef': 'senior' };

function lifeStageService(publishedLines = ['adult', 'puppy', 'senior']) {
  const limits = {};
  for (const row of buildSizeClassSeedRows().filter((item) => item.market === 'US')) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  return new LifeStageService({
    repository: { forMarket: async () => ({ limits, breedClasses: new Map() }) },
    recipeLinesRepository: {
      listRecipeLines: async () => ({
        US: { lineByKey: LINE_BY_KEY, publishedLines: new Set(publishedLines) },
        BR: { lineByKey: LINE_BY_KEY, publishedLines: new Set(publishedLines) }
      })
    },
    now: () => NOW
  });
}

function catalog(market) {
  const base = listFallbackCatalogItems(market);
  return [...base, ...base.filter((item) => item.flavor === 'beef').flatMap((item, index) => [
    { ...item, flavor: 'puppy-chicken-pork', flavor_label: 'Chicken & Pork Recipe for Puppies', aliases: [], variation_id: 9000 + index },
    { ...item, flavor: 'senior-beef', flavor_label: 'Beef Recipe for Senior Dogs', aliases: [], variation_id: 9100 + index }
  ])];
}

function previewRepository(publishedLines) {
  const repository = new OnboardingPlanPreviewRepository({
    recommendationRepository: new OnboardingRecommendationRepository(null, { lifeStageService: lifeStageService(publishedLines) }),
    allowCatalogFallback: true
  });
  repository.loadCatalogItems = jest.fn(async (market) => catalog(market.country));
  return repository;
}

const DOGS = {
  puppy: { pet_id: 'p-puppy', pet_name: 'Mel', size: 'medium', age_months: 5, weight: 6, activity_level: 'medium' },
  puppy2: { pet_id: 'p-puppy2', pet_name: 'Bia', size: 'small', age_months: 4, weight: 3, activity_level: 'medium' },
  adult: { pet_id: 'p-adult', pet_name: 'Tobby', size: 'medium', age_years: 3, weight: 15, activity_level: 'medium' },
  senior: { pet_id: 'p-senior', pet_name: 'Thor', size: 'medium', age_years: 9, weight: 20, activity_level: 'medium' }
};

function petWith(dog, flavors) {
  return { ...dog, enabled: true, selected_flavors: flavors, flavor_weights: flavors.map(() => 2) };
}

function previewApp(publishedLines) {
  const onboardingPlanPreviewService = new OnboardingPlanPreviewService(previewRepository(publishedLines), {
    quotesRepository: { createQuote: jest.fn(async (quote) => ({ id: quote.id })) }
  });
  return createApp({ onboardingPlanPreviewService, corsOrigins, jwt });
}

describe('plan preview refuses recipes outside the pet line', () => {
  test('a puppy with an adult recipe is refused with the mismatch body', async () => {
    const response = await request(previewApp()).post('/api/v1/onboarding/plan/preview?country=US')
      .send({ subscription_term_months: 1, pets: [petWith(DOGS.puppy, ['beef'])] });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.details).toEqual({
      code: 'recipe_life_stage_mismatch',
      pets: [{ pet_id: 'p-puppy', life_stage: 'puppy', allowed_life_stages: ['puppy'], rejected_flavors: ['beef'] }]
    });
  });

  test('a senior with an adult recipe is refused', async () => {
    const response = await request(previewApp()).post('/api/v1/onboarding/plan/preview?country=US')
      .send({ subscription_term_months: 1, pets: [petWith(DOGS.senior, ['beef'])] });

    expect(response.status).toBe(422);
    expect(response.body.details.pets[0]).toMatchObject({ pet_id: 'p-senior', allowed_life_stages: ['senior'], rejected_flavors: ['beef'] });
  });

  test('one pet mixing a puppy and a senior recipe is refused', async () => {
    const response = await request(previewApp()).post('/api/v1/onboarding/plan/preview?country=US')
      .send({ subscription_term_months: 1, pets: [petWith(DOGS.puppy, ['puppy-chicken-pork', 'senior-beef'])] });

    expect(response.status).toBe(422);
    expect(response.body.details.pets[0].rejected_flavors).toEqual(['senior-beef']);
  });

  test('a puppy with an adult recipe is accepted before puppy recipes are published', async () => {
    const response = await request(previewApp(['adult'])).post('/api/v1/onboarding/plan/preview?country=US')
      .send({ subscription_term_months: 1, pets: [petWith(DOGS.puppy, ['beef'])] });

    expect(response.status).toBe(200);
  });
});

describe('plan selection refuses recipes outside the pet line', () => {
  test('returns the mismatch body and saves nothing', async () => {
    const repository = { setPlanSelection: jest.fn() };
    const onboardingPlanSelectionService = new OnboardingPlanSelectionService(repository, { planPreviewRepository: previewRepository() });
    const app = createApp({ onboardingPlanSelectionService, corsOrigins, jwt });
    const token = issueJwtToken({ data: { user: { id: 7 } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });

    const response = await request(app).post('/api/v1/onboarding/plan-selection?country=US').set('Authorization', `Bearer ${token}`)
      .send({ subscription_term_months: 1, pets: [petWith(DOGS.senior, ['beef'])] });

    expect(response.status).toBe(422);
    expect(response.body.details).toMatchObject({ code: 'recipe_life_stage_mismatch', pets: [{ pet_id: 'p-senior' }] });
    expect(repository.setPlanSelection).not.toHaveBeenCalled();
  });
});

describe('subscription checkout checks the saved plan', () => {
  const signer = new ShippingQuoteSigner({ secret: 'test-shipping-quote-secret' });
  const address = { country: 'US', zipcode: '94105', state: 'CA', city: 'San Francisco' };
  const shipping = { rate_id: 'fixed_us:default', cost: 12.9, delivery_days: 1 };

  function checkoutFor(planPets, publishedLines) {
    const context = {
      pets: planPets.map((pet) => ({ id: pet.pet_id })),
      planSelection: {
        subscription_term_months: 1,
        pets: planPets,
        catalog_pricing: { subtotal: 40, currency: 'usd', line_items: [{ stripe_price_id: 'price_abc', quantity: 1 }] }
      },
      address,
      shipping: { ...shipping, quote_token: signer.sign({ country: 'US', zipcode: '94105', cost: 12.9, deliveryDays: 1 }) },
      recurrence: { subscription_term_months: 1 },
      checkoutReference: null
    };
    const repository = {
      checkout: jest.fn().mockImplementation(async (_userId, body) => body.checkout),
      getCheckoutContext: jest.fn().mockResolvedValue(context),
      resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
      getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
    };
    const stripeBilling = {
      automaticTaxEnabled: true,
      createOnboardingSubscription: jest.fn().mockResolvedValue({
        customerId: 'cus_1',
        subscription: { id: 'sub_123', status: 'incomplete' },
        checkout: { order_id: 0, payment_state: 'requires_confirmation', stripe_client_secret: 's', stripe_subscription_id: 'sub_123', status: 'incomplete' }
      }),
      retrievePaymentIntent: jest.fn(),
      resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation')
    };
    const service = new OnboardingSubscriptionCheckoutService(repository, {
      authService: { assertCriticalOperationAllowed: jest.fn().mockResolvedValue({ id: 7 }) },
      discountEligibilityRepository: { getEligibility: jest.fn().mockResolvedValue({ validated: true, eligible: false }) },
      stripeCouponService: { resolveFirstPurchasePromotionForCheckout: jest.fn().mockResolvedValue(null) },
      stripeBilling,
      customerStore: { getCustomerId: jest.fn().mockResolvedValue(''), saveCustomerId: jest.fn() },
      lockStore: createCheckoutLockStore(),
      petsSyncRepository: { syncPets: jest.fn().mockResolvedValue({ pets: [] }) },
      privacyService: { recordCheckoutConsents: jest.fn().mockResolvedValue(undefined) },
      shippingQuoteSigner: signer,
      lifeStageService: lifeStageService(publishedLines),
      petsRepository: { listPets: jest.fn().mockResolvedValue({ pets: planPets.map((pet) => ({ ...pet, id: pet.pet_id })) }) }
    });
    return { service, stripeBilling, repository };
  }

  const payload = { paymentMethodId: 'pm_123', billing: { first_name: 'Jane', last_name: 'Doe' }, legal_consent: { accepted: true } };

  test('a puppy with an adult recipe is refused and no subscription is created', async () => {
    const { service, stripeBilling, repository } = checkoutFor([petWith(DOGS.puppy, ['beef'])]);

    await expect(service.checkout({ userId: 7, payload })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'recipe_life_stage_mismatch', pets: [{ pet_id: 'p-puppy', rejected_flavors: ['beef'] }] }
    });
    expect(stripeBilling.createOnboardingSubscription).not.toHaveBeenCalled();
    expect(repository.checkout).not.toHaveBeenCalled();
  });

  test('a puppy and an adult, each in its line, are accepted in one checkout', async () => {
    const { service, stripeBilling } = checkoutFor([petWith(DOGS.puppy, ['puppy-chicken-pork']), petWith(DOGS.adult, ['beef'])]);

    await service.checkout({ userId: 7, payload });

    expect(stripeBilling.createOnboardingSubscription).toHaveBeenCalledTimes(1);
  });

  test('only the wrong puppy of two is listed', async () => {
    const { service } = checkoutFor([petWith(DOGS.puppy, ['puppy-chicken-pork']), petWith(DOGS.puppy2, ['beef'])]);

    await expect(service.checkout({ userId: 7, payload })).rejects.toMatchObject({
      details: { pets: [{ pet_id: 'p-puppy2', life_stage: 'puppy', allowed_life_stages: ['puppy'], rejected_flavors: ['beef'] }] }
    });
  });

  test('a puppy with an adult recipe is accepted before puppy recipes are published', async () => {
    const { service, stripeBilling } = checkoutFor([petWith(DOGS.puppy, ['beef'])], ['adult']);

    await service.checkout({ userId: 7, payload });

    expect(stripeBilling.createOnboardingSubscription).toHaveBeenCalledTimes(1);
  });
});
