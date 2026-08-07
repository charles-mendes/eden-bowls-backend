const { BreedsRepository } = require('../src/infrastructure/repositories/breeds.repository');

describe('BreedsRepository', () => {
  test('returns an empty list when the table does not exist', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce({ code: 'ER_NO_SUCH_TABLE', errno: 1146, message: "Table 'eden_bowls.wp_hsr_breeds' doesn't exist" })
    };

    const repository = new BreedsRepository(dataSource, { tableName: 'wp_hsr_breeds' });
    const items = await repository.search('malt', 'en', 12);

    expect(items).toEqual([]);
  });
});