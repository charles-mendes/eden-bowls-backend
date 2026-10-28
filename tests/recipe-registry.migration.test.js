const { AddRecipeRegistry1700000000040 } = require('../src/infrastructure/migrations/1700000000040-add-recipe-registry');

function queryRunner({ rows = [], hasColumn = false, tables = ['recipe_contents', 'wp_posts', 'wp_postmeta'] } = {}) {
  return {
    hasTable: jest.fn(async (name) => tables.includes(name)),
    hasColumn: jest.fn().mockResolvedValue(hasColumn),
    addColumn: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined),
    query: jest.fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValue(undefined)
  };
}

describe('AddRecipeRegistry1700000000040', () => {
  test('adds the name and registers each key in use once per market, named after its first variation', async () => {
    const runner = queryRunner({
      rows: [
        { id: 1001, market: 'BR', recipeKey: 'beef', label: 'Carne' },
        { id: 1005, market: 'BR', recipeKey: 'beef', label: 'Carne 500g' },
        { id: 3000, market: 'BR', recipeKey: 'beef', label: 'Bovino' },
        { id: 4001, market: 'BR', recipeKey: 'senior-beef', label: 'Receita de Carne para Cães Sênior' },
        { id: 2001, market: 'US', recipeKey: 'beef', label: null },
        { id: 9001, market: '', recipeKey: 'beef', label: 'Sem país' }
      ]
    });

    await new AddRecipeRegistry1700000000040().up(runner);

    const [table, column] = runner.addColumn.mock.calls[0];
    expect(table).toBe('recipe_contents');
    expect(column).toMatchObject({ name: 'name', type: 'varchar', length: '120', isNullable: false });
    const inserts = runner.query.mock.calls.slice(1);
    expect(inserts.map(([, params]) => params)).toEqual([
      ['BR', 'beef', 'Carne'],
      ['BR', 'senior-beef', 'Receita de Carne para Cães Sênior'],
      ['US', 'beef', 'beef']
    ]);
    expect(inserts[0][0]).toContain("ON DUPLICATE KEY UPDATE name = IF(name = '', VALUES(name), name)");
  });

  test('a second run keeps the column and existing names', async () => {
    const runner = queryRunner({ hasColumn: true });
    await new AddRecipeRegistry1700000000040().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();
    expect(runner.query).toHaveBeenCalledTimes(1);
  });

  test('down removes the registrations without content and the name', async () => {
    const runner = queryRunner({ hasColumn: true });
    runner.query = jest.fn().mockResolvedValue(undefined);
    await new AddRecipeRegistry1700000000040().down(runner);
    expect(runner.query).toHaveBeenCalledWith('DELETE FROM `recipe_contents` WHERE image_url IS NULL AND label IS NULL');
    expect(runner.dropColumn).toHaveBeenCalledWith('recipe_contents', 'name');
  });
});
