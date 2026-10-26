const { AdminNutritionService } = require('../src/services/admin-nutrition.service');
const { HttpError } = require('../src/core/http-error');

describe('AdminNutritionService', () => {
  const service = new AdminNutritionService();

  test('uses dog NEM 3600 and combination factor', async () => {
    const result = await service.simulate({
      country: 'US',
      pet: { type: 'dog', life_stage: 'adult', weight: 20, neutered: true, age: 4 },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    });

    expect(result.data.nem_kcal_kg).toBe(3600);
    expect(result.data.fator_aplicado).toBe(85);
    expect(result.data.refeicoes).toBe(2);
    expect(result.data.display.weight).toContain('lb');
  });

  test('converts pound weight before calculating', async () => {
    const inKg = await service.simulate({
      country: 'US',
      pet: { type: 'dog', life_stage: 'adult', weight: 10, weight_unit: 'kg', neutered: true, age: 4 },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    });
    const inLb = await service.simulate({
      country: 'US',
      pet: { type: 'dog', life_stage: 'adult', weight: 22.05, weight_unit: 'lb', neutered: true, age: 4 },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    });

    expect(inLb.data.quantidade_g_dia).toBe(inKg.data.quantidade_g_dia);
    expect(inLb.data.display.weight).toContain('lb');
  });

  test('accepts age in months for a puppy', async () => {
    const result = await service.simulate({
      country: 'BR',
      pet: {
        type: 'dog',
        life_stage: 'puppy',
        weight: 3,
        age: 0,
        age_years: 0,
        age_months: 2,
        neutered: false
      },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    });

    expect(result.data.especie).toBe('dog');
    expect(result.data.energia_kcal_dia).toBeGreaterThan(0);
  });

  test('uses cat NEM 3800 instead of the old admin 3600 bug', async () => {
    const result = await service.simulate({
      country: 'BR',
      pet: { type: 'cat', life_stage: 'adult', weight: 4, neutered: true },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    });

    expect(result.data.nem_kcal_kg).toBe(3800);
    expect(result.data.especie).toBe('cat');
    expect(result.data.refeicoes).toBe(3);
    expect(result.data.display.daily).toContain('g/dia');
  });

  test('rejects invalid weight', async () => {
    await expect(service.simulate({
      country: 'US',
      pet: { type: 'dog', weight: 0 },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    })).rejects.toBeInstanceOf(HttpError);
  });

  test('rejects a country outside the actor market', async () => {
    try {
      await service.simulate({
        country: 'US',
        pet: { type: 'dog', life_stage: 'adult', weight: 10, neutered: true, age: 4 },
        questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
      }, { roles: ['operator'], markets: ['BR'] });
      throw new Error('expected market_forbidden');
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        details: { code: 'market_forbidden' }
      });
    }
  });

  describe('with recipe energy', () => {
    const recipeEnergyService = {
      forRecipe: jest.fn(async (market, key) => (key === 'pork' ? 1200 : null)),
      forLifeStage: jest.fn(async (market, stage) => ({ puppy: 1500, adult: 1200 })[stage] || null)
    };
    const withEnergy = new AdminNutritionService({ recipeEnergyService });
    const dog = { type: 'dog', life_stage: 'puppy', weight: 2, neutered: true, age: 0, age_months: 6 };
    const questionnaire = { nivel_atividade: 'ALTO', score_corporal: 'ABAIXO' };

    test('divides the daily kcal by the chosen recipe energyKg', async () => {
      const result = await withEnergy.simulate({ country: 'US', recipeKey: 'pork', pet: dog, questionnaire });

      expect(recipeEnergyService.forRecipe).toHaveBeenCalledWith('US', 'pork');
      expect(result.data.energia_kcal_dia).toBe(160);
      expect(result.data.nem_kcal_kg).toBe(1200);
      expect(result.data.quantidade_g_dia).toBe(133);
      expect(result.data.nem_source).toBe('recipe');
      expect(result.data.recipe_key).toBe('pork');
    });

    test('uses the mean energyKg of the pet line without a recipe', async () => {
      const result = await withEnergy.simulate({ country: 'BR', pet: dog, questionnaire });

      expect(recipeEnergyService.forLifeStage).toHaveBeenCalledWith('BR', 'puppy');
      expect(result.data.nem_kcal_kg).toBe(1500);
      expect(result.data.quantidade_g_dia).toBe(107);
      expect(result.data.nem_source).toBe('life_stage_average');
    });

    test('keeps the engine default when the line has no energyKg', async () => {
      const result = await withEnergy.simulate({ country: 'BR', pet: { ...dog, life_stage: 'senior' }, questionnaire });

      expect(result.data.nem_kcal_kg).toBe(3600);
      expect(result.data.nem_source).toBe('default');
    });

    test('keeps the cat default', async () => {
      const result = await withEnergy.simulate({
        country: 'BR',
        pet: { type: 'cat', life_stage: 'adult', weight: 4, neutered: true },
        questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
      });

      expect(result.data.nem_kcal_kg).toBe(3800);
    });

    test('lists the recipes of the market for the simulator', async () => {
      const listing = new AdminNutritionService({
        recipeEnergyService: { listRecipes: jest.fn(async () => [{ key: 'pork', name: 'Suíno', life_stage: 'adult', energy_kcal_kg: 1200 }]) }
      });

      const result = await listing.listRecipes({ country: 'BR' });

      expect(result.data).toEqual({ market: 'BR', items: [{ key: 'pork', name: 'Suíno', life_stage: 'adult', energy_kcal_kg: 1200 }] });
      await expect(listing.listRecipes({ country: 'US' }, { roles: ['operator'], markets: ['BR'] }))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    test('rejects a recipe without energyKg', async () => {
      await expect(withEnergy.simulate({ country: 'US', recipeKey: 'beef', pet: dog, questionnaire }))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'recipe_energy_missing' } });
    });
  });
});
