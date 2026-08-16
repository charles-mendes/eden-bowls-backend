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
});
