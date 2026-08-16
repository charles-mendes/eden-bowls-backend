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
    expect(metaByKey.get('1001:attribute_pa_flavor')).toBe('Beef');
    expect(metaByKey.get('1001:attribute_pa_weight')).toBe('300g');
    expect(metaByKey.get('1002:_br_regular_price')).toBe('35.00');
    expect(metaByKey.get('1004:_br_regular_price')).toBe('22.50');
    expect(metaByKey.get('1004:attribute_pa_flavor')).toBe('Turkey');
    expect(metaByKey.get('1008:_br_regular_price')).toBe('42.50');
    expect(metaByKey.get('1008:attribute_pa_weight')).toBe('500g');
    expect(metaByKey.get('2001:_us_regular_price')).toBe('25.00');
    expect(metaByKey.get('2001:attribute_pa_weight')).toBe('10.6oz');
    expect(metaByKey.get('2004:_us_regular_price')).toBe('22.50');
    expect(metaByKey.get('2008:_us_regular_price')).toBe('42.50');
    expect(metaByKey.get('2008:attribute_pa_weight')).toBe('17.6oz');
  });
});
