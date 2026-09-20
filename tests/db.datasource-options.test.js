const { buildDataSourceOptions } = require('../src/infrastructure/db');
const { CreateSubscriptionProductionCycles1700000000018 } = require('../src/infrastructure/migrations/1700000000018-create-subscription-production-cycles');

describe('buildDataSourceOptions production overlay', () => {
  test('registers the production cycle entity and migration 0018', () => {
    const options = buildDataSourceOptions({});
    const tableNames = options.entities.map((entity) => entity.options.tableName);

    expect(tableNames).toContain('subscription_production_cycles');
    expect(options.migrations).toContain(CreateSubscriptionProductionCycles1700000000018);
  });
});
