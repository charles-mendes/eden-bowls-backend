const { AddRecipeLifeStage1700000000042 } = require('../src/infrastructure/migrations/1700000000042-add-recipe-life-stage');

function queryRunner({ variations = [], recipes = [], hasColumn = false, tables = ['recipe_contents', 'wp_posts', 'wp_postmeta'] } = {}) {
  return {
    hasTable: jest.fn(async (name) => tables.includes(name)),
    hasColumn: jest.fn().mockResolvedValue(hasColumn),
    addColumn: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined),
    query: jest.fn()
      .mockResolvedValueOnce(variations)
      .mockResolvedValueOnce(recipes)
      .mockResolvedValue(undefined)
  };
}

describe('AddRecipeLifeStage1700000000042', () => {
  test('gives each recipe the line of its first published variation and moves the other variations to it', async () => {
    const runner = queryRunner({
      variations: [
        { id: 1001, market: 'BR', recipeKey: 'beef', published: 0, lifeStage: 'senior' },
        { id: 1005, market: 'BR', recipeKey: 'beef', published: 1, lifeStage: 'adult' },
        { id: 2011, market: 'BR', recipeKey: 'beef', published: 1, lifeStage: 'senior' },
        { id: 2015, market: 'BR', recipeKey: 'senior-beef', published: 1, lifeStage: 'senior' },
        { id: 2001, market: 'US', recipeKey: 'beef', published: 1, lifeStage: null }
      ],
      recipes: [
        { id: 1, market: 'BR', recipeKey: 'beef' },
        { id: 2, market: 'BR', recipeKey: 'senior-beef' },
        { id: 3, market: 'US', recipeKey: 'beef' },
        { id: 4, market: 'US', recipeKey: 'puppy-beef-chicken' }
      ]
    });

    await new AddRecipeLifeStage1700000000042().up(runner);

    expect(runner.addColumn.mock.calls[0][1]).toMatchObject({ name: 'life_stage', type: 'varchar', length: '16', isNullable: false });
    const writes = runner.query.mock.calls.slice(2).map(([sql, params]) => [sql.split(' ')[0], params]);
    expect(writes).toEqual([
      ['UPDATE', ['adult', 1]],
      ['DELETE', [1001, '_life_stage']],
      ['INSERT', [1001, '_life_stage', 'adult']],
      ['DELETE', [2011, '_life_stage']],
      ['INSERT', [2011, '_life_stage', 'adult']],
      ['UPDATE', ['senior', 2]],
      ['UPDATE', ['adult', 3]],
      ['DELETE', [2001, '_life_stage']],
      ['INSERT', [2001, '_life_stage', 'adult']],
      ['UPDATE', ['puppy', 4]]
    ]);
  });

  test('a second run keeps the column', async () => {
    const runner = queryRunner({ hasColumn: true });
    await new AddRecipeLifeStage1700000000042().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();
  });

  test('down drops the column', async () => {
    const runner = queryRunner({ hasColumn: true });
    await new AddRecipeLifeStage1700000000042().down(runner);
    expect(runner.dropColumn).toHaveBeenCalledWith('recipe_contents', 'life_stage');
  });
});
