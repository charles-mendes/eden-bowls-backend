const { ProfileRepository } = require('../src/infrastructure/repositories/profile.repository');
const { PROFILE_MARKET_META_KEY } = require('../src/core/admin-market-scope');

describe('ProfileRepository market stamp', () => {
  test('writes hsr_market_country only when it is empty', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ insertId: 1 })
    };
    const repository = new ProfileRepository(dataSource);

    expect(await repository.stampProfileMarketOnce(7, 'BR')).toBe('BR');
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `wp_usermeta`'),
      [7, PROFILE_MARKET_META_KEY, 'BR']
    );
  });

  test('keeps an existing BR market when a later US address is saved', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValueOnce([{ meta_value: 'BR' }])
    };
    const repository = new ProfileRepository(dataSource);

    expect(await repository.stampProfileMarketOnce(7, 'US')).toBe('BR');
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query.mock.calls[0][0]).toContain('SELECT');
  });
});
