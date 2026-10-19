const { DataSource } = require('typeorm');
const { CreateProductsCatalogTables1700000000002 } = require('../../src/infrastructure/migrations/1700000000002-create-products-catalog-tables');
const { SeedCurrentAppFlavorsCatalog1700000000007 } = require('../../src/infrastructure/migrations/1700000000007-seed-current-app-flavors-catalog');
const { AdminCatalogRepository } = require('../../src/infrastructure/repositories/admin-catalog.repository');

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

// The queue names recipes from the catalog as migration 007 seeds it, plus one new senior recipe.
describeIntegration('AdminCatalogRepository.listRecipeNames (MySQL)', () => {
  const database = `it_${Date.now()}_recipe_names`;
  const admin = new DataSource({ ...connection, database: process.env.INTEGRATION_DB_NAME || 'eden_bowls' });
  let dataSource;
  let repository;

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    dataSource = new DataSource({ ...connection, database });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await new CreateProductsCatalogTables1700000000002().up(runner);
    await new SeedCurrentAppFlavorsCatalog1700000000007().up(runner);
    await runner.release();
    repository = new AdminCatalogRepository(dataSource);
    const id = await repository.createVariation({
      productId: 100,
      name: 'Senior Beef 300g',
      flavor: 'Receita de Carne para Cães Sênior',
      flavorSlug: 'senior-beef',
      lifeStage: 'senior',
      shortLabel: 'Bovino · Sênior',
      zoneId: 'br'
    });
    expect(id).toBeTruthy();
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) await dataSource.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.destroy();
    }
  });

  test('maps each market and flavor key to its full and short names', async () => {
    const names = await repository.listRecipeNames();
    expect(names.BR.beef).toEqual({ label: 'Bovino', shortLabel: '' });
    expect(names.BR.turkey).toEqual({ label: 'Frango', shortLabel: '' });
    expect(names.US.turkey).toEqual({ label: 'Chicken', shortLabel: '' });
    expect(names.BR['senior-beef']).toEqual({ label: 'Receita de Carne para Cães Sênior', shortLabel: 'Bovino · Sênior' });
    expect(names.US['senior-beef']).toBeUndefined();
  });

  test('the new variation is created inactive and the seeded ones stay active', async () => {
    const rows = await dataSource.query(
      "SELECT post_status AS status, COUNT(*) AS total FROM wp_posts WHERE post_type = 'product_variation' GROUP BY post_status ORDER BY post_status"
    );
    expect(rows.map((row) => [row.status, Number(row.total)])).toEqual([['draft', 1], ['publish', 16]]);
  });

  test('lists the line of each key and the lines with a published recipe, per market', async () => {
    const lines = await repository.listRecipeLines();
    expect(lines.BR.lineByKey).toMatchObject({ beef: 'adult', turkey: 'adult', 'senior-beef': 'senior' });
    expect([...lines.BR.publishedLines]).toEqual(['adult']);
    await dataSource.query("UPDATE wp_posts SET post_status = 'publish' WHERE post_type = 'product_variation' AND post_status = 'draft'");
    expect([...(await repository.listRecipeLines()).BR.publishedLines].sort()).toEqual(['adult', 'senior']);
  });
});
