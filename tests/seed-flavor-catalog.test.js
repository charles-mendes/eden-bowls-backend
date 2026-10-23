const { seedFlavorCatalog } = require('../src/infrastructure/migrations/helpers/seed-flavor-catalog');

describe('seedFlavorCatalog', () => {
  test('writes current Brazil and United States flavor prices into catalog meta', async () => {
    const queryRunner = {
      query: jest.fn().mockResolvedValue(undefined)
    };

    await seedFlavorCatalog(queryRunner);

    const statements = queryRunner.query.mock.calls.map(([sql, params]) => ({
      sql,
      params: params || []
    }));
    const metaInsert = statements.find((statement) => statement.sql.includes('INSERT INTO `wp_postmeta`'));

    expect(metaInsert).toBeDefined();

    const metaByKey = new Map();
    for (let index = 0; index < metaInsert.params.length; index += 3) {
      const postId = metaInsert.params[index];
      const key = metaInsert.params[index + 1];
      const value = metaInsert.params[index + 2];
      metaByKey.set(`${postId}:${key}`, value);
    }

    expect(metaByKey.get('100:_cmpb_plan_country')).toBe('BR');
    expect(metaByKey.get('200:_cmpb_plan_country')).toBe('US');
    expect(metaByKey.get('1001:_br_regular_price')).toBe('25.00');
    expect(metaByKey.get('1001:attribute_pa_flavor')).toBe('Bovino');
    expect(metaByKey.get('1001:_flavor_slug')).toBe('beef');
    expect(metaByKey.get('1001:attribute_pa_weight')).toBe('300g');
    expect(metaByKey.get('1002:_br_regular_price')).toBe('35.00');
    expect(metaByKey.get('1004:_br_regular_price')).toBe('22.50');
    expect(metaByKey.get('1004:attribute_pa_flavor')).toBe('Frango');
    expect(metaByKey.get('1004:_flavor_slug')).toBe('turkey');
    expect(metaByKey.get('1004:_flavor_aliases')).toBe('chicken,frango,peru');
    expect(metaByKey.get('1004:_stripe_product_id')).toBe('prod_seed_br_turkey_300g');
    expect(metaByKey.get('1008:_br_regular_price')).toBe('42.50');
    expect(metaByKey.get('1008:attribute_pa_weight')).toBe('500g');
    expect(metaByKey.get('2001:_us_regular_price')).toBe('25.00');
    expect(metaByKey.get('2001:attribute_pa_weight')).toBe('10.6oz');
    expect(metaByKey.get('2004:_us_regular_price')).toBe('22.50');
    expect(metaByKey.get('2004:attribute_pa_flavor')).toBe('Chicken');
    expect(metaByKey.get('2004:_stripe_product_id')).toBe('prod_seed_us_turkey_10_6oz');
    expect(metaByKey.get('2008:_us_regular_price')).toBe('42.50');
    expect(metaByKey.get('2008:attribute_pa_weight')).toBe('17.6oz');
  });

  // Subscriptions and Stripe prices point at these IDs. New recipes are created in the admin, never by
  // appending to FLAVOR_KEYS, which would renumber every 500g and 17.6oz variation below.
  test('keeps the seeded variation IDs of every flavor and pack size', async () => {
    const queryRunner = {
      query: jest.fn().mockResolvedValue(undefined)
    };

    await seedFlavorCatalog(queryRunner);

    const metaInsert = queryRunner.query.mock.calls
      .map(([sql, params]) => ({ sql, params: params || [] }))
      .find((statement) => statement.sql.includes('INSERT INTO `wp_postmeta`'));
    const slugById = {};
    const weightById = {};
    for (let index = 0; index < metaInsert.params.length; index += 3) {
      const [postId, key, value] = metaInsert.params.slice(index, index + 3);
      if (key === '_flavor_slug') slugById[postId] = value;
      if (key === 'attribute_pa_weight') weightById[postId] = value;
    }
    const seeded = Object.keys(slugById)
      .map(Number)
      .sort((a, b) => a - b)
      .map((id) => `${id}:${slugById[id]}:${weightById[id]}`);

    expect(seeded).toEqual([
      '1001:beef:300g', '1002:fish:300g', '1003:pork:300g', '1004:turkey:300g',
      '1005:beef:500g', '1006:fish:500g', '1007:pork:500g', '1008:turkey:500g',
      '2001:beef:10.6oz', '2002:fish:10.6oz', '2003:pork:10.6oz', '2004:turkey:10.6oz',
      '2005:beef:17.6oz', '2006:fish:17.6oz', '2007:pork:17.6oz', '2008:turkey:17.6oz'
    ]);
  });
});
