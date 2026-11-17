const { CreateMediaAssets1700000000082 } = require('../src/infrastructure/migrations/1700000000082-create-media-assets');
const { buildDataSourceOptions } = require('../src/infrastructure/db');

function queryRunner(tables = []) {
  return {
    hasTable: jest.fn(async (name) => tables.includes(name)),
    createTable: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined)
  };
}

describe('CreateMediaAssets1700000000082', () => {
  test('creates the library table with a per-market hash key once', async () => {
    const runner = queryRunner();
    await new CreateMediaAssets1700000000082().up(runner);
    const [table] = runner.createTable.mock.calls[0];
    expect(table.name).toBe('media_assets');
    expect(table.columns.map((column) => column.name)).toEqual([
      'id', 'kind', 'market', 'url', 'original_filename', 'mime_type', 'width', 'height', 'bytes', 'sha256',
      'uploaded_by', 'created_at', 'archived_at'
    ]);
    expect(table.columns.filter((column) => column.isNullable).map((column) => column.name)).toEqual([
      'width', 'height', 'bytes', 'sha256', 'uploaded_by', 'archived_at'
    ]);
    expect(table.uniques.map((unique) => unique.columnNames)).toEqual([['market', 'kind', 'sha256']]);

    const again = queryRunner(['media_assets']);
    await new CreateMediaAssets1700000000082().up(again);
    expect(again.createTable).not.toHaveBeenCalled();
  });

  test('down drops the table', async () => {
    const runner = queryRunner(['media_assets']);
    await new CreateMediaAssets1700000000082().down(runner);
    expect(runner.dropTable).toHaveBeenCalledWith('media_assets');
  });

  test('is registered after the delivery operating week, before the plan and banner links', () => {
    const names = buildDataSourceOptions({}).migrations.map((migration) => migration.name);
    const index = names.indexOf('CreateMediaAssets1700000000082');
    expect(names[index - 1]).toBe('CreateDeliveryOperatingWeek1700000000081');
    expect(names.slice(index + 1, index + 3)).toEqual(['LinkRecipePlanImageAsset1700000000083', 'LinkRecipeBannerImageAsset1700000000084']);
  });
});
