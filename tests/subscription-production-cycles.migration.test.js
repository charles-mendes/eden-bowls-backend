const { CreateSubscriptionProductionCycles1700000000018 } = require('../src/infrastructure/migrations/1700000000018-create-subscription-production-cycles');

describe('CreateSubscriptionProductionCycles1700000000018', () => {
  test('creates overlay table, FK CASCADE, unique key, and ledger index', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(false),
      getTable: jest.fn().mockResolvedValue({ indices: [] }),
      createTable: jest.fn().mockResolvedValue(undefined),
      createForeignKey: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue(undefined)
    };

    queryRunner.hasTable.mockImplementation(async (name) => name === 'stripe_subscriptions');

    await new CreateSubscriptionProductionCycles1700000000018().up(queryRunner);

    const [table] = queryRunner.createTable.mock.calls[0];
    expect(table.name).toBe('subscription_production_cycles');

    const columns = Object.fromEntries(table.columns.map((column) => [column.name, column]));
    expect(columns.status).toMatchObject({ type: 'varchar', length: '32', isNullable: false });
    expect(columns.note).toMatchObject({ type: 'varchar', length: '255', isNullable: true });
    expect(columns.updated_by_user_id).toMatchObject({ type: 'bigint', unsigned: true, isNullable: true });
    expect(columns.subscription_id).toMatchObject({ type: 'int', unsigned: true, isNullable: false });

    const [fkTable, foreignKey] = queryRunner.createForeignKey.mock.calls[0];
    expect(fkTable).toBe('subscription_production_cycles');
    expect(foreignKey.columnNames).toEqual(['subscription_id']);
    expect(foreignKey.referencedTableName).toBe('stripe_subscriptions');
    expect(foreignKey.referencedColumnNames).toEqual(['id']);
    expect(foreignKey.onDelete).toBe('CASCADE');

    const uniqueIndex = queryRunner.createIndex.mock.calls
      .map(([, index]) => index)
      .find((index) => index.isUnique);
    expect(uniqueIndex.columnNames).toEqual(['subscription_id', 'period_end']);

    const ledgerIndex = queryRunner.createIndex.mock.calls.find(([tableName, index]) => (
      tableName === 'stripe_subscriptions' && index.name === 'idx_stripe_subscriptions_status_period_end'
    ));
    expect(ledgerIndex[1].columnNames).toEqual(['status', 'current_period_end']);
  });
});
