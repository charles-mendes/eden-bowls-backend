const { LinkRecipePlanImageAsset1700000000058 } = require('../src/infrastructure/migrations/1700000000058-link-recipe-plan-image-asset');
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
    getTable: jest.fn(async () => ({ foreignKeys: [{ name: 'fk_recipe_contents_plan_image_asset_id' }] })),
    dropForeignKey: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql, params = []) => {
      if (sql.startsWith('SELECT')) {
        return recipes.filter((row) => row.plan_image_url && row.plan_image_asset_id == null);
      }
      if (sql.startsWith('INSERT')) {
        const [market, url, originalFilename] = params;
        assets.push({ id: assets.length + 1, kind: 'plan', market, url, originalFilename, mimeType: 'image/webp' });
        return { insertId: assets.length };
      }
      const [assetId, recipeId] = params;
      recipes.find((row) => row.id === recipeId).plan_image_asset_id = assetId;
      return [];
    })
  };
  return runner;
}

describe('LinkRecipePlanImageAsset1700000000058', () => {
  test('adds the asset link with a restricting foreign key', async () => {
    const runner = queryRunner();
    await new LinkRecipePlanImageAsset1700000000058().up(runner);
    const [table, column] = runner.addColumn.mock.calls[0];
    expect([table, column.name, column.isNullable]).toEqual(['recipe_contents', 'plan_image_asset_id', true]);
    const [, foreignKey] = runner.createForeignKey.mock.calls[0];
    expect(foreignKey.referencedTableName).toBe('media_assets');
    expect(foreignKey.onDelete).toBe('RESTRICT');
  });

  test('turns a stored thumbnail into a library image with the same URL', async () => {
    const url = 'https://api.example.com/recipe-images/recipe-br-turkey-plan-0123456789abcdef0123456789abcdef.webp';
    const runner = queryRunner({
      recipes: [
        { id: 7, market: 'BR', plan_image_url: url, plan_image_asset_id: null },
        { id: 8, market: 'BR', plan_image_url: null, plan_image_asset_id: null }
      ]
    });
    await new LinkRecipePlanImageAsset1700000000058().up(runner);

    expect(runner.assets).toEqual([{
      id: 1,
      kind: 'plan',
      market: 'BR',
      url,
      originalFilename: 'recipe-br-turkey-plan-0123456789abcdef0123456789abcdef.webp',
      mimeType: 'image/webp'
    }]);
    expect(runner.recipes.map((row) => [row.id, row.plan_image_url, row.plan_image_asset_id])).toEqual([
      [7, url, 1],
      [8, null, null]
    ]);

    await new LinkRecipePlanImageAsset1700000000058().up(runner);
    expect(runner.assets).toHaveLength(1);
    expect(runner.createForeignKey).toHaveBeenCalledTimes(1);
  });

  test('skips when a table is missing', async () => {
    const runner = queryRunner({ tables: ['recipe_contents'] });
    await new LinkRecipePlanImageAsset1700000000058().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();
    expect(runner.query).not.toHaveBeenCalled();
  });

  test('down drops the foreign key and the column', async () => {
    const runner = queryRunner({ hasColumn: true });
    await new LinkRecipePlanImageAsset1700000000058().down(runner);
    expect(runner.dropForeignKey).toHaveBeenCalledWith('recipe_contents', { name: 'fk_recipe_contents_plan_image_asset_id' });
    expect(runner.dropColumn).toHaveBeenCalledWith('recipe_contents', 'plan_image_asset_id');
  });

  test('is registered last, after the library table', () => {
    const names = buildDataSourceOptions({}).migrations.map((migration) => migration.name);
    expect(names.slice(-2)).toEqual(['CreateMediaAssets1700000000057', 'LinkRecipePlanImageAsset1700000000058']);
  });
});
