const { DataSource } = require('typeorm');
const { ProductsRepository } = require('../../src/infrastructure/repositories/products.repository');
const { PriceZonePolicyRepository } = require('../../src/infrastructure/repositories/price-zone-policy.repository');

const runIntegration = process.env.RUN_DB_INTEGRATION_TESTS === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('ProductsRepository integration (MySQL)', () => {
  const suffix = Date.now();
  const tableNames = {
    posts: `it_${suffix}_posts`,
    postmeta: `it_${suffix}_postmeta`,
    terms: `it_${suffix}_terms`,
    termTaxonomy: `it_${suffix}_term_taxonomy`,
    termRelationships: `it_${suffix}_term_relationships`,
    priceZonePolicy: `it_${suffix}_price_zone_policy`
  };

  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.INTEGRATION_DB_HOST || '127.0.0.1',
    port: Number(process.env.INTEGRATION_DB_PORT || 3310),
    username: process.env.INTEGRATION_DB_USER || 'root',
    password: process.env.INTEGRATION_DB_PASSWORD || 'root',
    database: process.env.INTEGRATION_DB_NAME || 'eden_bowls',
    charset: 'utf8mb4',
    timezone: 'Z',
    entities: [],
    migrations: [],
    synchronize: false,
    logging: false
  });

  let repository;
  let priceZonePolicyRepository;

  beforeAll(async () => {
    await dataSource.initialize();

    priceZonePolicyRepository = new PriceZonePolicyRepository(dataSource, {
      tableName: tableNames.priceZonePolicy
    });

    repository = new ProductsRepository(dataSource, {
      postsTableName: tableNames.posts,
      postmetaTableName: tableNames.postmeta,
      termsTableName: tableNames.terms,
      termTaxonomyTableName: tableNames.termTaxonomy,
      termRelationshipsTableName: tableNames.termRelationships,
      priceZonePolicyRepository,
      nowProvider: () => new Date('2026-08-07T00:00:00Z')
    });

    await dataSource.query(
      `CREATE TABLE \`${tableNames.priceZonePolicy}\` (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        country_code VARCHAR(2) NOT NULL,
        currency_code VARCHAR(3) NOT NULL,
        zone_id VARCHAR(64) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        KEY idx_country_currency (country_code, currency_code),
        KEY idx_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await dataSource.query(
      `CREATE TABLE \`${tableNames.posts}\` (
        ID BIGINT PRIMARY KEY,
        post_parent BIGINT NOT NULL DEFAULT 0,
        post_type VARCHAR(32) NOT NULL,
        post_status VARCHAR(20) NOT NULL,
        post_title VARCHAR(255) NOT NULL DEFAULT '',
        post_name VARCHAR(255) NOT NULL DEFAULT '',
        menu_order INT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await dataSource.query(
      `CREATE TABLE \`${tableNames.postmeta}\` (
        meta_id BIGINT PRIMARY KEY AUTO_INCREMENT,
        post_id BIGINT NOT NULL,
        meta_key VARCHAR(255) NOT NULL,
        meta_value LONGTEXT NULL,
        KEY idx_post_id (post_id),
        KEY idx_meta_key (meta_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await dataSource.query(
      `CREATE TABLE \`${tableNames.terms}\` (
        term_id BIGINT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        slug VARCHAR(200) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await dataSource.query(
      `CREATE TABLE \`${tableNames.termTaxonomy}\` (
        term_taxonomy_id BIGINT PRIMARY KEY,
        term_id BIGINT NOT NULL,
        taxonomy VARCHAR(32) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await dataSource.query(
      `CREATE TABLE \`${tableNames.termRelationships}\` (
        object_id BIGINT NOT NULL,
        term_taxonomy_id BIGINT NOT NULL,
        KEY idx_object_id (object_id),
        KEY idx_term_taxonomy_id (term_taxonomy_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );

    await seedData(dataSource, tableNames);
  });

  afterAll(async () => {
    if (dataSource.isInitialized) {
      await dataSource.query(`DROP TABLE IF EXISTS \`${tableNames.priceZonePolicy}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${tableNames.termRelationships}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${tableNames.termTaxonomy}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${tableNames.terms}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${tableNames.postmeta}\``);
      await dataSource.query(`DROP TABLE IF EXISTS \`${tableNames.posts}\``);
      await dataSource.destroy();
    }
  });

  test('returns only products with valid zone pricing and strict stripe setup', async () => {
    const payload = await repository.listByCategory({
      categorySlug: 'flavors',
      country: 'BR',
      currency: 'BRL'
    });

    expect(payload.country).toBe('BR');
    expect(payload.currency).toBe('BRL');
    expect(payload.category).toEqual({ id: 10, slug: 'flavors', name: 'Flavors' });
    expect(payload.empty).toBe(false);
    expect(payload.products).toHaveLength(1);

    expect(payload.products[0]).toEqual({
      product_id: 100,
      name: 'Plano Premium',
      slug: 'plano-premium',
      country: 'BR',
      currency: 'BRL',
      days: 30,
      tags: [{ id: 20, name: 'frango', slug: 'frango' }],
      starting_price: 29.9,
      variations: [
        {
          variation_id: 1001,
          flavor: 'Frango',
          weight: '300g',
          price: 29.9,
          currency: 'BRL'
        }
      ]
    });
  });

  test('throws category_not_found when slug does not exist', async () => {
    await expect(
      repository.listByCategory({
        categorySlug: 'missing-category',
        country: 'BR',
        currency: 'BRL'
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'Category not found.',
      details: { code: 'category_not_found' }
    });
  });
});

