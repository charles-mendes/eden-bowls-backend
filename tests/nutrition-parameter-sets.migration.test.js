const { CreateNutritionParameterSets1700000000049 } = require('../src/infrastructure/migrations/1700000000049-create-nutrition-parameter-sets');
const { DEFAULT_NUTRITION_PARAMETERS } = require('../src/core/nutrition-recommendation');

function queryRunner({ hasTable = false, published = [] } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    createTable: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql) => (sql.startsWith('SELECT') ? published : undefined))
  };
}

describe('CreateNutritionParameterSets1700000000049', () => {
  test('Same result after deploy: creates the table and publishes the values of the code', async () => {
    const runner = queryRunner();

    await new CreateNutritionParameterSets1700000000049().up(runner);

    const [table] = runner.createTable.mock.calls[0];
    expect(table.name).toBe('nutrition_parameter_sets');
    expect(table.columns.map((column) => column.name)).toEqual([
      'id', 'status', 'parameters', 'created_by', 'published_by', 'published_at', 'created_at', 'updated_at'
    ]);
    const insert = runner.query.mock.calls.find(([sql]) => sql.startsWith('INSERT'));
    expect(insert[0]).toContain("VALUES ('published', ?, CURRENT_TIMESTAMP)");
    expect(JSON.parse(insert[1][0])).toEqual(JSON.parse(JSON.stringify(DEFAULT_NUTRITION_PARAMETERS)));
  });

  test('a rerun keeps the published set', async () => {
    const runner = queryRunner({ hasTable: true, published: [{ id: 3 }] });

    await new CreateNutritionParameterSets1700000000049().up(runner);

    expect(runner.createTable).not.toHaveBeenCalled();
    expect(runner.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });

  test('down drops the table', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreateNutritionParameterSets1700000000049().down(runner);
    expect(runner.dropTable).toHaveBeenCalledWith('nutrition_parameter_sets');
  });
});
