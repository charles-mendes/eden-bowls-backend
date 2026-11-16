const { SplitFirstPurchaseMisconfigByAccount1700000000076 } = require('../src/infrastructure/migrations/1700000000076-split-first-purchase-misconfig-by-account');
const { buildDataSourceOptions } = require('../src/infrastructure/db');

function queryRunner(tables = ['stripe_first_purchase_promo_metrics']) {
  return {
    hasTable: jest.fn(async (name) => tables.includes(name)),
    query: jest.fn().mockResolvedValue({ affectedRows: 1 })
  };
}

describe('SplitFirstPurchaseMisconfigByAccount1700000000076', () => {
  test('drops only the old global counter', async () => {
    const runner = queryRunner();
    await new SplitFirstPurchaseMisconfigByAccount1700000000076().up(runner);

    expect(runner.query).toHaveBeenCalledTimes(1);
    expect(runner.query.mock.calls[0][0]).toBe(
      "DELETE FROM `stripe_first_purchase_promo_metrics` WHERE `metric_key` = 'misconfig_count'"
    );
  });

  test('does nothing when the metrics table does not exist', async () => {
    const runner = queryRunner([]);
    await new SplitFirstPurchaseMisconfigByAccount1700000000076().up(runner);
    expect(runner.query).not.toHaveBeenCalled();
  });

  test('is registered in the data source', () => {
    const names = buildDataSourceOptions({}).migrations.map((migration) => migration.name);
    expect(names).toContain('SplitFirstPurchaseMisconfigByAccount1700000000076');
  });
});