async function seedData(dataSource, tableNames) {
  await dataSource.query(
    `INSERT INTO \`${tableNames.terms}\` (term_id, name, slug) VALUES
      (10, 'Flavors', 'flavors'),
      (20, 'frango', 'frango')`
  );

  await dataSource.query(
    `INSERT INTO \`${tableNames.termTaxonomy}\` (term_taxonomy_id, term_id, taxonomy) VALUES
      (100, 10, 'product_cat'),
      (200, 20, 'product_tag')`
  );

  await dataSource.query(
    `INSERT INTO \`${tableNames.posts}\` (ID, post_parent, post_type, post_status, post_title, post_name, menu_order) VALUES
      (100, 0, 'product', 'publish', 'Plano Premium', 'plano-premium', 1),
      (200, 0, 'product', 'publish', 'Plano Sem Preco BRL', 'plano-sem-preco-brl', 2),
      (1001, 100, 'product_variation', 'publish', '', '', 1),
      (1002, 100, 'product_variation', 'publish', '', '', 2),
      (2001, 200, 'product_variation', 'publish', '', '', 1)`
  );

  await dataSource.query(
    `INSERT INTO \`${tableNames.termRelationships}\` (object_id, term_taxonomy_id) VALUES
      (100, 100),
      (100, 200),
      (200, 100)`
  );

  const metaRows = [
    [100, '_cmpb_plan_country', 'BR'],
    [100, '_cmpb_plan_days', '30'],
    [200, '_cmpb_plan_country', 'BR'],
    [200, '_cmpb_plan_days', '15'],

    [1001, '_br_sale_price', '29.90'],
    [1001, '_br_regular_price', '34.90'],
    [1001, '_br_sale_price_dates_from', '1754006400'],
    [1001, '_br_sale_price_dates_to', '1798761600'],
    [1001, '_stripe_product_id', 'prod_abc'],
    [1001, '_stripe_price_id', 'price_123'],
    [1001, '_stripe_price_ids_by_currency', '{"brl":"price_123"}'],
    [1001, 'attribute_pa_flavor', 'Frango'],
    [1001, 'attribute_pa_weight', '300g'],

    [1002, '_br_regular_price', '39.90'],
    [1002, '_stripe_product_id', 'prod_invalid'],
    [1002, '_stripe_price_id', 'not_price_prefix'],
    [1002, '_stripe_price_ids_by_currency', '{"brl":"price_999"}'],
    [1002, 'attribute_pa_flavor', 'Carne'],
    [1002, 'attribute_pa_weight', '400g'],

    [2001, '_us_regular_price', '59.90'],
    [2001, '_stripe_product_id', 'prod_ok'],
    [2001, '_stripe_price_id', 'price_ok'],
    [2001, '_stripe_price_ids_by_currency', '{"usd":"price_ok"}'],
    [2001, 'attribute_pa_flavor', 'Fish'],
    [2001, 'attribute_pa_weight', '500g']
  ];

  for (const [postId, metaKey, metaValue] of metaRows) {
    await dataSource.query(
      `INSERT INTO \`${tableNames.postmeta}\` (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
      [postId, metaKey, metaValue]
    );
  }

  await dataSource.query(
    `INSERT INTO \`${tableNames.priceZonePolicy}\` (country_code, currency_code, zone_id, is_active) VALUES
      ('BR', 'BRL', 'br', 1),
      ('US', 'USD', 'us', 1)`
  );
}
