const { parseEnergyKcalPerKg } = require('../src/core/recipe-content');
const { RecipeEnergyService } = require('../src/services/recipe-energy.service');

describe('parseEnergyKcalPerKg', () => {
  test.each([
    ['1.200 kcal/kg', 1200],
    ['1,500 kcal/kg', 1500],
    ['1150 kcal/kg', 1150],
    ['Metabolizable Energy: 1,200 kcal/kg', 1200],
    ['1,25 kcal/g', 1.25],
    ['', null],
    [null, null],
    ['sem valor', null]
  ])('%p -> %p', (input, expected) => {
    expect(parseEnergyKcalPerKg(input)).toBe(expected);
  });
});

describe('RecipeEnergyService', () => {
  const row = (recipeKey, lifeStage, extra = {}) => ({ market: 'BR', recipeKey, lifeStage, published: true, ...extra });
  const labels = {
    'pork': '1.200 kcal/kg',
    'beef': '1.200 kcal/kg',
    'fish': '1.250 kcal/kg',
    'puppy-beef': '1.500 kcal/kg',
    'senior-beef': '',
    'draft': '9.999 kcal/kg'
  };
  const contentRepository = {
    findByMarketAndSlug: jest.fn(async (market, key) => (key in labels ? { label: { energyKg: labels[key] } } : null)),
    findByMarketAndSlugs: jest.fn(async (market, keys) => new Map(keys.map((key) => [key, { label: { energyKg: labels[key] } }])))
  };
  const catalogRepository = {
    recipeVariationRows: jest.fn(async () => [
      row('pork', 'adult'),
      row('pork', 'adult'),
      row('beef', 'adult'),
      row('fish', 'adult'),
      row('puppy-beef', 'puppy'),
      row('senior-beef', 'senior'),
      row('draft', 'adult', { published: false }),
      row('pork', 'puppy', { market: 'US' }),
      row(null, 'adult')
    ])
  };

  test('reads the energyKg of one recipe', async () => {
    const service = new RecipeEnergyService({ contentRepository, catalogRepository });

    await expect(service.forRecipe('br', 'pork')).resolves.toBe(1200);
    await expect(service.forRecipe('BR', 'senior-beef')).resolves.toBeNull();
    await expect(service.forRecipe('BR', 'missing')).resolves.toBeNull();
    expect(contentRepository.findByMarketAndSlug).toHaveBeenCalledWith('BR', 'pork');
  });

  test('averages the published recipes of each line in the market', async () => {
    const service = new RecipeEnergyService({ contentRepository, catalogRepository });

    await expect(service.averagesByLifeStage('BR')).resolves.toEqual({ adult: 1217, puppy: 1500 });
    await expect(service.forLifeStage('BR', 'puppy')).resolves.toBe(1500);
    await expect(service.forLifeStage('BR', null)).resolves.toBe(1217);
    await expect(service.forLifeStage('BR', 'senior')).resolves.toBeNull();
    expect(catalogRepository.recipeVariationRows).toHaveBeenCalledTimes(1);
  });

  test('lists the published recipes of the market with their line and energy', async () => {
    const service = new RecipeEnergyService({ contentRepository, catalogRepository });

    const items = await service.listRecipes('BR');

    expect(items.map((item) => item.key)).toEqual(['pork', 'beef', 'fish', 'puppy-beef', 'senior-beef']);
    expect(items[3]).toEqual({ key: 'puppy-beef', name: 'puppy-beef', life_stage: 'puppy', energy_kcal_kg: 1500 });
    expect(items[4].energy_kcal_kg).toBeNull();
  });
});
