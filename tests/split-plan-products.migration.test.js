const { planSplit } = require('../src/infrastructure/migrations/helpers/split-plan-products');
const { SplitPlanProducts1700000000075 } = require('../src/infrastructure/migrations/1700000000075-split-plan-products');

const BR_PLAN = { id: 100, market: 'BR', status: 'publish', menuOrder: 1 };

function variation(id, meta, extra = {}) {
  return { id, productId: 100, status: 'publish', menuOrder: id, meta: { _sku: `SKU-${id}`, ...meta }, ...extra };
}

const beef = (id, extra) => variation(id, { _recipe_key: 'beef', _flavor_slug: 'beef', attribute_pa_flavor: 'Bovino', _life_stage: 'adult', ...extra });

const CONTENTS = [
  { market: 'BR', key: 'beef', name: 'Bovino', lifeStage: 'adult' },
  { market: 'BR', key: 'senior-beef', name: 'Bovino Sênior', lifeStage: 'senior' },
  { market: 'BR', key: 'senior-lamb', name: 'Cordeiro Sênior', lifeStage: 'senior' }
];

describe('planSplit (catalog-products deploy split)', () => {
  test('Split of the BR plan product', () => {
    const plan = planSplit({
      products: [BR_PLAN],
      variations: [
        beef(1),
        beef(2),
        variation(3, { _recipe_key: 'senior-beef', _flavor_slug: 'senior-beef', attribute_pa_flavor: 'Bovino Sênior', _life_stage: 'senior' })
      ],
      contents: CONTENTS
    });

    expect(plan.offending).toEqual([]);
    expect(plan.groups.map((group) => [group.key, group.variations.map((item) => item.id)])).toEqual([
      ['beef', [1, 2]],
      ['senior-beef', [3]]
    ]);
    expect(plan.groups[0]).toMatchObject({ market: 'BR', name: 'Bovino', status: 'publish', menuOrder: 1, sourceProductIds: [100] });
    expect(plan.emptiedProductIds).toEqual([100]);
  });

  test('Recipe without variations', () => {
    const plan = planSplit({ products: [BR_PLAN], variations: [beef(1)], contents: CONTENTS });
    expect(plan.drafts.map((draft) => draft.key)).toEqual(['senior-beef', 'senior-lamb']);
    expect(plan.drafts[1]).toEqual({ market: 'BR', key: 'senior-lamb', name: 'Cordeiro Sênior', lifeStage: 'senior' });
  });

  test('a product is published only when one of its variations is', () => {
    const plan = planSplit({ products: [BR_PLAN], variations: [beef(1, {}), { ...beef(2), status: 'draft' }], contents: CONTENTS });
    expect(plan.groups[0].status).toBe('publish');
    const drafts = planSplit({ products: [BR_PLAN], variations: [{ ...beef(1), status: 'draft' }], contents: CONTENTS });
    expect(drafts.groups[0].status).toBe('draft');
  });

  test('Flavor slug differs from the recipe', () => {
    const plan = planSplit({
      products: [BR_PLAN],
      variations: [variation(7, { _recipe_key: 'turkey', _flavor_slug: 'chicken', attribute_pa_flavor: 'Frango' })],
      contents: [{ market: 'BR', key: 'turkey', name: 'Frango', lifeStage: 'adult' }]
    });
    expect(plan.offending).toEqual([{ id: 7, sku: 'SKU-7', reason: 'flavor slug "chicken" differs from recipe key "turkey"' }]);
  });

  test('a variation without a recipe key is refused', () => {
    const plan = planSplit({ products: [BR_PLAN], variations: [variation(8, { attribute_pa_flavor: 'Bovino' })], contents: CONTENTS });
    expect(plan.offending).toEqual([{ id: 8, sku: 'SKU-8', reason: 'no recipe key' }]);
  });

  test('a variation of a product without a market is refused', () => {
    const plan = planSplit({ products: [{ ...BR_PLAN, market: '' }], variations: [beef(9)], contents: CONTENTS });
    expect(plan.offending[0]).toMatchObject({ id: 9, reason: 'its product has no market' });
  });

  test('without a stored flavor slug the key of the flavor label counts', () => {
    const plan = planSplit({
      products: [BR_PLAN],
      variations: [variation(4, { _recipe_key: 'turkey', attribute_pa_flavor: 'Frango' })],
      contents: [{ market: 'BR', key: 'turkey', name: 'Frango', lifeStage: 'adult' }]
    });
    expect(plan.offending).toEqual([]);
    expect(plan.groups[0].key).toBe('turkey');
  });

  test('an unregistered key is registered after its first variation', () => {
    const plan = planSplit({
      products: [{ id: 200, market: 'US', status: 'publish', menuOrder: 2 }],
      variations: [{
        ...variation(20, { _recipe_key: 'senior-beef', _flavor_slug: 'senior-beef', attribute_pa_flavor: 'Beef Recipe for Senior Dogs', _life_stage: 'senior' }),
        productId: 200
      }],
      contents: []
    });
    expect(plan.offending).toEqual([]);
    expect(plan.groups[0]).toMatchObject({ market: 'US', key: 'senior-beef', name: 'Beef Recipe for Senior Dogs', lifeStage: 'senior', registered: true });
    expect(plan.logs[0]).toContain('US senior-beef: recipe was not registered');
  });

  test('Different short labels', () => {
    const plan = planSplit({
      products: [BR_PLAN],
      variations: [beef(1, { _short_label: 'Carne' }), beef(2, { _short_label: 'Bovino' })],
      contents: CONTENTS
    });
    expect(plan.offending).toEqual([]);
    expect(plan.groups[0].shortLabel).toBe('Carne');
    expect(plan.logs).toEqual(['BR beef: variation 2 (SKU SKU-2) had short label "Bovino", now "Carne".']);
  });

  test('an empty short label does not count as a different one', () => {
    const plan = planSplit({
      products: [BR_PLAN],
      variations: [beef(1, { _short_label: '', _flavor_aliases: 'bovino,carne' }), beef(2)],
      contents: CONTENTS
    });
    expect(plan.groups[0]).toMatchObject({ shortLabel: '', aliases: 'bovino,carne' });
    expect(plan.logs).toEqual([]);
  });

  test('Life stage differs from the recipe', () => {
    const plan = planSplit({
      products: [BR_PLAN],
      variations: [variation(3, { _recipe_key: 'senior-beef', _flavor_slug: 'senior-beef', attribute_pa_flavor: 'Bovino Sênior', _life_stage: 'adult' })],
      contents: CONTENTS
    });
    expect(plan.groups[0].lifeStage).toBe('senior');
    expect(plan.logs).toEqual(['BR senior-beef: variation 3 (SKU SKU-3) had life stage "adult", now "senior" from the recipe.']);
  });
});

