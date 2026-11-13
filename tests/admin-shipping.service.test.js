const { AdminShippingService } = require('../src/services/admin-shipping.service');

describe('AdminShippingService', () => {
  test('loads settings from the repository and refreshes the shipping service cache', async () => {
    const settings = { br: { enabled: true, rule: { per_km: 0.95 } }, us: { cost: 12.9 } };
    const repository = {
      get: jest.fn().mockResolvedValue(settings)
    };
    const shippingService = { settings: null };
    const service = new AdminShippingService({ repository, shippingService });

    const result = await service.getSettings();

    expect(result.data.settings.us.cost).toBe(12.9);
    expect(shippingService.settings).toBe(settings);
    expect(result.data.envOverrides).toBeUndefined();
  });

  test('persists settings in the repository when saving', async () => {
    const saved = { br: { enabled: false }, us: { cost: 14 } };
    const repository = {
      save: jest.fn().mockResolvedValue(saved)
    };
    const shippingService = { settings: { us: { cost: 12.9 } } };
    const service = new AdminShippingService({ repository, shippingService });

    const result = await service.saveSettings({ br: { enabled: false } });

    expect(repository.save).toHaveBeenCalledWith({ br: { enabled: false } });
    expect(result.data.settings).toEqual(saved);
    expect(shippingService.settings).toEqual(saved);
  });

  test.each([0, 11, 1.5, 'two'])('Out of range: max_transit_days %j is refused with 422 and nothing is stored', async (days) => {
    const repository = { save: jest.fn(), get: jest.fn() };
    const shippingService = { settings: { us: { max_transit_days: 1 } } };
    const service = new AdminShippingService({ repository, shippingService });

    await expect(service.saveSettings({ us: { max_transit_days: days } })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_max_transit_days' }
    });
    expect(repository.save).not.toHaveBeenCalled();
    expect(shippingService.settings.us.max_transit_days).toBe(1);
  });

  test('saves max_transit_days within 1 to 10', async () => {
    const repository = { save: jest.fn(async (payload) => payload) };
    const service = new AdminShippingService({ repository, shippingService: { settings: null } });

    await service.saveSettings({ us: { max_transit_days: 10 } });

    expect(repository.save).toHaveBeenCalledWith({ us: { max_transit_days: 10 } });
  });

  describe('US dry ice weight per box', () => {
    const stored = { us: { package: { weight_lb: 10, length_in: 12, width_in: 12, height_in: 12, dry_ice_kg: 0.5 } } };

    function setup(current = stored) {
      const repository = { get: jest.fn().mockResolvedValue(current), save: jest.fn() };
      const shippingService = { settings: current };
      return { repository, shippingService, service: new AdminShippingService({ repository, shippingService }) };
    }

    test.each([
      ['Above the limit', 3],
      ['Zero is refused', 0],
      ['Two decimal places', 0.55],
      ['not a number', 'half']
    ])('%s: dry_ice_kg %j is refused with 422 and nothing is stored', async (_name, dryIceKg) => {
      const { repository, shippingService, service } = setup();

      await expect(service.saveSettings({ us: { package: { dry_ice_kg: dryIceKg } } })).rejects.toMatchObject({
        statusCode: 422,
        details: { code: 'invalid_dry_ice_kg' }
      });
      expect(repository.save).not.toHaveBeenCalled();
      expect(shippingService.settings.us.package.dry_ice_kg).toBe(0.5);
    });

    test('Heavier than the package: 0.5 kg with a 1 lb package is refused', async () => {
      const { repository, service } = setup({ us: { package: { ...stored.us.package, weight_lb: 1 } } });

      await expect(service.saveSettings({ us: { package: { dry_ice_kg: 0.5 } } })).rejects.toMatchObject({
        statusCode: 422,
        details: { code: 'invalid_dry_ice_kg' }
      });
      expect(repository.save).not.toHaveBeenCalled();
    });

    test('lowering the package weight below the stored dry ice is refused', async () => {
      const { repository, service } = setup();

      await expect(service.saveSettings({ us: { package: { weight_lb: 1 } } })).rejects.toMatchObject({
        statusCode: 422,
        details: { code: 'invalid_dry_ice_kg' }
      });
      expect(repository.save).not.toHaveBeenCalled();
    });

    test('Operator changes the weight: a saved 1.2 is returned by GET', async () => {
      let current = stored;
      const repository = {
        get: jest.fn(async () => current),
        save: jest.fn(async (payload) => {
          current = { us: { package: { ...current.us.package, ...payload.us.package } } };
          return current;
        })
      };
      const service = new AdminShippingService({ repository, shippingService: { settings: null } });

      await service.saveSettings({ us: { package: { dry_ice_kg: 1.2 } } });
      const result = await service.getSettings();

      expect(repository.save).toHaveBeenCalledWith({ us: { package: { dry_ice_kg: 1.2 } } });
      expect(result.data.settings.us.package.dry_ice_kg).toBe(1.2);
    });

    test('accepts the limits 0.1 and 2.5', async () => {
      for (const dryIceKg of [0.1, 2.5]) {
        const { repository, service } = setup();
        repository.save.mockImplementation(async (payload) => payload);
        await service.saveSettings({ us: { package: { dry_ice_kg: dryIceKg } } });
        expect(repository.save).toHaveBeenCalled();
      }
    });

    test('a payload without package fields does not read the stored settings', async () => {
      const { repository, service } = setup();
      repository.save.mockImplementation(async (payload) => payload);

      await service.saveSettings({ us: { cost: 14 } });

      expect(repository.get).not.toHaveBeenCalled();
    });
  });

  test('throws 503 when the repository is missing', async () => {
    const service = new AdminShippingService({});

    await expect(service.getSettings()).rejects.toMatchObject({
      statusCode: 503,
      message: 'Shipping settings repository is not available.'
    });
  });

  test('returns only in-scope shipping settings for a Brazil operator', async () => {
    const settings = { br: { enabled: true }, us: { cost: 12.9 } };
    const service = new AdminShippingService({
      repository: { get: jest.fn().mockResolvedValue(settings) }
    });

    const result = await service.getSettings({ roles: ['operator'], markets: ['BR'] });

    expect(result.data.settings).toEqual({ br: { enabled: true } });
  });
});

