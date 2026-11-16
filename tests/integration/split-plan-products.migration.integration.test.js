const { createScratchDatabase } = require('./helpers/scratch-database');
const { AddRecipeContentProduct1700000000074 } = require('../../src/infrastructure/migrations/1700000000074-add-recipe-content-product');
const { SplitPlanProducts1700000000075 } = require('../../src/infrastructure/migrations/1700000000075-split-plan-products');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

const quiet = { log: () => {} };

async function seed(db) {
  await db.query(`CREATE TABLE recipe_contents (
    id int unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    market varchar(8) NOT NULL, flavor_slug varchar(64) NOT NULL,
    name varchar(120) NOT NULL DEFAULT '', life_stage varchar(16) NOT NULL DEFAULT 'adult',
    image_url varchar(512) NULL,
    UNIQUE KEY uniq_recipe_contents_market_flavor (market, flavor_slug)
  )`);
  await db.query(`INSERT INTO wp_posts (ID, post_parent, post_type, post_status, post_title, post_name, menu_order) VALUES
    (100, 0, 'product', 'publish', 'Flavors BR', 'flavors-br', 1),
    (1001, 100, 'product_variation', 'publish', 'Bovino 300g', 'beef-300', 1),
    (1002, 100, 'product_variation', 'draft', 'Bovino 500g', 'beef-500', 2),
    (1003, 100, 'product_variation', 'draft', 'Bovino Sênior 300g', 'senior-beef-300', 3)`);
  const meta = [
    [100, '_cmpb_plan_country', 'BR'], [100, '_cmpb_plan_days', '30'],
    [1001, '_sku', 'BEEF-300'], [1001, '_recipe_key', 'beef'], [1001, '_flavor_slug', 'beef'], [1001, 'attribute_pa_flavor', 'Bovino'],
    [1001, '_life_stage', 'adult'], [1001, '_short_label', 'Carne'], [1001, 'attribute_pa_weight', '300g'], [1001, '_stripe_price_id', 'price_1'],
    [1002, '_sku', 'BEEF-500'], [1002, '_recipe_key', 'beef'], [1002, 'attribute_pa_flavor', 'Bovino'],
    [1002, '_life_stage', 'adult'], [1002, '_short_label', 'Bovino'], [1002, 'attribute_pa_weight', '500g'],
    [1003, '_sku', 'SBEEF-300'], [1003, '_recipe_key', 'senior-beef'], [1003, '_flavor_slug', 'senior-beef'],
    [1003, 'attribute_pa_flavor', 'Bovino Sênior'], [1003, '_life_stage', 'adult'], [1003, 'attribute_pa_weight', '300g']
  ];
  for (const row of meta) {
    await db.query('INSERT INTO wp_postmeta (post_id, meta_key, meta_value) VALUES (?, ?, ?)', row);
  }
  await db.query('INSERT INTO wp_term_relationships (object_id, term_taxonomy_id) VALUES (100, 10), (100, 221)');
  await db.query(`INSERT INTO recipe_contents (market, flavor_slug, name, life_stage, image_url) VALUES
    ('BR', 'beef', 'Bovino', 'adult', '/img/beef.png'),
    ('BR', 'senior-beef', 'Bovino Sênior', 'senior', NULL),
    ('BR', 'senior-lamb', 'Cordeiro Sênior', 'senior', NULL)`);
}

async function metaOf(db, postId) {
  const rows = await db.query('SELECT meta_key AS k, meta_value AS v FROM wp_postmeta WHERE post_id = ? ORDER BY meta_key', [postId]);
  return Object.fromEntries(rows.map((row) => [row.k, row.v]));
}

