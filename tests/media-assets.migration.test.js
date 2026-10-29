const { CreateMediaAssets1700000000057 } = require('../src/infrastructure/migrations/1700000000057-create-media-assets');
const { buildDataSourceOptions } = require('../src/infrastructure/db');

function queryRunner(tables = []) {
  return {
    hasTable: jest.fn(async (name) => tables.includes(name)),
    createTable: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined)
  };
}

describe('CreateMediaAssets1700000000057', () => {
  test('creates the library table with a per-market hash key once', async () => {
    const runner = queryRunner();
    await new CreateMediaAssets1700000000057().up(runner);
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
    await new CreateMediaAssets1700000000057().up(again);
    expect(again.createTable).not.toHaveBeenCalled();
  });

  test('down drops the table', async () => {
    const runner = queryRunner(['media_assets']);
    await new CreateMediaAssets1700000000057().down(runner);
    expect(runner.dropTable).toHaveBeenCalledWith('media_assets');
  });

  test('is registered after the onboarding market backfill', () => {
    const names = buildDataSourceOptions({}).migrations.map((migration) => migration.name);
    const index = names.indexOf('CreateMediaAssets1700000000057');
    expect(names[index - 1]).toBe('BackfillOnboardingUserStateMarket1700000000056');
  });
});
