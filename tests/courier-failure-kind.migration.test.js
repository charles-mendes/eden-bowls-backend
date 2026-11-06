const { AddCourierFailureKind1700000000064 } = require('../src/infrastructure/migrations/1700000000064-add-courier-failure-kind');

function runner(exists) {
  return { query: jest.fn(async (sql) => (sql.includes('information_schema') ? (exists ? [{ 1: 1 }] : []) : [])) };
}

const writes = (queryRunner) => queryRunner.query.mock.calls.map(([sql]) => sql).filter((sql) => /^ALTER/.test(sql));

describe('AddCourierFailureKind1700000000064', () => {
  test('adds failure_kind after failure_reason once', async () => {
    const fresh = runner(false);
    await new AddCourierFailureKind1700000000064().up(fresh);
    expect(writes(fresh)).toEqual(['ALTER TABLE courier_deliveries ADD COLUMN failure_kind VARCHAR(32) NULL AFTER failure_reason']);

    const done = runner(true);
    await new AddCourierFailureKind1700000000064().up(done);
    expect(writes(done)).toEqual([]);
  });

  test('drops the column on down', async () => {
    const queryRunner = runner(true);
    await new AddCourierFailureKind1700000000064().down(queryRunner);
    expect(writes(queryRunner)).toEqual(['ALTER TABLE courier_deliveries DROP COLUMN failure_kind']);
  });
});
