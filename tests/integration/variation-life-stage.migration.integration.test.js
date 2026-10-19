const { DataSource } = require('typeorm');
const { CreateProductsCatalogTables1700000000002 } = require('../../src/infrastructure/migrations/1700000000002-create-products-catalog-tables');
const { SeedCurrentAppFlavorsCatalog1700000000007 } = require('../../src/infrastructure/migrations/1700000000007-seed-current-app-flavors-catalog');
const { AddVariationLifeStage1700000000034 } = require('../../src/infrastructure/migrations/1700000000034-add-variation-life-stage');

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

function variationSnapshot(dataSource) {
  return dataSource.query(
    `SELECT v.ID AS id, v.post_parent AS parent,
       MAX(CASE WHEN m.meta_key = '_regular_price' THEN m.meta_value END) AS price,
       MAX(CASE WHEN m.meta_key = '_flavor_slug' THEN m.meta_value END) AS flavor
     FROM wp_posts v LEFT JOIN wp_postmeta m ON m.post_id = v.ID
     WHERE v.post_type = 'product_variation'
     GROUP BY v.ID, v.post_parent ORDER BY v.ID`
  );
}

// Migration 034 on the catalog as migrations 002 and 007 seed it.
describeIntegration('migration 1700000000034 tags current recipes as adult (MySQL)', () => {
  const database = `it_${Date.now()}_mig034`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let runner;
  let before;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await new CreateProductsCatalogTables1700000000002().up(runner);
    await new SeedCurrentAppFlavorsCatalog1700000000007().up(runner);
    before = await variationSnapshot(dataSource);
    await new AddVariationLifeStage1700000000034().up(runner);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('every seeded variation reads adult once', async () => {
    const rows = await dataSource.query(
      `SELECT v.ID AS id, COUNT(m.meta_id) AS tags, MIN(m.meta_value) AS line
       FROM wp_posts v LEFT JOIN wp_postmeta m ON m.post_id = v.ID AND m.meta_key = '_life_stage'
       WHERE v.post_type = 'product_variation' GROUP BY v.ID`
    );
    expect(rows).toHaveLength(16);
    for (const row of rows) {
      expect(Number(row.tags)).toBe(1);
      expect(row.line).toBe('adult');
    }
  });

  test('variation IDs, parents, flavors and prices do not change', async () => {
    expect(before).toHaveLength(16);
    expect(await variationSnapshot(dataSource)).toEqual(before);
  });

  test('a second run adds no duplicate tag', async () => {
    await new AddVariationLifeStage1700000000034().up(runner);
    const [{ total }] = await dataSource.query("SELECT COUNT(*) AS total FROM wp_postmeta WHERE meta_key = '_life_stage'");
    expect(Number(total)).toBe(16);
  });

  test('down removes every tag', async () => {
    await new AddVariationLifeStage1700000000034().down(runner);
    const [{ total }] = await dataSource.query("SELECT COUNT(*) AS total FROM wp_postmeta WHERE meta_key = '_life_stage'");
    expect(Number(total)).toBe(0);
  });
});
