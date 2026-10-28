const { SeedRecipeLabels1700000000041 } = require('../src/infrastructure/migrations/1700000000041-seed-recipe-labels');
const { RECIPE_LABELS, seedRecipeLabel, seedRecipeRegistrations } = require('../src/infrastructure/migrations/helpers/seed-recipe-labels');
const { parseRecipeLabel, parseEnergyKcalPerKg, labelCompleteness } = require('../src/core/recipe-content');

function queryRunner(rows, tables = ['recipe_contents']) {
  return {
    hasTable: jest.fn(async (name) => tables.includes(name)),
    query: jest.fn(async (sql) => (sql.startsWith('SELECT') ? rows : undefined))
  };
}

describe('seedRecipeLabel', () => {
  test.each(Object.keys(RECIPE_LABELS).flatMap((key) => [['BR', key], ['US', key]]))(
    '%s %s is a complete label the API reads the energy of',
    (market, key) => {
      const label = seedRecipeLabel(market, key);
      expect(parseRecipeLabel(label)).toEqual(label);
      expect(labelCompleteness(label, market)).toEqual({ status: 'complete', missing: [] });
      expect(parseEnergyKcalPerKg(label.energyKg)).toBe(RECIPE_LABELS[key].energyKg);
    }
  );

  test('writes numbers as each market does', () => {
    expect(seedRecipeLabel('BR', 'senior-beef')).toMatchObject({
      energyKg: '1.150 kcal/kg',
      energyPackage: '345 kcal por embalagem',
      analysis: expect.arrayContaining([{ nutrient: 'Cálcio (mín)', value: '0,16%' }])
    });
    expect(seedRecipeLabel('US', 'puppy-beef-chicken')).toMatchObject({
      productName: 'Fresh Frozen Dog Food – Beef & Chicken Puppy Recipe',
      energyKg: '1,500 kcal/kg',
      energyPackage: '450 kcal per package',
      analysis: expect.arrayContaining([{ nutrient: 'Moisture (max)', value: '72.0%' }])
    });
  });

  test('has no label for an unknown key or market', () => {
    expect(seedRecipeLabel('BR', 'bovino-e-frango')).toBeNull();
    expect(seedRecipeLabel('MX', 'beef')).toBeNull();
  });
});

describe('SeedRecipeLabels1700000000041', () => {
  test('fills empty labels and the energy of a label without it, keeping labels saved in the admin', async () => {
    const saved = { productName: 'Editada', energyKg: '1.300 kcal/kg', energyPackage: '390 kcal' };
    const runner = queryRunner([
      { id: 1, market: 'BR', recipeKey: 'beef', label: null },
      { id: 2, market: 'US', recipeKey: 'senior-chicken', label: JSON.stringify({ productName: 'Draft', energyKg: '' }) },
      { id: 3, market: 'BR', recipeKey: 'fish', label: saved },
      { id: 4, market: 'BR', recipeKey: 'bovino-e-frango', label: null }
    ]);

    await new SeedRecipeLabels1700000000041().up(runner);

    const updates = runner.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'));
    expect(updates).toHaveLength(2);
    expect(updates[0][0]).toContain('WHERE id = ? AND label IS NULL');
    expect(updates[0][1]).toEqual([JSON.stringify(seedRecipeLabel('BR', 'beef')), 1]);
    expect(JSON.parse(updates[1][1][0])).toEqual({ productName: 'Draft', energyKg: '1,150 kcal/kg', energyPackage: '345 kcal per package' });
    expect(updates[1][1][1]).toBe(2);
  });

  test('registers the eight store recipes of each market, keeping the name of a registered one', async () => {
    const runner = queryRunner([]);

    await new SeedRecipeLabels1700000000041().up(runner);

    const inserts = runner.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(16);
    expect(inserts[0][0]).toContain('ON DUPLICATE KEY UPDATE name = name');
    expect(inserts.map(([, params]) => params)).toEqual(expect.arrayContaining([
      ['BR', 'puppy-beef-chicken', 'Filhote Bovino e Frango'],
      ['BR', 'senior-chicken', 'Sênior Frango'],
      ['US', 'turkey', 'Chicken'],
      ['US', 'senior-beef', 'Senior Beef']
    ]));
    expect(seedRecipeRegistrations()).toHaveLength(16);
  });

  test('does nothing without the table', async () => {
    const runner = queryRunner([], []);
    await new SeedRecipeLabels1700000000041().up(runner);
    expect(runner.query).not.toHaveBeenCalled();
  });
});
