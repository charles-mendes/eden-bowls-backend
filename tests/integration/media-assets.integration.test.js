const { DataSource } = require('typeorm');
const { CreateRecipeContents1700000000038 } = require('../../src/infrastructure/migrations/1700000000038-create-recipe-contents');
const { AddRecipePlanImage1700000000043 } = require('../../src/infrastructure/migrations/1700000000043-add-recipe-plan-image');
const { CreateMediaAssets1700000000057 } = require('../../src/infrastructure/migrations/1700000000057-create-media-assets');
const { LinkRecipePlanImageAsset1700000000058 } = require('../../src/infrastructure/migrations/1700000000058-link-recipe-plan-image-asset');
const { MediaAssetRepository } = require('../../src/infrastructure/repositories/media-asset.repository');
const { RecipeContentRepository } = require('../../src/infrastructure/repositories/recipe-content.repository');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

const connection = {
  type: 'mysql',
  host: process.env.INTEGRATION_DB_HOST || '127.0.0.1',
  port: Number(process.env.INTEGRATION_DB_PORT || 3310),
  username: process.env.INTEGRATION_DB_USER || 'root',
  password: process.env.INTEGRATION_DB_PASSWORD || 'root',
  charset: 'utf8mb4',
  timezone: 'Z',
  entities: [],
  migrations: [],
  synchronize: false,
  logging: false
};

const OLD_URL = 'https://api.example.com/recipe-images/recipe-br-turkey-plan-0123456789abcdef0123456789abcdef.webp';

// The library migrations on a real MySQL: backfill of a stored thumbnail, a second run, and the restricting key.
describeIntegration('media_assets migrations (MySQL)', () => {
  const database = `it_${Date.now()}_media_assets`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;

  async function migrate(...migrations) {
    const runner = dataSource.createQueryRunner();
    try {
      for (const migration of migrations) {
        await migration.up(runner);
      }
    } finally {
      await runner.release();
    }
  }

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    await migrate(new CreateRecipeContents1700000000038(), new AddRecipePlanImage1700000000043());
    // The registry, life stage and presentation columns of migrations 040, 042 and 045, without their catalog seeds.
    await dataSource.query(
      `ALTER TABLE recipe_contents ADD COLUMN name varchar(120) NULL, ADD COLUMN life_stage varchar(16) NULL,
        ADD COLUMN presentation json NULL, ADD COLUMN presentation_updated_at datetime NULL`
    );
    await dataSource.query(
      "INSERT INTO recipe_contents (market, flavor_slug, plan_image_url) VALUES ('BR', 'turkey', ?), ('BR', 'beef', NULL)",
      [OLD_URL]
    );
    await migrate(new CreateMediaAssets1700000000057(), new LinkRecipePlanImageAsset1700000000058());
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('a stored thumbnail becomes a linked library image with the same URL', async () => {
    const assets = await dataSource.query('SELECT id, kind, market, url, original_filename, mime_type FROM media_assets');
    expect(assets).toEqual([expect.objectContaining({
      kind: 'plan',
      market: 'BR',
      url: OLD_URL,
      original_filename: 'recipe-br-turkey-plan-0123456789abcdef0123456789abcdef.webp',
      mime_type: 'image/webp'
    })]);
    const recipes = await dataSource.query('SELECT flavor_slug, plan_image_url, plan_image_asset_id FROM recipe_contents ORDER BY flavor_slug');
    expect(recipes).toEqual([
      { flavor_slug: 'beef', plan_image_url: null, plan_image_asset_id: null },
      { flavor_slug: 'turkey', plan_image_url: OLD_URL, plan_image_asset_id: assets[0].id }
    ]);
  });

  test('a second run adds nothing', async () => {
    await migrate(new CreateMediaAssets1700000000057(), new LinkRecipePlanImageAsset1700000000058());
    const [{ total }] = await dataSource.query('SELECT COUNT(*) AS total FROM media_assets');
    expect(Number(total)).toBe(1);
  });

  test('a linked library image cannot be deleted', async () => {
    await expect(dataSource.query('DELETE FROM media_assets')).rejects.toThrow(/foreign key/i);
  });

  test('two rows without a hash do not collide, the same hash in a market does', async () => {
    await dataSource.query("INSERT INTO media_assets (kind, market, url, original_filename, mime_type) VALUES ('plan', 'BR', 'a', 'a', 'image/webp')");
    const hash = 'a'.repeat(64);
    await dataSource.query("INSERT INTO media_assets (kind, market, url, original_filename, mime_type, sha256) VALUES ('plan', 'BR', 'b', 'b', 'image/webp', ?)", [hash]);
    await dataSource.query("INSERT INTO media_assets (kind, market, url, original_filename, mime_type, sha256) VALUES ('plan', 'US', 'c', 'c', 'image/webp', ?)", [hash]);
    await expect(dataSource.query(
      "INSERT INTO media_assets (kind, market, url, original_filename, mime_type, sha256) VALUES ('plan', 'BR', 'd', 'd', 'image/webp', ?)",
      [hash]
    )).rejects.toThrow(/duplicate/i);
  });

  describe('repositories', () => {
    let assets;
    let recipes;

    beforeAll(() => {
      assets = new MediaAssetRepository(dataSource);
      recipes = new RecipeContentRepository(dataSource);
    });

    async function upload(market, name) {
      return assets.insert({ kind: 'plan', market, url: `/recipe-images/${name}.webp`, originalFilename: `${name}.png`, mimeType: 'image/webp', width: 400, height: 400, bytes: 10, sha256: null });
    }

    test('an image in use is not archived, then archives once unlinked and links again after restore', async () => {
      const image = await upload('BR', 'adulto-carne');
      await recipes.setPlanImage({ market: 'BR', flavorSlug: 'beef', assetId: image.id, actorId: 7 });

      const refused = await assets.archive(image.id);
      expect(refused).toMatchObject({ archived: false, usedBy: [{ key: 'beef', market: 'BR' }] });

      const unlinked = await recipes.setPlanImage({ market: 'BR', flavorSlug: 'beef', assetId: null });
      expect(unlinked).toMatchObject({ planImageUrl: null, planImageAssetId: null });
      expect(await assets.archive(image.id)).toMatchObject({ archived: true, usedBy: [] });
      expect((await assets.list({ market: 'BR', kind: 'plan', archived: true })).map((asset) => asset.id)).toContain(image.id);

      await expect(recipes.setPlanImage({ market: 'BR', flavorSlug: 'beef', assetId: image.id }))
        .rejects.toMatchObject({ statusCode: 409 });

      await assets.restore(image.id);
      const linked = await recipes.setPlanImage({ market: 'BR', flavorSlug: 'beef', assetId: image.id });
      expect(linked).toMatchObject({ planImageUrl: image.url, planImageAssetId: image.id });
    });

    test('lists one market only, newest first, with the recipes using each', async () => {
      const us = await upload('US', 'adult-beef');
      const listed = await assets.list({ market: 'BR', kind: 'plan' });
      expect(listed.map((asset) => asset.market)).not.toContain('US');
      expect(listed[0].createdAt >= listed[listed.length - 1].createdAt).toBe(true);
      expect(listed.find((asset) => asset.usedBy.some((user) => user.key === 'beef'))).toBeTruthy();
      const usIds = (await assets.list({ market: 'US', kind: 'plan' })).map((asset) => asset.id);
      expect(usIds[0]).toBe(us.id);
    });
  });
});
