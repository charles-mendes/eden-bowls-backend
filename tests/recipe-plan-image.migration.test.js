const { AddRecipePlanImage1700000000043 } = require('../src/infrastructure/migrations/1700000000043-add-recipe-plan-image');

function queryRunner({ hasColumn = false, tables = ['recipe_contents'] } = {}) {
  return {
    hasTable: jest.fn(async (name) => tables.includes(name)),
    hasColumn: jest.fn().mockResolvedValue(hasColumn),
    addColumn: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined)
  };
}

describe('AddRecipePlanImage1700000000043', () => {
  test('adds the nullable plan thumbnail columns once', async () => {
    const runner = queryRunner();
    await new AddRecipePlanImage1700000000043().up(runner);
    expect(runner.addColumn.mock.calls.map(([table, column]) => [table, column.name, column.isNullable])).toEqual([
      ['recipe_contents', 'plan_image_url', true],
      ['recipe_contents', 'plan_image_updated_at', true]
    ]);

    const again = queryRunner({ hasColumn: true });
    await new AddRecipePlanImage1700000000043().up(again);
    expect(again.addColumn).not.toHaveBeenCalled();
  });

  test('down drops both columns', async () => {
    const runner = queryRunner({ hasColumn: true });
    await new AddRecipePlanImage1700000000043().down(runner);
    expect(runner.dropColumn.mock.calls.map(([, name]) => name)).toEqual(['plan_image_updated_at', 'plan_image_url']);
  });
});
