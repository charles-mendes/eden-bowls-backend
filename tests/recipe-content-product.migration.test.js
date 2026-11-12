const { AddRecipeContentProduct1700000000074 } = require('../src/infrastructure/migrations/1700000000074-add-recipe-content-product');

function queryRunner({ table = true, columns = [] } = {}) {
  const present = new Set(columns);
  return {
    hasTable: jest.fn(async () => table),
    hasColumn: jest.fn(async (_table, column) => present.has(column)),
    addColumn: jest.fn(async (_table, column) => present.add(column.name)),
    createIndex: jest.fn(),
    dropIndex: jest.fn(),
    dropColumn: jest.fn(async (_table, column) => present.delete(column))
  };
}

describe('AddRecipeContentProduct1700000000074', () => {
  test('adds a unique nullable product id, aliases and short label', async () => {
    const runner = queryRunner();
    await new AddRecipeContentProduct1700000000074().up(runner);

    const added = runner.addColumn.mock.calls.map(([, column]) => column);
    expect(added.map((column) => column.name)).toEqual(['product_id', 'flavor_aliases', 'short_label']);
    expect(added.every((column) => column.isNullable)).toBe(true);
    expect(runner.createIndex.mock.calls[0][1]).toMatchObject({ columnNames: ['product_id'], isUnique: true });
  });

  test('a second run adds nothing', async () => {
    const runner = queryRunner({ columns: ['product_id', 'flavor_aliases', 'short_label'] });
    await new AddRecipeContentProduct1700000000074().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();
    expect(runner.createIndex).not.toHaveBeenCalled();
  });

  test('down drops the index and the columns', async () => {
    const runner = queryRunner({ columns: ['product_id', 'flavor_aliases', 'short_label'] });
    await new AddRecipeContentProduct1700000000074().down(runner);
    expect(runner.dropIndex).toHaveBeenCalledWith('recipe_contents', 'uniq_recipe_contents_product');
    expect(runner.dropColumn.mock.calls.map(([, column]) => column)).toEqual(['short_label', 'flavor_aliases', 'product_id']);
  });

  test('does nothing without the table', async () => {
    const runner = queryRunner({ table: false });
    await new AddRecipeContentProduct1700000000074().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();
  });
});
