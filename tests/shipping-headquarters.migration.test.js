const { AddShippingHeadquartersAddressFields1700000000031 } = require('../src/infrastructure/migrations/1700000000031-add-shipping-headquarters-address-fields');

describe('AddShippingHeadquartersAddressFields1700000000031', () => {
  test('adds the address columns and moves the old 500 km seed to 50 km', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(true),
      hasColumn: jest.fn().mockResolvedValue(false),
      query: jest.fn().mockResolvedValue(undefined)
    };

    await new AddShippingHeadquartersAddressFields1700000000031().up(queryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement);
    expect(sql).toEqual(expect.arrayContaining([
      expect.stringContaining('ADD COLUMN `center_number`'),
      expect.stringContaining('ADD COLUMN `center_complement`'),
      expect.stringContaining('ADD COLUMN `center_neighborhood`'),
      expect.stringContaining('ADD COLUMN `ship_from_street2`')
    ]));
    expect(queryRunner.query).toHaveBeenCalledWith(expect.stringContaining('SET `max_distance_km` = ?'), [50, 500]);
  });

  test('skips columns that already exist', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(true),
      hasColumn: jest.fn().mockResolvedValue(true),
      query: jest.fn().mockResolvedValue(undefined)
    };

    await new AddShippingHeadquartersAddressFields1700000000031().up(queryRunner);

    expect(queryRunner.query.mock.calls.every(([statement]) => !statement.includes('ADD COLUMN'))).toBe(true);
  });
});
