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

// A transaction that locks the library image row, then updates the product row; the read-back goes to the data source.
function linkingDataSource(assetRows, readBack) {
  const manager = { query: jest.fn() };
  if (assetRows) manager.query.mockResolvedValueOnce(assetRows);
  manager.query.mockResolvedValueOnce([]);
  return {
    isInitialized: true,
    manager,
    transaction: jest.fn(async (work) => work(manager)),
    query: jest.fn().mockResolvedValueOnce(readBack)
  };
}

const URL = 'https://api.example/recipe-images/recipe-br-senior-beef-abc.webp';

describe('RecipeContentRepository', () => {
  test('Two sizes share one image: the banner link is written on the product row, after locking the image', async () => {
    const dataSource = linkingDataSource([{ url: URL, archived_at: null }], [row({ product_id: 500, image_url: URL, image_asset_id: 31 })]);

    const content = await new RecipeContentRepository(dataSource).setImage({ productId: '500', assetId: 31, actorId: 7 });

    expect(dataSource.manager.query.mock.calls[0]).toEqual([expect.stringContaining('FROM `media_assets` WHERE id = ? FOR UPDATE'), [31]]);
    const [sql, params] = dataSource.manager.query.mock.calls[1];
    expect(sql).toContain('SET image_url = ?, image_asset_id = ?, image_updated_at = CURRENT_TIMESTAMP, updated_by = ?');
    expect(sql).toContain('WHERE product_id = ?');
    expect(params).toEqual([URL, 31, 7, 500]);
    expect(dataSource.query.mock.calls[0][1]).toEqual([500]);
    expect(content).toMatchObject({ productId: '500', flavorSlug: 'senior-beef', imageUrl: URL, imageAssetId: 31 });
  });

  test('refuses an archived image and an unknown one, writing nothing', async () => {
    const archived = linkingDataSource([{ url: URL, archived_at: new Date() }], []);
    await expect(new RecipeContentRepository(archived).setImage({ productId: 500, assetId: 31 }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'media_asset_archived' } });
    expect(archived.manager.query).toHaveBeenCalledTimes(1);

    const unknown = linkingDataSource([], []);
    await expect(new RecipeContentRepository(unknown).setPlanImage({ productId: 500, assetId: 99 }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(unknown.manager.query).toHaveBeenCalledTimes(1);
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

  test('unlinks the banner of one product without reading any image', async () => {
    const dataSource = linkingDataSource(null, [row({ image_url: null })]);
    const content = await new RecipeContentRepository(dataSource).setImage({ productId: 500, assetId: null, actorId: 7 });

    expect(dataSource.manager.query).toHaveBeenCalledTimes(1);
    expect(dataSource.manager.query.mock.calls[0][1]).toEqual([null, null, 7, 500]);
    expect(content.imageUrl).toBeNull();
    expect(content.imageAssetId).toBeNull();
  });

  test('links the plan thumbnail apart from the banner', async () => {
    const planUrl = '/recipe-images/recipe-br-plan-1.webp';
    const dataSource = linkingDataSource([{ url: planUrl, archived_at: null }], [row({ plan_image_url: planUrl, plan_image_asset_id: 12 })]);

    const set = await new RecipeContentRepository(dataSource).setPlanImage({ productId: 500, assetId: 12, actorId: 7 });

    const [sql, params] = dataSource.manager.query.mock.calls[1];
    expect(sql).toContain('SET plan_image_url = ?, plan_image_asset_id = ?, plan_image_updated_at = CURRENT_TIMESTAMP');
    expect(sql).not.toContain(' image_url = ?, image_asset_id');
    expect(params).toEqual([planUrl, 12, 7, 500]);
    expect(set).toMatchObject({ planImageUrl: planUrl, planImageAssetId: 12 });
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
