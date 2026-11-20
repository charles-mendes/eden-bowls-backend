const { AddCatalogSyncRunStripeAccount1700000000089 } = require('../src/infrastructure/migrations/1700000000089-add-catalog-sync-run-stripe-account');

describe('AddCatalogSyncRunStripeAccount1700000000089', () => {
  function runner({ hasTable = true, hasColumn = false } = {}) {
    return {
      hasTable: jest.fn().mockResolvedValue(hasTable),
      hasColumn: jest.fn().mockResolvedValue(hasColumn),
      query: jest.fn().mockResolvedValue(undefined)
    };
  }

  test('adds a nullable stripe_account_id once', async () => {
    const first = runner();
    await new AddCatalogSyncRunStripeAccount1700000000089().up(first);
    expect(first.query).toHaveBeenCalledWith('ALTER TABLE `catalog_sync_runs` ADD COLUMN `stripe_account_id` VARCHAR(64) NULL');

    const again = runner({ hasColumn: true });
    await new AddCatalogSyncRunStripeAccount1700000000089().up(again);
    expect(again.query).not.toHaveBeenCalled();
  });

  test('skips when the table does not exist', async () => {
    const queryRunner = runner({ hasTable: false });
    await new AddCatalogSyncRunStripeAccount1700000000089().up(queryRunner);
    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  test('down drops the column', async () => {
    const queryRunner = runner({ hasColumn: true });
    await new AddCatalogSyncRunStripeAccount1700000000089().down(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledWith('ALTER TABLE `catalog_sync_runs` DROP COLUMN `stripe_account_id`');
  });

  test('is registered right after 088 and before the purchase trail', () => {
    const { buildDataSourceOptions } = require('../src/infrastructure/db');
    const names = buildDataSourceOptions({}).migrations.map((migration) => migration.name);
    const index = names.indexOf('AddCatalogSyncRunStripeAccount1700000000089');
    expect(index).toBeGreaterThan(0);
    expect(names[index - 1]).toMatch(/1700000000088$/);
    expect(names[index + 1]).toBe('CreateCustomerPurchaseTrail1700000000090');
  });
});
