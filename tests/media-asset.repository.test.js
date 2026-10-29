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
      [{ plan_image_asset_id: 12, market: 'BR', flavor_slug: 'beef', name: 'Adulto Carne' }]
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
      [{ id: 12 }],
      [{ plan_image_asset_id: 12, market: 'BR', flavor_slug: 'beef', name: 'Adulto Carne' }],
      [assetRow()],
      [{ plan_image_asset_id: 12, market: 'BR', flavor_slug: 'beef', name: 'Adulto Carne' }]
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
