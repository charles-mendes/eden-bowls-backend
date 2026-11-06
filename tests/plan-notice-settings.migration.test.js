const { AddPlanNoticeSettings1700000000060 } = require('../src/infrastructure/migrations/1700000000060-add-plan-notice-settings');

function queryRunner(existing = []) {
  return {
    query: jest.fn(async (sql, params) => {
      if (sql.includes('information_schema')) return existing.includes(params[1]) ? [{ 1: 1 }] : [];
      return [];
    })
  };
}

const altered = (runner) => runner.query.mock.calls.map(([sql]) => sql).filter((sql) => sql.startsWith('ALTER TABLE'));

describe('AddPlanNoticeSettings1700000000060', () => {
  test('Values after deploy', async () => {
    const runner = queryRunner();
    await new AddPlanNoticeSettings1700000000060().up(runner);
    expect(altered(runner)).toEqual([
      'ALTER TABLE automated_email_settings ADD COLUMN renewal_notice_enabled TINYINT(1) NOT NULL DEFAULT 1',
      'ALTER TABLE automated_email_settings ADD COLUMN plan_ending_notice_enabled TINYINT(1) NOT NULL DEFAULT 1',
      'ALTER TABLE automated_email_settings ADD COLUMN plan_notice_days INT NOT NULL DEFAULT 7'
    ]);
  });

  test('skips a column that already exists', async () => {
    const runner = queryRunner(['renewal_notice_enabled']);
    await new AddPlanNoticeSettings1700000000060().up(runner);
    expect(altered(runner)).toHaveLength(2);
  });

  test('down removes only the columns present', async () => {
    const runner = queryRunner(['plan_notice_days']);
    await new AddPlanNoticeSettings1700000000060().down(runner);
    expect(altered(runner)).toEqual(['ALTER TABLE automated_email_settings DROP COLUMN plan_notice_days']);
  });
});
