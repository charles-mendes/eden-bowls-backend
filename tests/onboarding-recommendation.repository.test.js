const { MARKETS } = require('../src/core/market');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');

describe('OnboardingRecommendationRepository', () => {
  test('returns empty pets when there is no authenticated user', async () => {
    const petsRepository = { listPets: jest.fn() };
    const repository = new OnboardingRecommendationRepository(petsRepository);

    const data = await repository.getRecommendation(null, MARKETS.US);

    expect(petsRepository.listPets).not.toHaveBeenCalled();
    expect(data.country).toBe('US');
    expect(data.recommendations).toEqual([]);
    expect(data.simplified.pets).toEqual([]);
    expect(data.simplified.labels.daily).toBe('Daily');
    expect(data.version).toBe('v1');
  });

  test('calculates daily grams from the user pets', async () => {
    const petsRepository = {
      listPets: jest.fn().mockResolvedValue({
        pets: [
          {
            id: 'pet-1',
            name: 'Luna',
            breed: 'Maltese',
            age_years: 2,
            age_months: 0,
            weight_input: 10,
            weight_unit: 'kg',
            size: 'small',
            activity_level: 'medium',
            pet_condition: 'ideal',
            neutered: true
          }
        ]
      })
    };
    const repository = new OnboardingRecommendationRepository(petsRepository);

    const data = await repository.getRecommendation(7, MARKETS.BR);

    expect(petsRepository.listPets).toHaveBeenCalledWith(7);
    expect(data.country).toBe('BR');
    expect(data.recommendations[0].pet_id).toBe('pet-1');
    expect(data.recommendations[0].quantidade_g_dia).toBeGreaterThan(0);
    expect(data.simplified.pets[0].daily.formatted).toMatch(/ g\/dia$/);
    expect(data.simplified.pets[0].monthly.grams).toBe(data.recommendations[0].quantidade_g_dia * 30);
    expect(data.simplified.pets[0].packs.count).toBeGreaterThan(0);
  });
});
