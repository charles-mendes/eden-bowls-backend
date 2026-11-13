const { AddNfeMissingFields1700000000067 } = require('../src/infrastructure/migrations/1700000000067-add-nfe-missing-fields');

function runner(exists) {
  return { query: jest.fn(async (sql) => (sql.includes('information_schema') ? (exists ? [{ 1: 1 }] : []) : [])) };
}

const writes = (queryRunner) => queryRunner.query.mock.calls.map(([sql]) => sql).filter((sql) => /^ALTER/.test(sql));

describe('AddNfeMissingFields1700000000067', () => {
  test('adds missing_fields after customer_address once', async () => {
    const fresh = runner(false);
    await new AddNfeMissingFields1700000000067().up(fresh);
    expect(writes(fresh)).toEqual(['ALTER TABLE bling_nfe ADD COLUMN missing_fields JSON NULL AFTER customer_address']);

    const done = runner(true);
    await new AddNfeMissingFields1700000000067().up(done);
    expect(writes(done)).toEqual([]);
  });

  test('drops the column on down', async () => {
    const queryRunner = runner(true);
    await new AddNfeMissingFields1700000000067().down(queryRunner);
    expect(writes(queryRunner)).toEqual(['ALTER TABLE bling_nfe DROP COLUMN missing_fields']);
  });
});
