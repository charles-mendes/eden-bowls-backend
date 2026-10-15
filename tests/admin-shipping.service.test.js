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
    package: { weight_lb: 10 },
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
      shipTo: expect.objectContaining({ city: 'San Francisco', state: 'CA', zipcode: '94105' })
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
});