// Fake query runner: answers the reads of the migration from fixtures and records every statement.
function runner({ products, variations, contents }) {
  const statements = [];
  const metaRows = variations.flatMap((item) => Object.entries(item.meta).map(([metaKey, metaValue]) => ({ postId: item.id, metaKey, metaValue })));
  return {
    statements,
    hasTable: jest.fn(async (name) => name !== 'catalog_split_backup'),
    hasColumn: jest.fn(async () => true),
    query: jest.fn(async (sql, params) => {
      statements.push(sql.trim().split(/\s+/)[0].toUpperCase());
      if (sql.includes("p.post_type = 'product'") && sql.includes('_cmpb_plan_country')) return products;
      if (sql.includes("v.post_type = 'product_variation'")) return variations.map(({ meta, ...row }) => row);
      if (sql.includes('meta_key IN (?)') && sql.startsWith('SELECT')) return metaRows.filter((row) => params[0].includes(row.postId));
      if (sql.includes('FROM `recipe_contents`')) return contents;
      return [];
    })
  };
}

describe('SplitPlanProducts1700000000075', () => {
  test('no change on abort: the refusal lists every offending variation', async () => {
    const queryRunner = runner({
      products: [BR_PLAN],
      variations: [
        variation(7, { _recipe_key: 'turkey', _flavor_slug: 'chicken', attribute_pa_flavor: 'Frango' }),
        variation(8, { attribute_pa_flavor: 'Bovino' })
      ],
      contents: [{ market: 'BR', key: 'turkey', name: 'Frango', lifeStage: 'adult' }]
    });

    await expect(new SplitPlanProducts1700000000075().up(queryRunner, { log: jest.fn() }))
      .rejects.toThrow(/variation 7 \(SKU SKU-7\): flavor slug "chicken" differs[\s\S]*variation 8 \(SKU SKU-8\): no recipe key/);
    expect(queryRunner.statements.every((statement) => statement === 'SELECT')).toBe(true);
  });

  test('does nothing before the content product column exists', async () => {
    const queryRunner = runner({ products: [], variations: [], contents: [] });
    queryRunner.hasColumn.mockResolvedValue(false);
    await new SplitPlanProducts1700000000075().up(queryRunner);
    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  test('a second run does nothing', async () => {
    const queryRunner = runner({ products: [], variations: [], contents: [] });
    queryRunner.hasTable.mockResolvedValue(true);
    await new SplitPlanProducts1700000000075().up(queryRunner);
    expect(queryRunner.query).not.toHaveBeenCalled();
  });
});
