const { MARKETS } = require('../src/core/market');
const { OnboardingPlanSnapshotRepository } = require('../src/infrastructure/repositories/onboarding-plan-snapshot.repository');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');

describe('OnboardingPlanSnapshotRepository', () => {
  test('reuses recommendation consumption for the snapshot pets', async () => {
    const petsRepository = {
      listPets: jest.fn().mockResolvedValue({
        pets: [
          {
            id: 'pet-1',
            name: 'Luna',
            weight_input: 10,
            weight_unit: 'kg',
            activity_level: 'medium',
            pet_condition: 'ideal',
            neutered: true
          }
        ]
      })
    };
    const repository = new OnboardingPlanSnapshotRepository({
      recommendationRepository: new OnboardingRecommendationRepository(petsRepository)
    });

    const data = await repository.getSnapshot(7, MARKETS.BR);

    expect(data.country).toBe('BR');
    expect(data.currency).toBe('BRL');
    expect(data.labels.daily).toBe('Diário');
    expect(data.pets).toHaveLength(1);
    expect(data.consumption.pets[0].pet_name).toBe('Luna');
    expect(data.consumption.pets[0].daily.grams).toBeGreaterThan(0);
    expect(data.pets).toEqual(data.consumption.pets);
    expect(data.plan_terms).toEqual([
      { subscription_term_months: 1, discount_percent: 10 },
      { subscription_term_months: 3, discount_percent: 25 },
      { subscription_term_months: 6, discount_percent: 40 }
    ]);
    expect(data.flavor_options.map((option) => option.key)).toEqual(['beef', 'fish', 'pork', 'turkey']);
  });

  describe('plan terms', () => {
    const recommendationRepository = { getRecommendation: jest.fn().mockResolvedValue(null) };
    const termDiscounts = {
      percentsFor: jest.fn(async (account) => (account === 'us' ? { 1: 10, 3: 25, 6: 35 } : { 1: 10, 3: 25, 6: 40 }))
    };

    test('Values after deploy: BR offers 10, 25 and 40 percent from the seeded account', async () => {
      const repository = new OnboardingPlanSnapshotRepository({ recommendationRepository, termDiscounts });

      const data = await repository.getSnapshot(7, MARKETS.BR);

      expect(termDiscounts.percentsFor).toHaveBeenCalledWith('br');
      expect(data.plan_terms).toEqual([
        { subscription_term_months: 1, discount_percent: 10 },
        { subscription_term_months: 3, discount_percent: 25 },
        { subscription_term_months: 6, discount_percent: 40 }
      ]);
    });

    test('Accounts are independent: the US snapshot offers the US percents', async () => {
      const repository = new OnboardingPlanSnapshotRepository({ recommendationRepository, termDiscounts });

      const data = await repository.getSnapshot(7, MARKETS.US);

      expect(data.plan_terms[2]).toEqual({ subscription_term_months: 6, discount_percent: 35 });
    });
  });

  test('uses published catalog flavors when the products repository returns labels', async () => {
    const repository = new OnboardingPlanSnapshotRepository({
      productsRepository: {
        listFlavorLabelsByCountry: jest.fn().mockResolvedValue(['Beef', 'Lamb'])
      }
    });

    const data = await repository.getSnapshot(null, MARKETS.BR);

    expect(data.flavor_options).toEqual([
      { key: 'beef', label: 'Beef' },
      { key: 'lamb', label: 'Lamb' }
    ]);
  });

  test('uses catalog slug and label when the products repository returns flavor identities', async () => {
    const repository = new OnboardingPlanSnapshotRepository({
      productsRepository: {
        listFlavorOptionsByCountry: jest.fn().mockResolvedValue([
          { key: 'turkey', label: 'Frango', aliases: ['chicken', 'frango', 'peru'] },
          { key: 'lamb', label: 'Cordeiro' }
        ])
      }
    });

    const data = await repository.getSnapshot(null, MARKETS.BR);

    expect(data.flavor_options).toEqual([
      { key: 'turkey', label: 'Frango' },
      { key: 'lamb', label: 'Cordeiro' }
    ]);
  });

  test('errors in production when the published catalog has no flavors', async () => {
    const repository = new OnboardingPlanSnapshotRepository({
      allowCatalogFallback: false,
      productsRepository: {
        listFlavorOptionsByCountry: jest.fn().mockResolvedValue([])
      }
    });

    await expect(repository.getSnapshot(null, MARKETS.BR)).rejects.toMatchObject({
      statusCode: 503,
      details: { code: 'catalog_flavors_unavailable' }
    });
  });
});
