const { BackfillVariationRecipeKey1700000000039 } = require('../src/infrastructure/migrations/1700000000039-backfill-variation-recipe-key');

function queryRunner(rows = [], { hasTable = true } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    query: jest.fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValue(undefined)
  };
}

function inserted(runner) {
  return runner.query.mock.calls.slice(1).map(([, params]) => params);
}

describe('BackfillVariationRecipeKey1700000000039', () => {
  test('stores the key each variation used before: flavor slug first, then the label through the aliases', async () => {
    const runner = queryRunner([
      { id: 1001, market: 'BR', flavorSlug: 'turkey', label: 'Frango' },
      { id: 3000, market: 'BR', flavorSlug: null, label: 'Bovino' },
      { id: 4001, market: 'BR', flavorSlug: 'senior-beef', label: 'Receita de Carne para Cães Sênior' },
      { id: 5000, market: 'US', flavorSlug: null, label: null }
    ]);

    await new BackfillVariationRecipeKey1700000000039().up(runner);

    expect(inserted(runner)).toEqual([
      [1001, '_recipe_key', 'turkey'],
      [3000, '_recipe_key', 'beef'],
      [4001, '_recipe_key', 'senior-beef']
    ]);
  });

  test('reads only variations without a recipe key, so a stored key is kept', async () => {
    const runner = queryRunner([]);
    await new BackfillVariationRecipeKey1700000000039().up(runner);

    const [sql, params] = runner.query.mock.calls[0];
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM `wp_postmeta` k WHERE k.`post_id` = v.`ID` AND k.`meta_key` = \?\)/);
    expect(params).toEqual(['_flavor_slug', '_recipe_key']);
    expect(runner.query).toHaveBeenCalledTimes(1);
  });

  test('down removes the stored keys', async () => {
    const runner = queryRunner();
    await new BackfillVariationRecipeKey1700000000039().down(runner);
    expect(runner.query).toHaveBeenCalledWith('DELETE FROM `wp_postmeta` WHERE `meta_key` = ?', ['_recipe_key']);
  });

  test('skips a database without the catalog tables', async () => {
    const runner = queryRunner([], { hasTable: false });
    await new BackfillVariationRecipeKey1700000000039().up(runner);
    expect(runner.query).not.toHaveBeenCalled();
  });
});
