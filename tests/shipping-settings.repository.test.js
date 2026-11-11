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
        .mockResolvedValueOnce([])
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
        .mockResolvedValueOnce([])
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

  test('reads and saves the US max transit days, 1 for a row without it', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([brRow])
        .mockResolvedValueOnce([usRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([brRow])
        .mockResolvedValueOnce([usRow])
        .mockResolvedValueOnce([])
        .mockResolvedValue({ affectedRows: 1 })
    };
    const repository = new ShippingSettingsRepository(dataSource);

    expect((await repository.get()).us.max_transit_days).toBe(1);
    const saved = await repository.save({ us: { max_transit_days: 2 } });

    expect(saved.us.max_transit_days).toBe(2);
    const [sql, params] = dataSource.query.mock.calls.find(([text]) => text.includes('INSERT INTO `shipping_us_settings`'));
    expect(sql).toContain('`max_transit_days` = VALUES(`max_transit_days`)');
    expect(params[params.length - 3]).toBe(2);
  });

  test('throws 503 when datasource is not initialized', async () => {
    const repository = new ShippingSettingsRepository({ isInitialized: false, query: jest.fn() });

    await expect(repository.get()).rejects.toMatchObject({
      statusCode: 503,
      message: 'Database connection is not initialized.'
    });
  });

  test('reads and saves the US ship-from phone, empty for a row without it', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([brRow])
        .mockResolvedValueOnce([usRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([brRow])
        .mockResolvedValueOnce([{ ...usRow, ship_from_phone: '305 555 0100' }])
        .mockResolvedValueOnce([])
        .mockResolvedValue({ affectedRows: 1 })
    };
    const repository = new ShippingSettingsRepository(dataSource);

    expect((await repository.get()).us.ship_from.phone).toBe('');
    const saved = await repository.save({ us: { ship_from: { phone: ' 305 555 0199 ' } } });

    expect(saved.us.ship_from.phone).toBe('305 555 0199');
    const [sql, params] = dataSource.query.mock.calls.find(([text]) => text.includes('INSERT INTO `shipping_us_settings`'));
    expect(sql).toContain('`ship_from_phone` = VALUES(`ship_from_phone`)');
    expect(params[params.length - 2]).toBe('305 555 0199');
  });

  test('reads and saves the US dry ice weight per box, 0.5 for a row without it', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([brRow])
        .mockResolvedValueOnce([usRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([brRow])
        .mockResolvedValueOnce([{ ...usRow, package_dry_ice_kg: '0.5' }])
        .mockResolvedValueOnce([])
        .mockResolvedValue({ affectedRows: 1 })
    };
    const repository = new ShippingSettingsRepository(dataSource);

    expect((await repository.get()).us.package.dry_ice_kg).toBe(0.5);
    const saved = await repository.save({ us: { package: { dry_ice_kg: 1.2 } } });

    expect(saved.us.package.dry_ice_kg).toBe(1.2);
    expect(saved.us.package.weight_lb).toBe(37.5);
    const [sql, params] = dataSource.query.mock.calls.find(([text]) => text.includes('INSERT INTO `shipping_us_settings`'));
    expect(sql).toContain('`package_dry_ice_kg` = VALUES(`package_dry_ice_kg`)');
    expect(params[params.length - 1]).toBe(1.2);
  });

  describe('US boxes', () => {
    const boxRows = [
      { key: 'starter', label: 'Starter Box', length_in: '14.00', width_in: '12.00', height_in: '8.00', empty_weight_kg: '1.00', max_packs: 10 },
      { key: 'monthly', label: 'Caixa mensal', length_in: '18.00', width_in: '14.00', height_in: '12.00', empty_weight_kg: '1.50', max_packs: 30 }
    ];

    function dataSourceWith(rows) {
      return {
        isInitialized: true,
        query: jest.fn(async (sql) => {
          if (sql.startsWith('SELECT') && sql.includes('shipping_br_settings')) return [brRow];
          if (sql.startsWith('SELECT') && sql.includes('shipping_us_settings')) return [usRow];
          if (sql.startsWith('SELECT') && sql.includes('shipping_us_boxes')) return rows;
          return { affectedRows: 1 };
        })
      };
    }

    test('Values after deploy: us.boxes holds the Starter and monthly boxes', async () => {
      const settings = await new ShippingSettingsRepository(dataSourceWith(boxRows)).get();

      expect(settings.us.boxes).toEqual({
        starter: { label: 'Starter Box', length_in: 14, width_in: 12, height_in: 8, empty_weight_kg: 1, max_packs: 10 },
        monthly: { label: 'Caixa mensal', length_in: 18, width_in: 14, height_in: 12, empty_weight_kg: 1.5, max_packs: 30 }
      });
    });

    test('an empty boxes table reads the deploy values', async () => {
      const settings = await new ShippingSettingsRepository(dataSourceWith([])).get();

      expect(settings.us.boxes.monthly).toMatchObject({ length_in: 18, empty_weight_kg: 1.5, max_packs: 30 });
      expect(settings.us.boxes.starter).toMatchObject({ height_in: 8, empty_weight_kg: 1, max_packs: 10 });
    });

    test('Operator records the weighed box: the monthly empty weight 1.7 is stored', async () => {
      const dataSource = dataSourceWith(boxRows);

      const saved = await new ShippingSettingsRepository(dataSource).save({ us: { boxes: { monthly: { empty_weight_kg: 1.7 } } } });

      expect(saved.us.boxes.monthly.empty_weight_kg).toBe(1.7);
      expect(saved.us.boxes.starter.empty_weight_kg).toBe(1);
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO `shipping_us_boxes`'),
        ['monthly', 'Caixa mensal', 18, 14, 12, 1.7, 30]
      );
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('ON DUPLICATE KEY UPDATE'),
        ['starter', 'Starter Box', 14, 12, 8, 1, 10]
      );
    });
  });
});
