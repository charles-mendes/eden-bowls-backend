const { CreateUserOwnedOnboardingTables1700000000004 } = require('../src/infrastructure/migrations/1700000000004-create-user-owned-onboarding-tables');

describe('CreateUserOwnedOnboardingTables1700000000004', () => {
  test('creates user-owned onboarding tables with ownership constraints and indexes', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(false),
      createTable: jest.fn().mockResolvedValue(undefined),
      createForeignKey: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue(undefined)
    };

    const migration = new CreateUserOwnedOnboardingTables1700000000004();
    await migration.up(queryRunner);

    const createdTables = queryRunner.createTable.mock.calls.map(([table]) => table);
    const petsTable = createdTables.find((table) => table.name === 'onboarding_pets');
    const userStateTable = createdTables.find((table) => table.name === 'onboarding_user_state');

    expect(petsTable).toBeDefined();
    expect(userStateTable).toBeDefined();
    expect(petsTable.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'id',
      'user_id',
      'local_id',
      'deleted_at'
    ]));
    expect(userStateTable.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'user_id',
      'plan_selection',
      'address',
      'shipping',
      'checkout_reference'
    ]));

    expect(queryRunner.createForeignKey).toHaveBeenCalledTimes(2);
    for (const [, foreignKey] of queryRunner.createForeignKey.mock.calls) {
      expect(foreignKey.referencedTableName).toBe('wp_users');
      expect(foreignKey.referencedColumnNames).toEqual(['ID']);
    }

    const indexes = queryRunner.createIndex.mock.calls.map(([tableName, index]) => ({ tableName, index }));
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tableName: 'onboarding_pets',
        index: expect.objectContaining({
          name: 'idx_onboarding_pets_user_deleted',
          columnNames: ['user_id', 'deleted_at']
        })
      }),
      expect.objectContaining({
        tableName: 'onboarding_pets',
        index: expect.objectContaining({
          name: 'uk_onboarding_pets_user_local_id',
          columnNames: ['user_id', 'local_id'],
          isUnique: true
        })
      })
    ]));
  });
});