describe('AdminShippingService › headquarters', () => {
  const current = {
    br: { center: { name: 'CD', street: '', number: '', city: '', state: '', zipcode: '', lat: -25.4, lng: -49.2 } },
    us: { ship_from: { name: 'Eden', street: '100 Main St', street2: '', city: 'Miami', state: 'FL', zipcode: '33101' } }
  };

  function serviceWith(headquartersService) {
    const repository = {
      get: jest.fn().mockResolvedValue(current),
      save: jest.fn().mockImplementation(async (payload) => payload)
    };
    return { repository, service: new AdminShippingService({ repository, headquartersService }) };
  }

  test('stores the coordinates found for a new Brazil address', async () => {
    const headquartersService = {
      validateBr: jest.fn().mockResolvedValue({
        valid: true,
        address: { street: 'Av. Paulista', number: '1000', city: 'São Paulo', state: 'SP', zipcode: '01310-100' },
        location: { lat: -23.56, lng: -46.65 }
      })
    };
    const { repository, service } = serviceWith(headquartersService);

    await service.saveSettings({ br: { center: { street: 'Av. Paulista', number: '1000', city: 'Sao Paulo', state: 'SP', zipcode: '01310100', lat: 0, lng: 0 } } });

    expect(repository.save).toHaveBeenCalledWith({
      br: { center: expect.objectContaining({ city: 'São Paulo', zipcode: '01310-100', lat: -23.56, lng: -46.65 }) }
    });
  });

  test('refuses an invalid address and saves nothing', async () => {
    const headquartersService = {
      validateUs: jest.fn().mockResolvedValue({ valid: false, errors: { zipcode: 'ZIP code não encontrado.' }, warnings: [] })
    };
    const { repository, service } = serviceWith(headquartersService);

    await expect(service.saveSettings({ us: { ship_from: { zipcode: '00000' } } })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'headquarters_invalid', market: 'US', errors: { zipcode: 'ZIP code não encontrado.' } }
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  test('does not revalidate an unchanged address and ignores typed coordinates', async () => {
    const headquartersService = { validateBr: jest.fn(), validateUs: jest.fn() };
    const { repository, service } = serviceWith(headquartersService);

    await service.saveSettings({ br: { center: { ...current.br.center, lat: 1, lng: 2 } }, us: { ship_from: current.us.ship_from } });

    expect(headquartersService.validateBr).not.toHaveBeenCalled();
    expect(headquartersService.validateUs).not.toHaveBeenCalled();
    expect(repository.save.mock.calls[0][0].br.center).not.toHaveProperty('lat');
  });
});

describe('AdminShippingService › US simulation', () => {
  const us = {
    quote_mode: 'ups',
    ship_from: { street: '100 Main St', city: 'Miami', state: 'FL', zipcode: '33101' },
    package: { weight_lb: 10, dry_ice_kg: 0.5 },
    allowed_service_codes: ['03']
  };

  test('runs every UPS step against the sandbox and lists all services', async () => {
    const upsSandboxClient = {
      isConfigured: () => true,
      getAccessToken: jest.fn().mockResolvedValue('token'),
      validateAddress: jest.fn(),
      rate: jest.fn().mockResolvedValue({
        ratedShipments: [
          { Service: { Code: '03' }, TotalCharges: { MonetaryValue: '14.10', CurrencyCode: 'USD' }, TimeInTransit: { ServiceSummary: { EstimatedArrival: { BusinessDaysInTransit: '3' } } } },
          { Service: { Code: '01' }, TotalCharges: { MonetaryValue: '62.00', CurrencyCode: 'USD' } }
        ]
      })
    };
    const zippopotamClient = { lookupUs: jest.fn().mockResolvedValue({ status: 'ok', address: { city: 'San Francisco', state: 'CA' } }) };
    const service = new AdminShippingService({
      repository: { get: jest.fn().mockResolvedValue({ us }) },
      shippingService: { settings: { us }, calculate: jest.fn() },
      upsSandboxClient,
      zippopotamClient
    });

    const result = await service.test({ zipCode: '94105', country: 'US' });

    expect(result.data.fixed).toBeNull();
    expect(result.data.ups.steps.map((step) => [step.key, step.status])).toEqual([
      ['oauth', 'ok'],
      ['destination', 'ok'],
      ['origin', 'skipped'],
      ['rating', 'ok']
    ]);
    expect(upsSandboxClient.rate).toHaveBeenCalledWith(expect.objectContaining({
      withTransit: true,
      shipTo: expect.objectContaining({ city: 'San Francisco', state: 'CA', zipcode: '94105' }),
      package: expect.objectContaining({ dry_ice_kg: 0.5 })
    }));
    expect(result.data.ups.rates).toEqual([
      { service_code: '03', label: 'UPS Ground', amount: 14.1, currency: 'USD', delivery_days: 3, allowed: true },
      { service_code: '01', label: 'UPS Next Day Air', amount: 62, currency: 'USD', delivery_days: null, allowed: false }
    ]);
    expect(result.data.ups.selected).toMatchObject({ service_code: '03', amount: 14.1 });
  });

  test('reports missing UPS credentials as a failed step', async () => {
    const service = new AdminShippingService({
      repository: { get: jest.fn().mockResolvedValue({ us }) },
      shippingService: { settings: { us }, calculate: jest.fn() },
      upsSandboxClient: { isConfigured: () => false }
    });

    const result = await service.test({ zipCode: '94105', country: 'US' });

    expect(result.data.ups.steps).toEqual([expect.objectContaining({ key: 'oauth', status: 'error' })]);
  });

  describe('US boxes', () => {
    const stored = {
      us: {
        package: { weight_lb: 37.5, length_in: 18, width_in: 14, height_in: 12, dry_ice_kg: 0.5 },
        boxes: {
          starter: { label: 'Starter Box', length_in: 14, width_in: 12, height_in: 8, empty_weight_kg: 1, max_packs: 10 },
          monthly: { label: 'Caixa mensal', length_in: 18, width_in: 14, height_in: 12, empty_weight_kg: 1.5, max_packs: 30 }
        }
      }
    };

    function setup() {
      const repository = { get: jest.fn().mockResolvedValue(stored), save: jest.fn(async () => stored) };
      return { repository, service: new AdminShippingService({ repository, shippingService: { settings: stored } }) };
    }

    test('Operator records the weighed box: 1.7 kg empty is saved', async () => {
      const { repository, service } = setup();

      await service.saveSettings({ us: { boxes: { monthly: { empty_weight_kg: 1.7 } } } });

      expect(repository.save).toHaveBeenCalledWith({ us: { boxes: { monthly: { empty_weight_kg: 1.7 } } } });
    });

    test.each([
      ['Starter not smaller than the monthly', { starter: { max_packs: 30 } }],
      ['zero side', { starter: { height_in: 0 } }],
      ['side above 108 in', { monthly: { length_in: 109 } }],
      ['empty weight below 0.1 kg', { monthly: { empty_weight_kg: 0.05 } }],
      ['empty weight above 10 kg', { starter: { empty_weight_kg: 11 } }],
      ['fractional max packs', { monthly: { max_packs: 30.5 } }],
      ['max packs above 100', { monthly: { max_packs: 101 } }],
      ['not a number', { monthly: { width_in: 'wide' } }]
    ])('%s: answers 422 invalid_shipping_box and stores nothing', async (_name, boxes) => {
      const { repository, service } = setup();

      await expect(service.saveSettings({ us: { boxes } })).rejects.toMatchObject({
        statusCode: 422,
        details: { code: 'invalid_shipping_box' }
      });
      expect(repository.save).not.toHaveBeenCalled();
    });
  });
});
