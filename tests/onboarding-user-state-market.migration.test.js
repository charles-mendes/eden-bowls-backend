const { AddOnboardingUserStateMarket1700000000019 } = require('../src/infrastructure/migrations/1700000000019-add-onboarding-user-state-market');

describe('AddOnboardingUserStateMarket1700000000019', () => {
  test('adds a nullable indexed market column and drops it on down', async () => {
    const table = { indices: [] };
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(true),
      hasColumn: jest.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      addColumn: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockImplementation(async (_name, index) => {
        table.indices.push(index);
      }),
      getTable: jest.fn().mockImplementation(async () => table),
      dropIndex: jest.fn().mockResolvedValue(undefined),
      dropColumn: jest.fn().mockResolvedValue(undefined)
    };

    const migration = new AddOnboardingUserStateMarket1700000000019();
    expect(migration.name).toBe('AddOnboardingUserStateMarket1700000000019');

    await migration.up(queryRunner);
    expect(queryRunner.addColumn).toHaveBeenCalledWith(
      'onboarding_user_state',
      expect.objectContaining({ name: 'market', isNullable: true })
    );
    expect(queryRunner.createIndex).toHaveBeenCalledWith(
      'onboarding_user_state',
      expect.objectContaining({
        name: 'idx_onboarding_user_state_market',
        columnNames: ['market']
      })
    );

    await migration.down(queryRunner);
    expect(queryRunner.dropIndex).toHaveBeenCalledWith(
      'onboarding_user_state',
      'idx_onboarding_user_state_market'
    );
    expect(queryRunner.dropColumn).toHaveBeenCalledWith('onboarding_user_state', 'market');
  });
});
