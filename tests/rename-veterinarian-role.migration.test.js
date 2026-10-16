const { RenameNutritionistRoleToVeterinarian1700000000033 } = require('../src/infrastructure/migrations/1700000000033-rename-nutritionist-role-to-veterinarian');

function queryRunner({ hasTable = true } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    query: jest.fn().mockResolvedValue(undefined)
  };
}

describe('RenameNutritionistRoleToVeterinarian1700000000033', () => {
  test('rewrites stored admin roles from nutritionist to veterinarian', async () => {
    const runner = queryRunner();
    await new RenameNutritionistRoleToVeterinarian1700000000033().up(runner);

    expect(runner.hasTable).toHaveBeenCalledWith('wp_usermeta');
    const [sql, params] = runner.query.mock.calls[0];
    expect(sql).toMatch(/^UPDATE `wp_usermeta` SET `meta_value` = REPLACE\(`meta_value`, \?, \?\) WHERE `meta_key` = \? AND `meta_value` LIKE \?$/);
    expect(params).toEqual(['nutritionist', 'veterinarian', '_eden_admin_roles', '%nutritionist%']);
  });

  test('down restores nutritionist', async () => {
    const runner = queryRunner();
    await new RenameNutritionistRoleToVeterinarian1700000000033().down(runner);

    const [, params] = runner.query.mock.calls[0];
    expect(params).toEqual(['veterinarian', 'nutritionist', '_eden_admin_roles', '%veterinarian%']);
  });

  test('skips a database without the usermeta table', async () => {
    const runner = queryRunner({ hasTable: false });
    await new RenameNutritionistRoleToVeterinarian1700000000033().up(runner);

    expect(runner.query).not.toHaveBeenCalled();
  });
});
