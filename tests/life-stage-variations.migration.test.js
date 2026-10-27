const { SeedLifeStageVariations1700000000044 } = require('../src/infrastructure/migrations/1700000000044-seed-life-stage-variations');
const { planLifeStageVariations } = require('../src/infrastructure/migrations/helpers/seed-life-stage-variations');

describe('planLifeStageVariations', () => {
  test('an empty market gets the four recipes in both pack sizes with the D-05 prices', () => {
    const { create, skipped } = planLifeStageVariations('BR', []);

    expect(skipped).toEqual([]);
    expect(create.map((item) => [item.key, item.weight, item.price])).toEqual([
      ['puppy-chicken-pork', '300g', 30], ['puppy-chicken-pork', '500g', 35],
      ['puppy-beef-chicken', '300g', 35], ['puppy-beef-chicken', '500g', 40],
      ['senior-beef', '300g', 40], ['senior-beef', '500g', 45],
      ['senior-chicken', '300g', 40], ['senior-chicken', '500g', 45]
    ]);
    expect(create[0]).toMatchObject({
      lifeStage: 'puppy',
      name: 'Receita de Frango e Porco para Filhotes',
      title: 'Receita de Frango e Porco para Filhotes 300g',
      sku: 'PUPPY-CHICKEN-PORK-BR-300G',
      shortLabel: 'Frango e Porco · Filhote',
      aliases: 'filhote-frango-porco',
      zoneId: 'br'
    });
  });

  test('the US uses ounces, English names and short names', () => {
    const { create } = planLifeStageVariations('US', []);

    expect(create.find((item) => item.key === 'senior-chicken' && item.weight === '17.6oz')).toMatchObject({
      price: 45,
      name: 'Chicken Recipe for Senior Dogs',
      sku: 'SENIOR-CHICKEN-US-17_6OZ',
      shortLabel: 'Chicken · Senior',
      zoneId: 'us'
    });
  });

  test('a recipe with both packs already is left alone, and a missing pack is added', () => {
    const { create } = planLifeStageVariations('US', [
      { recipeKey: 'senior-beef', weight: '10.6oz' },
      { recipeKey: 'senior-beef', weight: '17.6 oz' },
      { recipeKey: 'puppy-beef-chicken', weight: '10.6oz' }
    ]);

    expect(create.filter((item) => item.key === 'senior-beef')).toEqual([]);
    expect(create.filter((item) => item.key === 'puppy-beef-chicken').map((item) => item.weight)).toEqual(['17.6oz']);
    expect(create).toHaveLength(5);
  });

  test('a recipe created by hand without a pack weight is skipped and reported', () => {
    const { create, skipped } = planLifeStageVariations('BR', [{ recipeKey: 'senior-beef', weight: null }]);

    expect(create.some((item) => item.key === 'senior-beef')).toBe(false);
    expect(skipped).toEqual([{ market: 'BR', key: 'senior-beef', reason: 'existing variation without weight' }]);
  });
});

