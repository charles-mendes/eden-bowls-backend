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

  test('calculates from posted draft pets without querying the user pets table', async () => {
    const petsRepository = { listPets: jest.fn() };
    const repository = new OnboardingRecommendationRepository(petsRepository);

    const data = await repository.getRecommendation(null, MARKETS.BR, [{
      pet_id: 'local-luna',
      name: 'luna',
      breed: 'Maltese',
      age_years: 2,
      weight: 13,
      weight_unit: 'kg',
      size: 'small',
      activity_level: 'high',
      pet_condition: 'overweight',
      neutered: false
    }]);

    expect(petsRepository.listPets).not.toHaveBeenCalled();
    expect(data.country).toBe('BR');
    expect(data.recommendations[0].pet_id).toBe('local-luna');
    expect(data.recommendations[0].quantidade_g_dia).toBeGreaterThan(0);
    expect(data.simplified.pets[0].pet_name).toBe('luna');
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

  test('divides by the mean energyKg of each dog line', async () => {
    const lifeStageService = {
      annotate: jest.fn(async (pets) => pets.map((pet) => ({ ...pet, life_stage: pet.pet_id === 'pup' ? 'puppy' : 'adult' })))
    };
    const recipeEnergyService = {
      forLifeStage: jest.fn(async (market, stage) => ({ puppy: 1500, adult: 1200 })[stage])
    };
    const repository = new OnboardingRecommendationRepository({ listPets: jest.fn() }, { lifeStageService, recipeEnergyService });
    const dog = { breed: 'Maltese', age_years: 3, weight: 2, weight_unit: 'kg', activity_level: 'high', pet_condition: 'underweight', neutered: true };

    const data = await repository.getRecommendation(null, MARKETS.BR, [
      { ...dog, pet_id: 'pup', name: 'Pipoca' },
      { ...dog, pet_id: 'adult', name: 'Luna' }
    ]);

    expect(recipeEnergyService.forLifeStage).toHaveBeenCalledWith('BR', 'puppy');
    expect(data.recommendations[0].nem_kcal_kg).toBe(1500);
    expect(data.recommendations[0].quantidade_g_dia).toBe(107);
    expect(data.recommendations[1].nem_kcal_kg).toBe(1200);
    expect(data.simplified.pets[0].life_stage).toBe('puppy');
  });
});
