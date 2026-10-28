const { BackfillOnboardingUserStateMarket1700000000056 } = require('../src/infrastructure/migrations/1700000000056-backfill-onboarding-user-state-market');
const { buildDataSourceOptions } = require('../src/infrastructure/db');

function queryRunner(tables = ['onboarding_user_state', 'wp_usermeta']) {
  return {
    hasTable: jest.fn(async (name) => tables.includes(name)),
    query: jest.fn().mockResolvedValue({ affectedRows: 0 })
  };
}

describe('BackfillOnboardingUserStateMarket1700000000056', () => {
  test('fills only empty checkout markets from a BR or US profile market', async () => {
    const runner = queryRunner();
    await new BackfillOnboardingUserStateMarket1700000000056().up(runner);

    const [sql, params] = runner.query.mock.calls[0];
    expect(sql.replace(/\s+/g, ' ')).toContain("WHERE (s.market IS NULL OR s.market = '') AND UPPER(TRIM(pm.meta_value)) IN ('BR', 'US')");
    expect(params).toEqual(['hsr_market_country']);
  });

  test('skips missing tables', async () => {
    const runner = queryRunner(['onboarding_user_state']);
    await new BackfillOnboardingUserStateMarket1700000000056().up(runner);
    expect(runner.query).not.toHaveBeenCalled();
  });

  test('is registered last, after the lifecycle dates', () => {
    const names = buildDataSourceOptions({}).migrations.map((migration) => migration.name);
    expect(names.slice(-2)).toEqual(['AddSubscriptionLifecycleDates1700000000055', 'BackfillOnboardingUserStateMarket1700000000056']);
  });
});
