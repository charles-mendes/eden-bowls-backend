const { AddPetAgeReference1700000000036 } = require('../src/infrastructure/migrations/1700000000036-add-pet-age-reference');

function queryRunner({ hasTable = true, hasColumn = false } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    hasColumn: jest.fn().mockResolvedValue(hasColumn),
    addColumn: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(undefined)
  };
}

describe('AddPetAgeReference1700000000036', () => {
  test('adds the four columns and backfills age_recorded_at from created_at', async () => {
    const runner = queryRunner();
    await new AddPetAgeReference1700000000036().up(runner);

    const columns = runner.addColumn.mock.calls.map(([table, column]) => [table, column.name, column.isNullable]);
    expect(columns).toEqual([
      ['onboarding_pets', 'age_recorded_at', false],
      ['onboarding_pets', 'birth_date', true],
      ['onboarding_pets', 'life_stage_announced_at', true],
      ['onboarding_pets', 'life_stage_announced_stage', true]
    ]);
    expect(runner.addColumn.mock.calls[0][1].default).toBe('CURRENT_TIMESTAMP');
    expect(runner.query.mock.calls).toEqual([['UPDATE onboarding_pets SET age_recorded_at = created_at']]);
  });

  test('a second run adds nothing and does not backfill again', async () => {
    const runner = queryRunner({ hasColumn: true });
    await new AddPetAgeReference1700000000036().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();
    expect(runner.query).not.toHaveBeenCalled();
  });

  test('down drops the columns, and a missing table is skipped', async () => {
    const runner = queryRunner({ hasColumn: true });
    await new AddPetAgeReference1700000000036().down(runner);
    expect(runner.dropColumn.mock.calls.map(([, name]) => name)).toEqual([
      'life_stage_announced_stage', 'life_stage_announced_at', 'birth_date', 'age_recorded_at'
    ]);

    const missing = queryRunner({ hasTable: false });
    await new AddPetAgeReference1700000000036().up(missing);
    expect(missing.addColumn).not.toHaveBeenCalled();
  });
});
