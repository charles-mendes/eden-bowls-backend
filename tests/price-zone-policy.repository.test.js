const { PriceZonePolicyRepository } = require('../src/infrastructure/repositories/price-zone-policy.repository');

describe('PriceZonePolicyRepository', () => {
  test('returns zone id for active country/currency policy', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{ zone_id: 'br' }])
    };

    const repository = new PriceZonePolicyRepository(dataSource, { tableName: 'price_zone_policy' });
    const zoneId = await repository.findActiveZoneId('br', 'brl');

    expect(zoneId).toBe('br');
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM `price_zone_policy`'),
      ['BR', 'BRL']
    );
  });

  test('returns null when no policy exists', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([])
    };

    const repository = new PriceZonePolicyRepository(dataSource);
    await expect(repository.findActiveZoneId('US', 'USD')).resolves.toBeNull();
  });

  test('throws 503 when datasource is not initialized', async () => {
    const repository = new PriceZonePolicyRepository({ isInitialized: false, query: jest.fn() });

    await expect(repository.findActiveZoneId('BR', 'BRL')).rejects.toMatchObject({
      statusCode: 503,
      message: 'Database connection is not initialized.'
    });
  });
});
