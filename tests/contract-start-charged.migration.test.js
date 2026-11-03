const { AddContractStartCharged1700000000061 } = require('../src/infrastructure/migrations/1700000000061-add-contract-start-charged');

function queryRunner(exists) {
  return { query: jest.fn(async (sql) => (sql.includes('information_schema') && exists ? [{ 1: 1 }] : [])) };
}
const altered = (runner) => runner.query.mock.calls.map(([sql]) => sql).filter((sql) => sql.startsWith('ALTER'));

describe('AddContractStartCharged1700000000061', () => {
  test('adds the column with a default that keeps every count', async () => {
    const runner = queryRunner(false);
    await new AddContractStartCharged1700000000061().up(runner);
    expect(altered(runner)).toEqual(['ALTER TABLE stripe_subscriptions ADD COLUMN contract_start_charged INT UNSIGNED NOT NULL DEFAULT 0']);
  });

  test('skips a column that exists and drops it on down', async () => {
    const runner = queryRunner(true);
    await new AddContractStartCharged1700000000061().up(runner);
    expect(altered(runner)).toEqual([]);
    await new AddContractStartCharged1700000000061().down(runner);
    expect(altered(runner)).toEqual(['ALTER TABLE stripe_subscriptions DROP COLUMN contract_start_charged']);
  });
});
