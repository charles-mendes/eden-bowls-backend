const { ShippingSettingsRepository } = require('../src/infrastructure/repositories/shipping-settings.repository');

const brRow = {
  id: 1,
  enabled: 1,
  label: 'Entrega Eden Bowl',
  center_name: 'CD',
  center_street: '',
  center_city: '',
  center_state: '',
  center_zipcode: '',
  center_lat: '-25.448390',
  center_lng: '-49.217410',
  center_version: '1',
  per_km: '0.9500',
  road_factor: '1.3000',
  min_fee: '0.00',
  max_fee: null,
  max_distance_km: '500.00',
  km_per_day: '80.00',
  min_days: 2,
  max_days: 10
};

const usRow = {
  id: 1,
  enabled: 1,
  cost: '12.90',
  label: 'FedEx 3–5 business days',
  carrier: 'FedEx',
  delivery: '3–5 business days'
};

describe('ShippingSettingsRepository', () => {
  test('reads BR and US singleton rows', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([brRow])
        .mockResolvedValueOnce([usRow])
    };
    const repository = new ShippingSettingsRepository(dataSource);

    const settings = await repository.get();

    expect(settings.br.center.lat).toBe(-25.44839);
    expect(settings.us.cost).toBe(12.9);
    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM `shipping_br_settings`')
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM `shipping_us_settings`')
    );
  });

  test('upserts both tables when saving', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([brRow])
        .mockResolvedValueOnce([usRow])
        .mockResolvedValue({ affectedRows: 1 })
    };
    const repository = new ShippingSettingsRepository(dataSource);

    const settings = await repository.save({
      br: { rule: { per_km: 1.25 } },
      us: { cost: 14 }
    });

    expect(settings.br.rule.per_km).toBe(1.25);
    expect(settings.us.cost).toBe(14);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `shipping_br_settings`'),
      expect.arrayContaining([1.25])
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `shipping_us_settings`'),
      expect.arrayContaining([14])
    );
  });

  test('throws 503 when datasource is not initialized', async () => {
    const repository = new ShippingSettingsRepository({ isInitialized: false, query: jest.fn() });

    await expect(repository.get()).rejects.toMatchObject({
      statusCode: 503,
      message: 'Database connection is not initialized.'
    });
  });
});
