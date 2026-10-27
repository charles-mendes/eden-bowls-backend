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
  test('upserts the image on the market and flavor key, so a second upload updates the same row', async () => {
    const dataSource = dataSourceReturning([], [row()], [], [row({ image_url: 'https://api.example/recipe-images/new.webp' })]);
    const repository = new RecipeContentRepository(dataSource);

    const first = await repository.upsertImage({ market: 'br', flavorSlug: 'senior-beef', imageUrl: row().image_url, actorId: 7 });
    const second = await repository.upsertImage({ market: 'BR', flavorSlug: 'senior-beef', imageUrl: 'https://api.example/recipe-images/new.webp', actorId: 7 });

    const [insertSql, insertParams] = dataSource.query.mock.calls[0];
    expect(insertSql).toContain('ON DUPLICATE KEY UPDATE image_url = VALUES(image_url)');
    expect(insertParams).toEqual(['BR', 'senior-beef', row().image_url, 7]);
    expect(first).toMatchObject({ market: 'BR', flavorSlug: 'senior-beef', imageUrl: row().image_url, label: null });
    expect(second.imageUrl).toBe('https://api.example/recipe-images/new.webp');
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

  test('clears the image of one market and flavor', async () => {
    const dataSource = dataSourceReturning([], [row({ image_url: null })]);
    const content = await new RecipeContentRepository(dataSource).clearImage({ market: 'BR', flavorSlug: 'senior-beef', actorId: 7 });

    expect(dataSource.query.mock.calls[0][0]).toContain('SET image_url = NULL');
    expect(dataSource.query.mock.calls[0][1]).toEqual([7, 'BR', 'senior-beef']);
    expect(content.imageUrl).toBeNull();
  });

  test('stores the label as JSON on the market and flavor key', async () => {
    const label = { ingredients: ['Beef'], analysis: [], notices: [] };
    const dataSource = dataSourceReturning([], [row({ market: 'US', flavor_slug: 'beef', label: JSON.stringify(label) })]);

    const content = await new RecipeContentRepository(dataSource).upsertLabel({ market: 'us', flavorSlug: 'beef', label, actorId: 7 });

    expect(dataSource.query.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE label = VALUES(label)');
    expect(dataSource.query.mock.calls[0][1]).toEqual(['US', 'beef', JSON.stringify(label), 7]);
    expect(content.label).toEqual(label);
  });

  test('registers, renames, lists and deletes a recipe of one market', async () => {
    const dataSource = dataSourceReturning(
      [], [row({ flavor_slug: 'senior-duck', name: 'Sênior Pato', image_url: null })],
      [], [row({ flavor_slug: 'senior-duck', name: 'Pato Sênior', image_url: null })],
      [row({ flavor_slug: 'senior-duck', name: 'Pato Sênior', image_url: null }), row({ name: '' })],
      []
    );
    const repository = new RecipeContentRepository(dataSource);

    const created = await repository.createRecipe({ market: 'br', flavorSlug: 'senior-duck', name: 'Sênior Pato', lifeStage: 'senior', actorId: 7 });
    const renamed = await repository.updateRecipe({ market: 'BR', flavorSlug: 'senior-duck', name: 'Pato Sênior', actorId: 7 });
    const listed = await repository.listByMarket('br');
    await repository.deleteRecipe({ market: 'BR', flavorSlug: 'senior-duck' });

    expect(dataSource.query.mock.calls[0]).toEqual([expect.stringContaining('(market, flavor_slug, name, life_stage, updated_by)'), ['BR', 'senior-duck', 'Sênior Pato', 'senior', 7]]);
    expect(created.name).toBe('Sênior Pato');
    expect(dataSource.query.mock.calls[2][1]).toEqual(['Pato Sênior', 7, 'BR', 'senior-duck']);
    expect(renamed.name).toBe('Pato Sênior');
    expect(dataSource.query.mock.calls[4][1]).toEqual(['BR']);
    expect(listed.map((item) => [item.flavorSlug, item.name])).toEqual([['senior-duck', 'Pato Sênior'], ['senior-beef', 'senior-beef']]);
    expect(dataSource.query.mock.calls[5]).toEqual([expect.stringContaining('DELETE FROM `recipe_contents` WHERE market = ? AND flavor_slug = ?'), ['BR', 'senior-duck']]);
  });
});
