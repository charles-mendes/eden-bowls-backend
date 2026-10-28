const { AddVariationLifeStage1700000000034 } = require('../src/infrastructure/migrations/1700000000034-add-variation-life-stage');

function queryRunner({ hasTable = true } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    query: jest.fn().mockResolvedValue(undefined)
  };
}

describe('AddVariationLifeStage1700000000034', () => {
  test('tags flavor variations without a line as adult and leaves tagged ones alone', async () => {
    const runner = queryRunner();
    await new AddVariationLifeStage1700000000034().up(runner);

    const [sql, params] = runner.query.mock.calls[0];
    expect(sql).toMatch(/^INSERT INTO `wp_postmeta`/);
    expect(sql).toMatch(/'product_variation'/);
    expect(sql).toMatch(/NOT EXISTS/);
    expect(params).toEqual(['_life_stage', 'flavors', '_life_stage']);
  });

  test('down removes the line meta', async () => {
    const runner = queryRunner();
    await new AddVariationLifeStage1700000000034().down(runner);

    const [sql, params] = runner.query.mock.calls[0];
    expect(sql).toBe('DELETE FROM `wp_postmeta` WHERE `meta_key` = ?');
    expect(params).toEqual(['_life_stage']);
  });

  test('skips a database without the catalog tables', async () => {
    const runner = queryRunner({ hasTable: false });
    await new AddVariationLifeStage1700000000034().up(runner);
    expect(runner.query).not.toHaveBeenCalled();
  });
});