// A query runner over in-memory posts and meta, enough for the queries the seed sends.
function memoryRunner({ products = { BR: 100, US: 200 }, variations = [], tables = ['wp_posts', 'wp_postmeta'] } = {}) {
  const posts = [];
  const meta = [];
  for (const [market, id] of Object.entries(products)) {
    posts.push({ ID: id, post_parent: 0, post_type: 'product', post_status: 'publish', menu_order: 0 });
    meta.push({ post_id: id, meta_key: '_cmpb_plan_country', meta_value: market });
  }
  for (const item of variations) {
    posts.push({ ID: item.id, post_parent: item.productId, post_type: 'product_variation', post_status: item.status || 'publish', menu_order: item.menuOrder || 1 });
    for (const [key, value] of Object.entries(item.meta)) meta.push({ post_id: item.id, meta_key: key, meta_value: value });
  }
  const metaOf = (id, key) => (meta.find((row) => row.post_id === id && row.meta_key === key) || {}).meta_value;

  const query = jest.fn(async (sql, params = []) => {
    if (sql.startsWith("SELECT p.`ID` AS id FROM `wp_posts` p")) {
      const product = posts.find((post) => post.post_type === 'product' && metaOf(post.ID, '_cmpb_plan_country') === params[0]);
      return product ? [{ id: product.ID }] : [];
    }
    if (sql.startsWith('SELECT v.`ID` AS id,')) {
      return posts
        .filter((post) => post.post_type === 'product_variation' && post.post_parent === params[0] && post.post_status !== 'trash')
        .map((post) => ({ id: post.ID, recipeKey: metaOf(post.ID, '_recipe_key') || metaOf(post.ID, '_flavor_slug'), weight: metaOf(post.ID, 'attribute_pa_weight') || null }));
    }
    if (sql.startsWith('SELECT COALESCE(MAX(`ID`), 0) + 1 AS nextId')) {
      return [{ nextId: Math.max(0, ...posts.map((post) => post.ID)) + 1 }];
    }
    if (sql.startsWith('SELECT COALESCE(MAX(`menu_order`), 0) + 1 AS nextOrder')) {
      return [{ nextOrder: Math.max(0, ...posts.filter((post) => post.post_parent === params[0]).map((post) => post.menu_order)) + 1 }];
    }
    if (sql.startsWith('INSERT INTO `wp_posts`')) {
      const [ID, post_parent, post_title, post_name, menu_order] = params;
      posts.push({ ID, post_parent, post_type: 'product_variation', post_status: 'draft', post_title, post_name, menu_order });
      return undefined;
    }
    if (sql.startsWith('INSERT INTO `wp_postmeta`')) {
      for (let index = 0; index < params.length; index += 3) {
        meta.push({ post_id: params[index], meta_key: params[index + 1], meta_value: params[index + 2] });
      }
      return undefined;
    }
    if (sql.startsWith('SELECT v.`ID` AS id FROM `wp_posts` v')) {
      return posts
        .filter((post) => post.post_type === 'product_variation' && post.post_status === 'draft' && metaOf(post.ID, params[0]) === params[1])
        .map((post) => ({ id: post.ID }));
    }
    if (sql.startsWith('DELETE FROM `wp_postmeta`')) {
      for (let index = meta.length - 1; index >= 0; index -= 1) if (params.includes(meta[index].post_id)) meta.splice(index, 1);
      return undefined;
    }
    if (sql.startsWith('DELETE FROM `wp_posts`')) {
      for (let index = posts.length - 1; index >= 0; index -= 1) if (params.includes(posts[index].ID)) posts.splice(index, 1);
      return undefined;
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    runner: { hasTable: jest.fn(async (name) => tables.includes(name)), query },
    posts,
    meta,
    metaOf
  };
}

const silent = { log: jest.fn(), warn: jest.fn() };

describe('SeedLifeStageVariations1700000000044', () => {
  afterEach(() => {
    silent.log.mockClear();
    silent.warn.mockClear();
  });

  test('creates the 16 variations inactive, with the meta the admin and the plan read', async () => {
    const { runner, posts, metaOf } = memoryRunner();

    await new SeedLifeStageVariations1700000000044().up(runner, silent);

    const created = posts.filter((post) => post.post_type === 'product_variation');
    expect(created).toHaveLength(16);
    expect(created.every((post) => post.post_status === 'draft')).toBe(true);
    expect(created.filter((post) => post.post_parent === 100)).toHaveLength(8);
    const seniorBeefUsSmall = created.find((post) => metaOf(post.ID, '_sku') === 'SENIOR-BEEF-US-10_6OZ');
    expect(seniorBeefUsSmall).toMatchObject({ post_parent: 200, post_title: 'Beef Recipe for Senior Dogs 10.6oz' });
    expect({
      flavor: metaOf(seniorBeefUsSmall.ID, 'attribute_pa_flavor'),
      weight: metaOf(seniorBeefUsSmall.ID, 'attribute_pa_weight'),
      slug: metaOf(seniorBeefUsSmall.ID, '_flavor_slug'),
      aliases: metaOf(seniorBeefUsSmall.ID, '_flavor_aliases'),
      lifeStage: metaOf(seniorBeefUsSmall.ID, '_life_stage'),
      recipeKey: metaOf(seniorBeefUsSmall.ID, '_recipe_key'),
      shortLabel: metaOf(seniorBeefUsSmall.ID, '_short_label'),
      price: metaOf(seniorBeefUsSmall.ID, '_regular_price'),
      zonePrice: metaOf(seniorBeefUsSmall.ID, '_us_regular_price')
    }).toEqual({
      flavor: 'Beef Recipe for Senior Dogs',
      weight: '10.6oz',
      slug: 'senior-beef',
      aliases: 'senior-carne',
      lifeStage: 'senior',
      recipeKey: 'senior-beef',
      shortLabel: 'Beef · Senior',
      price: '40.00',
      zonePrice: '40.00'
    });
    expect(metaOf(seniorBeefUsSmall.ID, '_stripe_price_id')).toBeUndefined();
    expect(new Set(created.map((post) => post.ID)).size).toBe(16);
  });

  test('a second run creates nothing', async () => {
    const { runner, posts } = memoryRunner();
    const migration = new SeedLifeStageVariations1700000000044();

    await migration.up(runner, silent);
    await migration.up(runner, silent);

    expect(posts.filter((post) => post.post_type === 'product_variation')).toHaveLength(16);
  });

  test('keeps variations created by hand and only fills what is missing', async () => {
    const { runner, posts } = memoryRunner({
      variations: [
        { id: 2015, productId: 100, meta: { _recipe_key: 'senior-beef', _flavor_slug: 'senior-beef' } },
        { id: 2301, productId: 200, meta: { _recipe_key: 'puppy-beef-chicken', attribute_pa_weight: '10.6oz' } }
      ]
    });

    await new SeedLifeStageVariations1700000000044().up(runner, silent);

    const seeded = posts.filter((post) => post.post_status === 'draft');
    expect(seeded).toHaveLength(13);
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('BR senior-beef: skipped'));
    expect(posts.find((post) => post.ID === 2015).post_status).toBe('publish');
  });

  test('a market without a plan product is skipped', async () => {
    const { runner, posts } = memoryRunner({ products: { BR: 100 } });

    await new SeedLifeStageVariations1700000000044().up(runner, silent);

    expect(posts.filter((post) => post.post_type === 'product_variation')).toHaveLength(8);
    expect(silent.warn).toHaveBeenCalledWith(expect.stringContaining('US: no plan product'));
  });

  test('down removes only the seeded variations still inactive', async () => {
    const { runner, posts, meta } = memoryRunner({
      variations: [{ id: 2015, productId: 100, status: 'draft', meta: { _recipe_key: 'senior-beef' } }]
    });
    const migration = new SeedLifeStageVariations1700000000044();
    await migration.up(runner, silent);
    const activated = posts.find((post) => post.post_title === 'Receita de Frango para Cães Sênior 300g');
    activated.post_status = 'publish';

    await migration.down(runner);

    const left = posts.filter((post) => post.post_type === 'product_variation').map((post) => post.ID);
    expect(left.sort((a, b) => a - b)).toEqual([2015, activated.ID].sort((a, b) => a - b));
    expect(meta.some((row) => row.meta_key === '_seeded_by' && row.post_id !== activated.ID)).toBe(false);
  });

  test('does nothing without the catalog tables', async () => {
    const { runner } = memoryRunner({ tables: [] });

    await new SeedLifeStageVariations1700000000044().up(runner, silent);

    expect(runner.query).not.toHaveBeenCalled();
  });
});
