const { MediaAssetRepository } = require('../src/infrastructure/repositories/media-asset.repository');

function assetRow(overrides = {}) {
  return {
    id: 12,
    kind: 'plan',
    market: 'BR',
    url: '/recipe-images/plan-br-0123456789abcdef0123456789abcdef.webp',
    original_filename: 'adulto-carne_400.png',
    mime_type: 'image/webp',
    width: 400,
    height: 400,
    bytes: 41000,
    uploaded_by: 7,
    created_at: new Date('2026-10-28T12:00:00.000Z'),
    archived_at: null,
    ...overrides
  };
}

function dataSourceReturning(...results) {
  const query = jest.fn();
  for (const result of results) {
    query.mockResolvedValueOnce(result);
  }
  return { isInitialized: true, query, transaction: jest.fn(async (work) => work({ query })) };
}

describe('MediaAssetRepository', () => {
  test('lists one market and kind, without archived images, with the recipes using each', async () => {
    const dataSource = dataSourceReturning(
      [assetRow(), assetRow({ id: 13, original_filename: 'adulto-frango_400.png' })],
      [{ asset_id: 12, market: 'BR', flavor_slug: 'beef', name: 'Adulto Carne' }]
    );
    const repository = new MediaAssetRepository(dataSource);

    const items = await repository.list({ market: 'br', kind: 'plan' });

    const [listSql, listParams] = dataSource.query.mock.calls[0];
    expect(listSql).toContain('archived_at IS NULL');
    expect(listSql).toContain('ORDER BY created_at DESC');
    expect(listParams).toEqual(['BR', 'plan']);
    expect(dataSource.query.mock.calls[1][1]).toEqual([12, 13]);
    expect(items).toEqual([
      expect.objectContaining({ id: 12, archived: false, usedBy: [{ key: 'beef', name: 'Adulto Carne', market: 'BR' }] }),
      expect.objectContaining({ id: 13, originalFilename: 'adulto-frango_400.png', usedBy: [] })
    ]);
  });

  test('a banner is used through the recipe banner, not through a plan thumbnail with the same id', async () => {
    const dataSource = dataSourceReturning(
      [assetRow({ id: 31, kind: 'banner', original_filename: 'filhote-frango-porco.png', width: 1024, height: 636 })],
      [{ asset_id: 31, market: 'BR', flavor_slug: 'puppy-chicken-pork', name: 'Filhote Frango e Porco' }]
    );

    const [banner] = await new MediaAssetRepository(dataSource).list({ market: 'BR', kind: 'banner' });

    const [usedBySql, usedByParams] = dataSource.query.mock.calls[1];
    expect(usedBySql).toContain('image_asset_id IN');
    expect(usedBySql).not.toContain('plan_image_asset_id');
    expect(usedByParams).toEqual([31]);
    expect(banner).toMatchObject({ kind: 'banner', usedBy: [{ key: 'puppy-chicken-pork', name: 'Filhote Frango e Porco', market: 'BR' }] });
  });

  test('a plan image reads its users from the plan thumbnail column only', async () => {
    const dataSource = dataSourceReturning([assetRow()], []);
    await new MediaAssetRepository(dataSource).list({ market: 'BR', kind: 'plan' });
    expect(dataSource.query.mock.calls[1][0]).toContain('plan_image_asset_id IN');
    expect(dataSource.query).toHaveBeenCalledTimes(2);
  });

  test('archive refuses a banner in use by its recipe banner', async () => {
    const used = [{ asset_id: 31, market: 'BR', flavor_slug: 'senior-beef', name: 'Sênior Carne' }];
    const dataSource = dataSourceReturning([{ id: 31, kind: 'banner' }], used, [assetRow({ id: 31, kind: 'banner' })], used);

    const asset = await new MediaAssetRepository(dataSource).archive(31);

    expect(dataSource.query.mock.calls[1][0]).toContain('image_asset_id IN');
    expect(dataSource.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
    expect(asset).toMatchObject({ archived: false, usedBy: [{ key: 'senior-beef' }] });
  });

  test('lists only archived images when asked', async () => {
    const dataSource = dataSourceReturning([]);
    await new MediaAssetRepository(dataSource).list({ market: 'US', kind: 'plan', archived: true });
    expect(dataSource.query.mock.calls[0][0]).toContain('archived_at IS NOT NULL');
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  test('insert returns null when the same bytes already exist in the market', async () => {
    const duplicate = Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    const dataSource = { isInitialized: true, query: jest.fn().mockRejectedValueOnce(duplicate) };

    const asset = await new MediaAssetRepository(dataSource).insert({
      kind: 'plan', market: 'BR', url: 'x', originalFilename: 'a.png', mimeType: 'image/webp', width: 400, height: 400, bytes: 1, sha256: 'a'.repeat(64)
    });

    expect(asset).toBeNull();
  });

  test('archive leaves an image in use as is and returns its users', async () => {
    const dataSource = dataSourceReturning(
      [{ id: 12, kind: 'plan' }],
      [{ asset_id: 12, market: 'BR', flavor_slug: 'beef', name: 'Adulto Carne' }],
      [assetRow()],
      [{ asset_id: 12, market: 'BR', flavor_slug: 'beef', name: 'Adulto Carne' }]
    );

    const asset = await new MediaAssetRepository(dataSource).archive(12);

    expect(dataSource.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(dataSource.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
    expect(asset).toMatchObject({ archived: false, usedBy: [{ key: 'beef' }] });
  });

  test('has no way to delete an image', () => {
    const methods = Object.getOwnPropertyNames(MediaAssetRepository.prototype);
    expect(methods.filter((name) => /delete|remove|destroy/i.test(name))).toEqual([]);
  });
});
