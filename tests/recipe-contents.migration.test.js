const { CreateRecipeContents1700000000038 } = require('../src/infrastructure/migrations/1700000000038-create-recipe-contents');

function queryRunner({ existing = [] } = {}) {
  return {
    hasTable: jest.fn(async (name) => existing.includes(name)),
    createTable: jest.fn().mockResolvedValue(undefined),
    createIndex: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined)
  };
}

describe('CreateRecipeContents1700000000038', () => {
  test('creates recipe_contents with one row per market and flavor', async () => {
    const runner = queryRunner();
    await new CreateRecipeContents1700000000038().up(runner);

    const [table] = runner.createTable.mock.calls[0];
    expect(table.name).toBe('recipe_contents');
    expect(table.columns.map((column) => column.name)).toEqual([
      'id', 'market', 'flavor_slug', 'image_url', 'image_updated_at', 'label', 'label_updated_at',
      'updated_by', 'created_at', 'updated_at'
    ]);
    const [indexTable, index] = runner.createIndex.mock.calls[0];
    expect(indexTable).toBe('recipe_contents');
    expect(index).toMatchObject({ columnNames: ['market', 'flavor_slug'], isUnique: true });
  });

  test('a second run creates nothing', async () => {
    const runner = queryRunner({ existing: ['recipe_contents'] });
    await new CreateRecipeContents1700000000038().up(runner);
    expect(runner.createTable).not.toHaveBeenCalled();
    expect(runner.createIndex).not.toHaveBeenCalled();
  });

  test('down drops the table', async () => {
    const runner = queryRunner({ existing: ['recipe_contents'] });
    await new CreateRecipeContents1700000000038().down(runner);
    expect(runner.dropTable).toHaveBeenCalledWith('recipe_contents');
  });
});