describeIntegration('migration 1700000000075 splits the plan product per recipe (MySQL)', () => {
  let db;
  let runner;
  let before;

  beforeAll(async () => {
    db = await createScratchDatabase('mig075', ['wp_posts', 'wp_postmeta', 'wp_term_relationships']);
    runner = db.dataSource.createQueryRunner();
    await seed(db);
    before = {
      posts: await db.query('SELECT ID, post_parent, post_status, post_title, menu_order FROM wp_posts ORDER BY ID'),
      meta: await db.query('SELECT post_id, meta_key, meta_value FROM wp_postmeta ORDER BY post_id, meta_key'),
      terms: await db.query('SELECT object_id, term_taxonomy_id FROM wp_term_relationships ORDER BY object_id, term_taxonomy_id')
    };
    await new AddRecipeContentProduct1700000000074().up(runner);
    await new SplitPlanProducts1700000000075().up(runner, quiet);
  });

  afterAll(async () => {
    if (runner) await runner.release();
    if (db) await db.drop();
  });

  const productOf = async (key) => {
    const [row] = await db.query(
      `SELECT p.ID AS id, p.post_title AS title, p.post_status AS status, p.menu_order AS menuOrder
       FROM recipe_contents c INNER JOIN wp_posts p ON p.ID = c.product_id WHERE c.market = 'BR' AND c.flavor_slug = ?`,
      [key]
    );
    return row;
  };
  const childrenOf = async (productId) => (await db.query(
    "SELECT ID FROM wp_posts WHERE post_parent = ? AND post_type = 'product_variation' ORDER BY ID", [productId]
  )).map((row) => Number(row.ID));

  test('Split of the BR plan product', async () => {
    const beef = await productOf('beef');
    const seniorBeef = await productOf('senior-beef');
    expect(beef).toMatchObject({ title: 'Bovino', status: 'publish', menuOrder: 1 });
    expect(seniorBeef).toMatchObject({ title: 'Bovino Sênior', status: 'draft', menuOrder: 3 });
    expect(await childrenOf(beef.id)).toEqual([1001, 1002]);
    expect(await childrenOf(seniorBeef.id)).toEqual([1003]);
    expect(await db.query('SELECT ID FROM wp_posts WHERE ID = 100')).toEqual([]);
    expect(await metaOf(db, beef.id)).toEqual({ _cmpb_plan_country: 'BR' });
    const terms = await db.query('SELECT term_taxonomy_id AS t FROM wp_term_relationships WHERE object_id = ? ORDER BY t', [beef.id]);
    expect(terms.map((row) => Number(row.t))).toEqual([10, 221]);
  });

  test('Moved variation keeps its Stripe lookup product and price', async () => {
    const meta = await metaOf(db, 1001);
    expect(meta).toMatchObject({ _stripe_lookup_product_id: '100', _stripe_price_id: 'price_1', attribute_pa_weight: '300g' });
  });

  test('Different short labels: the first variation wins and both report it', async () => {
    expect((await metaOf(db, 1001))._short_label).toBe('Carne');
    expect((await metaOf(db, 1002))).toMatchObject({ _short_label: 'Carne', _flavor_slug: 'beef', _recipe_key: 'beef' });
    const [content] = await db.query("SELECT short_label AS shortLabel FROM recipe_contents WHERE flavor_slug = 'beef'");
    expect(content.shortLabel).toBe('Carne');
  });

  test('Life stage differs from the recipe', async () => {
    expect((await metaOf(db, 1003))._life_stage).toBe('senior');
  });

  test('Recipe without variations', async () => {
    const lamb = await productOf('senior-lamb');
    expect(lamb).toMatchObject({ title: 'Cordeiro Sênior', status: 'draft' });
    expect(await childrenOf(lamb.id)).toEqual([]);
  });

  test('every content has a product and the column is required', async () => {
    const [column] = await db.query(
      "SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipe_contents' AND COLUMN_NAME = 'product_id'"
    );
    expect(column.nullable).toBe('NO');
  });

  test('a second run changes nothing', async () => {
    const posts = await db.query('SELECT COUNT(*) AS n FROM wp_posts');
    await new SplitPlanProducts1700000000075().up(runner, quiet);
    expect(await db.query('SELECT COUNT(*) AS n FROM wp_posts')).toEqual(posts);
  });

  test('down restores the plan product, its variations and their metas', async () => {
    await new SplitPlanProducts1700000000075().down(runner);
    await new AddRecipeContentProduct1700000000074().down(runner);

    expect(await db.query('SELECT ID, post_parent, post_status, post_title, menu_order FROM wp_posts ORDER BY ID')).toEqual(before.posts);
    expect(await db.query('SELECT post_id, meta_key, meta_value FROM wp_postmeta ORDER BY post_id, meta_key')).toEqual(before.meta);
    expect(await db.query('SELECT object_id, term_taxonomy_id FROM wp_term_relationships ORDER BY object_id, term_taxonomy_id')).toEqual(before.terms);
    expect(await db.query("SHOW TABLES LIKE 'catalog_split_backup'")).toEqual([]);
  });
});
