const { RecipeContentRepository } = require('../src/infrastructure/repositories/recipe-content.repository');

function row(overrides = {}) {
  return {
    market: 'BR',
    flavor_slug: 'senior-beef',
    image_url: 'https://api.example/recipe-images/recipe-br-senior-beef-abc.webp',
    image_updated_at: new Date('2026-10-23T12:00:00.000Z'),
    label: null,
    label_updated_at: null,
    ...overrides
  };
}

function dataSourceReturning(...results) {
  const query = jest.fn();
  for (const result of results) {
    query.mockResolvedValueOnce(result);
  }
  return { isInitialized: true, query };
}

describe('RecipeContentRepository', () => {
  test('Two sizes share one image: the image is written on the product row', async () => {
    const dataSource = dataSourceReturning([], [row({ product_id: 500 })]);
    const repository = new RecipeContentRepository(dataSource);

    const content = await repository.setImage({ productId: '500', imageUrl: row().image_url, actorId: 7 });

    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).toContain('SET image_url = ?, image_updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE product_id = ?');
    expect(params).toEqual([row().image_url, 7, 500]);
    expect(dataSource.query.mock.calls[1][1]).toEqual([500]);
    expect(content).toMatchObject({ productId: '500', market: 'BR', flavorSlug: 'senior-beef', imageUrl: row().image_url, label: null });
  });

  test('reads one market only, so BR and US content of the same flavor stay apart', async () => {
    const dataSource = dataSourceReturning([row({ market: 'US', flavor_slug: 'beef', label: '{"ingredients":["Beef"]}' })]);
    const repository = new RecipeContentRepository(dataSource);

    const content = await repository.findByMarketAndSlug('us', 'beef');

    expect(dataSource.query.mock.calls[0][0]).toContain('WHERE market = ? AND flavor_slug = ?');
    expect(dataSource.query.mock.calls[0][1]).toEqual(['US', 'beef']);
    expect(content).toMatchObject({ market: 'US', flavorSlug: 'beef', label: { ingredients: ['Beef'] } });
  });

  test('loads several flavors of a market in one query, keyed by slug', async () => {
    const dataSource = dataSourceReturning([row(), row({ flavor_slug: 'senior-chicken', image_url: null })]);
    const repository = new RecipeContentRepository(dataSource);

    const contents = await repository.findByMarketAndSlugs('BR', ['senior-beef', 'senior-chicken', 'senior-beef', '']);

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query.mock.calls[0][1]).toEqual(['BR', 'senior-beef', 'senior-chicken']);
    expect(contents.get('senior-beef').imageUrl).toBe(row().image_url);
    expect(contents.get('senior-chicken').imageUrl).toBeNull();
  });

  test('skips the query when no flavor is asked', async () => {
    const dataSource = dataSourceReturning();
    const contents = await new RecipeContentRepository(dataSource).findByMarketAndSlugs('BR', []);
    expect(contents.size).toBe(0);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  test('clears the image of one product', async () => {
    const dataSource = dataSourceReturning([], [row({ image_url: null })]);
    const content = await new RecipeContentRepository(dataSource).setImage({ productId: 500, imageUrl: null, actorId: 7 });

    expect(dataSource.query.mock.calls[0][1]).toEqual([null, 7, 500]);
    expect(content.imageUrl).toBeNull();
  });

  test('sets and clears the plan thumbnail apart from the banner', async () => {
    const dataSource = dataSourceReturning(
      [], [row({ plan_image_url: '/recipe-images/recipe-br-senior-beef-plan-1.webp' })],
      [], [row({ plan_image_url: null })]
    );
    const repository = new RecipeContentRepository(dataSource);

    const set = await repository.setPlanImage({ productId: 500, imageUrl: '/recipe-images/recipe-br-senior-beef-plan-1.webp', actorId: 7 });
    const cleared = await repository.setPlanImage({ productId: 500, imageUrl: null, actorId: 7 });

    expect(dataSource.query.mock.calls[0][0]).toContain('SET plan_image_url = ?, plan_image_updated_at = CURRENT_TIMESTAMP');
    expect(dataSource.query.mock.calls[0][1]).toEqual(['/recipe-images/recipe-br-senior-beef-plan-1.webp', 7, 500]);
    expect(dataSource.query.mock.calls[2][1]).toEqual([null, 7, 500]);
    expect(set.planImageUrl).toBe('/recipe-images/recipe-br-senior-beef-plan-1.webp');
    expect(cleared.planImageUrl).toBeNull();
  });

  test('stores the label as JSON on the product row', async () => {
    const label = { ingredients: ['Beef'], analysis: [], notices: [] };
    const dataSource = dataSourceReturning([], [row({ market: 'US', flavor_slug: 'beef', label: JSON.stringify(label) })]);

    const content = await new RecipeContentRepository(dataSource).setLabel({ productId: 610, label, actorId: 7 });

    expect(dataSource.query.mock.calls[0][0]).toContain('SET label = ?, label_updated_at = CURRENT_TIMESTAMP');
    expect(dataSource.query.mock.calls[0][1]).toEqual([JSON.stringify(label), 7, 610]);
    expect(content.label).toEqual(label);
  });

  test('replaces the presentation of a product as JSON', async () => {
    const presentation = { title: 'Beef Recipe', highlights: ['Beef'], colors: { color: '#C97B6C' } };
    const updatedAt = new Date('2026-10-27T12:00:00.000Z');
    const dataSource = dataSourceReturning([], [row({ market: 'US', flavor_slug: 'beef', presentation: JSON.stringify(presentation), presentation_updated_at: updatedAt })]);

    const content = await new RecipeContentRepository(dataSource).setPresentation({ productId: 610, presentation, actorId: 7 });

    expect(dataSource.query.mock.calls[0][0]).toMatch(/^UPDATE .* SET presentation = \?/);
    expect(dataSource.query.mock.calls[0][1]).toEqual([JSON.stringify(presentation), 7, 610]);
    expect(content).toMatchObject({ presentation, presentationUpdatedAt: updatedAt.toISOString() });
  });

  test('creates, updates, lists and deletes the content of a product', async () => {
    const dataSource = dataSourceReturning(
      [], [row({ product_id: 900, flavor_slug: 'senior-duck', name: 'Sênior Pato', image_url: null })],
      [], [row({ product_id: 900, flavor_slug: 'senior-duck', name: 'Pato Sênior', short_label: 'Pato', image_url: null })],
      [row({ flavor_slug: 'senior-duck', name: 'Pato Sênior', image_url: null }), row({ name: '' })],
      []
    );
    const repository = new RecipeContentRepository(dataSource);

    const created = await repository.createForProduct({ productId: '900', market: 'br', flavorSlug: 'senior-duck', name: 'Sênior Pato', lifeStage: 'senior', actorId: 7 });
    const renamed = await repository.updateProductFields(900, { name: 'Pato Sênior', shortLabel: 'Pato', flavorAliases: '', actorId: 7 });
    const listed = await repository.listByMarket('br');
    await repository.deleteByProductId('900');

    expect(dataSource.query.mock.calls[0]).toEqual([
      expect.stringContaining('(product_id, market, flavor_slug, name, life_stage, flavor_aliases, short_label, updated_by)'),
      [900, 'BR', 'senior-duck', 'Sênior Pato', 'senior', null, null, 7]
    ]);
    expect(created).toMatchObject({ productId: '900', name: 'Sênior Pato' });
    expect(dataSource.query.mock.calls[2]).toEqual([
      expect.stringContaining('SET name = ?, flavor_aliases = ?, short_label = ?, updated_by = ? WHERE product_id = ?'),
      ['Pato Sênior', null, 'Pato', 7, 900]
    ]);
    expect(renamed).toMatchObject({ name: 'Pato Sênior', shortLabel: 'Pato' });
    expect(dataSource.query.mock.calls[4][1]).toEqual(['BR']);
    expect(listed.map((item) => [item.flavorSlug, item.name])).toEqual([['senior-duck', 'Pato Sênior'], ['senior-beef', 'senior-beef']]);
    expect(dataSource.query.mock.calls[5]).toEqual([expect.stringContaining('DELETE FROM `recipe_contents` WHERE product_id = ?'), [900]]);
  });
});
