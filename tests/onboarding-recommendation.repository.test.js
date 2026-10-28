const { MARKETS } = require('../src/core/market');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');
const { DEFAULT_NUTRITION_PARAMETERS } = require('../src/core/nutrition-recommendation');

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

describe('OnboardingRecommendationRepository packaging from the plan product (plan-packaging)', () => {
  // A 20 kg adult dog: the pack size and count must not change on deploy.
  const dog = {
    pet_id: 'rex', name: 'Rex', breed: 'Mixed', age_years: 4, weight: 20, weight_unit: 'kg',
    size: 'medium', activity_level: 'medium', pet_condition: 'ideal', neutered: true
  };

  async function recommend(productsRepository, market = MARKETS.BR) {
    return new OnboardingRecommendationRepository(null, { productsRepository }).getRecommendation(null, market, [dog]);
  }

  test('Catalog with 300 g and 500 g: the same packs as before the deploy', async () => {
    const before = await recommend(null);
    const productsRepository = {
      findPlanPackaging: jest.fn().mockResolvedValue({ packSizesGrams: [300, 500, 300, 500], planDays: 30, largePackLimit: 8 })
    };

    const after = await recommend(productsRepository);

    expect(productsRepository.findPlanPackaging).toHaveBeenCalledWith('BR');
    expect(after.packaging).toEqual(before.packaging);
    expect(after.simplified).toEqual(before.simplified);
    expect(after.packaging.package_sizes_grams).toEqual([300, 500]);
  });

  test('without an active variation, or when the catalog fails, the packaging of before applies', async () => {
    const before = await recommend(null, MARKETS.US);
    const empty = await recommend({ findPlanPackaging: jest.fn().mockResolvedValue({ packSizesGrams: [], planDays: 0, largePackLimit: 0 }) }, MARKETS.US);
    const missing = await recommend({ findPlanPackaging: jest.fn().mockResolvedValue(null) }, MARKETS.US);
    const failing = await recommend({ findPlanPackaging: jest.fn().mockRejectedValue(new Error('db down')) }, MARKETS.US);

    for (const data of [empty, missing, failing]) {
      expect(data.packaging).toEqual(before.packaging);
      expect(data.simplified).toEqual(before.simplified);
    }
  });

  test('a 1 kg active variation becomes the large pack', async () => {
    const data = await recommend({ findPlanPackaging: jest.fn().mockResolvedValue({ packSizesGrams: [300, 500, 1000], planDays: 30, largePackLimit: 8 }) });
    expect(data.packaging.package_sizes_grams).toEqual([300, 500, 1000]);
  });

  describe('published nutrition parameter set', () => {
    const draftPets = [
      { pet_id: 'rex', name: 'Rex', breed: 'SRD', age_years: 4, weight: 20, weight_unit: 'kg', size: 'medium', activity_level: 'medium', pet_condition: 'ideal', neutered: true },
      { pet_id: 'thor', name: 'Thor', breed: 'Great Dane', age_years: 3, weight: 60, weight_unit: 'kg', size: 'large', activity_level: 'high', pet_condition: 'ideal', neutered: false },
      { pet_id: 'mia', name: 'Mia', type: 'cat', age_years: 6, weight: 4, weight_unit: 'kg', activity_level: 'low', pet_condition: 'overweight', neutered: true }
    ];

    test('Recommendation records its version: the id of the published set', async () => {
      const nutritionParameters = { published: jest.fn().mockResolvedValue({ id: 4, parameters: DEFAULT_NUTRITION_PARAMETERS }) };
      const repository = new OnboardingRecommendationRepository(null, { nutritionParameters });

      const data = await repository.getRecommendation(null, MARKETS.BR, draftPets);

      expect(data.nutrition_parameter_set_id).toBe(4);
    });

    test('Same result after deploy: the seeded set gives what the code gave before', async () => {
      const seeded = JSON.parse(JSON.stringify(DEFAULT_NUTRITION_PARAMETERS));
      const withSet = new OnboardingRecommendationRepository(null, { nutritionParameters: { published: async () => ({ id: 1, parameters: seeded }) } });
      const without = new OnboardingRecommendationRepository(null);

      const after = await withSet.getRecommendation(null, MARKETS.US, draftPets);
      const before = await without.getRecommendation(null, MARKETS.US, draftPets);

      expect(after.recommendations).toEqual(before.recommendations);
      expect(after.simplified).toEqual(before.simplified);
      expect(before.nutrition_parameter_set_id).toBeNull();
    });

    test('a published change reaches the recommendation', async () => {
      const parameters = { ...DEFAULT_NUTRITION_PARAMETERS, nem: { dog: 4000, cat: 3800 } };
      const repository = new OnboardingRecommendationRepository(null, { nutritionParameters: { published: async () => ({ id: 2, parameters }) } });

      const data = await repository.getRecommendation(null, MARKETS.US, draftPets.slice(0, 1));

      expect(data.recommendations[0].nem_kcal_kg).toBe(4000);
    });
  });
});
