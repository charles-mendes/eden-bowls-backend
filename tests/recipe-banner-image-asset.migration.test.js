const { LinkRecipeBannerImageAsset1700000000059 } = require('../src/infrastructure/migrations/1700000000059-link-recipe-banner-image-asset');
const { buildDataSourceOptions } = require('../src/infrastructure/db');

// In-memory recipe_contents and media_assets, enough for the backfill queries.
function queryRunner({ hasColumn = false, tables = ['recipe_contents', 'media_assets'], recipes = [] } = {}) {
  const assets = [];
  const runner = {
    assets,
    recipes,
    hasTable: jest.fn(async (name) => tables.includes(name)),
    hasColumn: jest.fn(async () => hasColumn),
    addColumn: jest.fn(async () => { hasColumn = true; }),
    createForeignKey: jest.fn().mockResolvedValue(undefined),
    getTable: jest.fn(async () => ({ foreignKeys: [{ name: 'fk_recipe_contents_image_asset_id' }] })),
    dropForeignKey: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql, params = []) => {
      if (sql.startsWith('SELECT')) {
        return recipes.filter((row) => row.image_url && row.image_asset_id == null);
      }
      if (sql.startsWith('INSERT')) {
        const [market, url, originalFilename] = params;
        assets.push({ id: assets.length + 1, kind: sql.includes("'banner'") ? 'banner' : null, market, url, originalFilename, mimeType: 'image/webp' });
        return { insertId: assets.length };
      }
      const [assetId, recipeId] = params;
      recipes.find((row) => row.id === recipeId).image_asset_id = assetId;
      return [];
    })
  };
  return runner;
}

describe('LinkRecipeBannerImageAsset1700000000059', () => {
  test('adds the banner link with a restricting foreign key', async () => {
    const runner = queryRunner();
    await new LinkRecipeBannerImageAsset1700000000059().up(runner);
    const [table, column] = runner.addColumn.mock.calls[0];
    expect([table, column.name, column.isNullable]).toEqual(['recipe_contents', 'image_asset_id', true]);
    const [, foreignKey] = runner.createForeignKey.mock.calls[0];
    expect(foreignKey.referencedTableName).toBe('media_assets');
    expect(foreignKey.onDelete).toBe('RESTRICT');
  });

  test('turns a stored banner into a library banner with the same URL, once', async () => {
    const url = 'https://api.example.com/recipe-images/recipe-br-turkey-0123456789abcdef0123456789abcdef.webp';
    const runner = queryRunner({
      recipes: [
        { id: 7, market: 'br', image_url: url, image_asset_id: null },
        { id: 8, market: 'BR', image_url: null, image_asset_id: null }
      ]
    });
    await new LinkRecipeBannerImageAsset1700000000059().up(runner);

    expect(runner.assets).toEqual([{
      id: 1,
      kind: 'banner',
      market: 'BR',
      url,
      originalFilename: 'recipe-br-turkey-0123456789abcdef0123456789abcdef.webp',
      mimeType: 'image/webp'
    }]);
    expect(runner.recipes.map((row) => [row.id, row.image_url, row.image_asset_id])).toEqual([
      [7, url, 1],
      [8, null, null]
    ]);

    await new LinkRecipeBannerImageAsset1700000000059().up(runner);
    expect(runner.assets).toHaveLength(1);
    expect(runner.createForeignKey).toHaveBeenCalledTimes(1);
  });

  test('skips when a table is missing', async () => {
    const runner = queryRunner({ tables: ['recipe_contents'] });
    await new LinkRecipeBannerImageAsset1700000000059().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();
    expect(runner.query).not.toHaveBeenCalled();
  });

  test('down drops the foreign key and the column', async () => {
    const runner = queryRunner({ hasColumn: true });
    await new LinkRecipeBannerImageAsset1700000000059().down(runner);
    expect(runner.dropForeignKey).toHaveBeenCalledWith('recipe_contents', { name: 'fk_recipe_contents_image_asset_id' });
    expect(runner.dropColumn).toHaveBeenCalledWith('recipe_contents', 'image_asset_id');
  });

  test('is registered last, after the plan thumbnail link', () => {
    const names = buildDataSourceOptions({}).migrations.map((migration) => migration.name);
    expect(names.slice(-2)).toEqual(['LinkRecipePlanImageAsset1700000000058', 'LinkRecipeBannerImageAsset1700000000059']);
  });
});
