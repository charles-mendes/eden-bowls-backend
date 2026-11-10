const { parseEnv } = require('../src/config/env');
const { UpsClient, UPS_BASE_URLS, resolveUpsTarget } = require('../src/infrastructure/shipping/ups-client');

const CIE = 'https://wwwcie.ups.com';
const PRODUCTION = 'https://onlinetools.ups.com';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

// Every UPS call in this file goes through this fake. No request leaves the process.
function fakeUps(handlers = {}) {
  const calls = [];
  let tokenCount = 0;
  const fetchImpl = jest.fn(async (url, init) => {
    calls.push({ url, init });
    const { pathname } = new URL(url);
    if (pathname === '/security/v1/oauth/token') {
      if (handlers.oauth) return handlers.oauth(url, init);
      tokenCount += 1;
      return jsonResponse(200, { access_token: `token-${tokenCount}`, expires_in: 14399 });
    }
    const handler = handlers[pathname] || handlers.default;
    if (handler) return handler(url, init, calls);
    return jsonResponse(200, {});
  });
  return { fetchImpl, calls };
}

function client(overrides = {}) {
  return new UpsClient({
    clientId: 'id',
    clientSecret: 'secret',
    accountNumber: 'A1B2C3',
    ...overrides
  });
}

function envFor(runtime, extra = {}) {
  if (runtime === 'local') {
    return { NODE_ENV: 'development', EDEN_RUNTIME: 'local', ...extra };
  }
  return {
    NODE_ENV: 'production',
    JWT_AUTH_SECRET_KEY: 'jwt-secret-value',
    JWT_AUTH_ISSUER: 'https://api.example.com',
    AUTH_REFRESH_COOKIE_SECURE: 'true',
    AUTH_OTP_PEPPER: 'pepper-value',
    AUTH_SMTP_HOST: 'smtp.example.com',
    AUTH_MAIL_FROM: 'ops@example.com',
    STRIPE_US_SECRET_KEY: 'sk_us',
    STRIPE_US_WEBHOOK_SECRET: 'whsec_us',
    STRIPE_BR_SECRET_KEY: 'sk_br',
    STRIPE_BR_WEBHOOK_SECRET: 'whsec_br',
    STRIPE_BR_ENABLED: 'false',
    UPS_CLIENT_ID: 'ups-id',
    UPS_CLIENT_SECRET: 'ups-secret',
    UPS_ACCOUNT_NUMBER: 'ups-account',
    METRICS_TOKEN: 'metrics-token',
    DB_PASSWORD: 'db-password',
    SHIPPING_QUOTE_SECRET: 'quote-secret-value',
    CORS_ORIGINS: 'https://edenbowls.com',
    EDEN_RUNTIME: runtime,
    ...extra
  };
}

function clientFromEnv(source, fetchImpl) {
  const env = parseEnv(source);
  return new UpsClient({
    clientId: 'id',
    clientSecret: 'secret',
    env: env.UPS_ENV,
    runtime: env.EDEN_RUNTIME,
    fetchImpl
  });
}

describe('UPS base URL by runtime', () => {
  test('the two hosts are fixed', () => {
    expect(UPS_BASE_URLS).toEqual({ cie: CIE, production: PRODUCTION });
  });

  test.each([
    ['local without UPS_ENV', envFor('local')],
    ['local with UPS_ENV=cie', envFor('local', { UPS_ENV: 'cie' })],
    ['QA without UPS_ENV', envFor('qa')],
    ['QA with UPS_ENV=cie', envFor('qa', { UPS_ENV: 'cie' })]
  ])('%s calls CIE for OAuth, rate, ship, track and void', async (_label, source) => {
    const { fetchImpl, calls } = fakeUps({
      '/api/rating/v2403/Shop': () => jsonResponse(200, {
        RateResponse: { RatedShipment: [{ Service: { Code: '03' }, TotalCharges: { MonetaryValue: '10.00' } }] }
      }),
      '/api/shipments/v2409/ship': () => jsonResponse(200, {
        ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: '1ZSHIP', PackageResults: { TrackingNumber: '1ZSHIP' } } }
      })
    });
    const ups = clientFromEnv(source, fetchImpl);
    const parties = { shipFrom: { zipcode: '33101' }, shipTo: { zipcode: '10001' }, package: {} };

    await ups.rate(parties);
    await ups.createShipment(parties);
    await ups.track('1ZSHIP');
    await ups.voidShipment('1ZSHIP');

    expect(ups.baseUrl).toBe(CIE);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) {
      expect(call.url.startsWith(`${CIE}/`)).toBe(true);
      expect(call.url).not.toContain('onlinetools');
    }
  });

  test('production calls onlinetools.ups.com', async () => {
    const { fetchImpl, calls } = fakeUps();
    const ups = clientFromEnv(envFor('production', { UPS_ENV: 'production' }), fetchImpl);

    await ups.track('1ZPROD');

    expect(ups.baseUrl).toBe(PRODUCTION);
    expect(calls.map((call) => new URL(call.url).origin)).toEqual([PRODUCTION, PRODUCTION]);
  });

  test('the client refuses production outside the production runtime', () => {
    expect(() => client({ env: 'production', runtime: 'qa' })).toThrow(/EDEN_RUNTIME=production/);
    expect(() => client({ env: 'production', runtime: 'local' })).toThrow(/EDEN_RUNTIME=production/);
    expect(() => client({ env: 'production' })).toThrow(/EDEN_RUNTIME=production/);
  });

  test('the client refuses CIE in the production runtime and unknown names everywhere', () => {
    expect(() => client({ env: 'cie', runtime: 'production' })).toThrow(/requires UPS env production/);
    expect(() => client({ runtime: 'production' })).toThrow(/requires UPS env production/);
    expect(() => resolveUpsTarget('sandbox', 'local')).toThrow(/cie or production/);
  });

  test('a client without env or runtime defaults to CIE', () => {
    expect(client().baseUrl).toBe(CIE);
    expect(client().envName).toBe('cie');
  });

  test('the base URL cannot be changed after construction', () => {
    const ups = client({ env: 'cie', runtime: 'qa' });
    expect(() => { 'use strict'; ups.baseUrl = PRODUCTION; }).toThrow(TypeError);
    expect(() => { 'use strict'; ups.envName = 'production'; }).toThrow(TypeError);
    expect(ups.baseUrl).toBe(CIE);
  });
});

describe('UPS OAuth token', () => {
  test('reuses the cached token and sends a unique 32-character transId', async () => {
    const { fetchImpl, calls } = fakeUps();
    const ups = client({ fetchImpl });

    await ups.track('1Z1');
    await ups.track('1Z2');

    const tokenCalls = calls.filter((call) => call.url.endsWith('/security/v1/oauth/token'));
    expect(tokenCalls).toHaveLength(1);
    const transIds = calls.filter((call) => call.url.includes('/api/track/')).map((call) => call.init.headers.transId);
    expect(transIds[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(transIds[0]).not.toBe(transIds[1]);
    expect(calls[1].init.headers.Authorization).toBe('Bearer token-1');
  });

  test('a token cached for another host is not reused', async () => {
    const { fetchImpl, calls } = fakeUps();
    const ups = client({ fetchImpl });
    ups.tokenCache = { baseUrl: PRODUCTION, accessToken: 'prod-token', expiresAt: Date.now() + 3600_000 };

    await ups.track('1Z1');

    expect(calls[0].url).toBe(`${CIE}/security/v1/oauth/token`);
    expect(calls[1].init.headers.Authorization).toBe('Bearer token-1');
  });

  test('a 401 drops the token and retries a track call once with a new token', async () => {
    let trackCalls = 0;
    const { fetchImpl, calls } = fakeUps({
      default: () => {
        trackCalls += 1;
        return trackCalls === 1 ? jsonResponse(401, {}) : jsonResponse(200, { ok: true });
      }
    });
    const ups = client({ fetchImpl });

    await expect(ups.track('1Z1')).resolves.toEqual({ ok: true });

    const authHeaders = calls.filter((call) => call.url.includes('/api/track/')).map((call) => call.init.headers.Authorization);
    expect(authHeaders).toEqual(['Bearer token-1', 'Bearer token-2']);
  });

  test('a second 401 fails without looping', async () => {
    const { fetchImpl, calls } = fakeUps({ default: () => jsonResponse(401, {}) });
    const ups = client({ fetchImpl });

    await expect(ups.track('1Z1')).rejects.toMatchObject({ details: { code: 'ups_upstream_error', status: 401 } });
    expect(calls.filter((call) => call.url.includes('/api/track/'))).toHaveLength(2);
  });

  test('a 401 on ship drops the token and is not retried', async () => {
    const { fetchImpl, calls } = fakeUps({ '/api/shipments/v2409/ship': () => jsonResponse(401, {}) });
    const ups = client({ fetchImpl });

    await expect(ups.createShipment({ shipFrom: {}, shipTo: {}, package: {} })).rejects.toMatchObject({
      details: { code: 'ups_upstream_error', status: 401 }
    });
    expect(calls.filter((call) => call.url.endsWith('/ship'))).toHaveLength(1);
    expect(ups.tokenCache).toBeNull();
  });
});

describe('UPS error details', () => {
  test('upstream errors keep the status and UPS code but not the response body', async () => {
    const { fetchImpl } = fakeUps({
      default: () => jsonResponse(400, {
        response: { errors: [{ code: '120100', message: 'Missing or invalid shipper number' }] },
        ShipTo: { Name: 'Ana Costa', Address: '1 Main St' }
      })
    });
    const ups = client({ fetchImpl });

    const error = await ups.track('1Z1').catch((caught) => caught);

    expect(error.details).toEqual({ code: 'ups_upstream_error', status: 400, ups_code: '120100' });
    expect(JSON.stringify(error.details)).not.toContain('Ana Costa');
  });

  test('OAuth failures are tagged with the oauth stage and carry no body', async () => {
    const { fetchImpl } = fakeUps({ oauth: () => jsonResponse(401, { response: { errors: [{ code: '250002' }] }, secret: 'x' }) });
    const ups = client({ fetchImpl });

    const error = await ups.track('1Z1').catch((caught) => caught);

    expect(error.details).toEqual({ code: 'ups_oauth_failed', status: 401, ups_code: '250002', stage: 'oauth' });
  });

  test('an incomplete ship answer does not echo the label or address', async () => {
    const { fetchImpl } = fakeUps({
      '/api/shipments/v2409/ship': () => jsonResponse(200, {
        ShipmentResponse: { ShipmentResults: { PackageResults: { ShippingLabel: { GraphicImage: 'R0lGODlh' } } } }
      })
    });
    const ups = client({ fetchImpl });

    const error = await ups.createShipment({ shipFrom: {}, shipTo: {}, package: {} }).catch((caught) => caught);

    expect(error.details).toEqual({ code: 'ups_ship_incomplete' });
  });
});

describe('UPS simulation client', () => {
  test('always targets CIE, even when the runtime is production', () => {
    const ups = client({ simulationOnly: true, env: 'production', runtime: 'production' });

    expect(ups.envName).toBe('cie');
    expect(ups.baseUrl).toBe(CIE);
  });

  test('refuses to buy or void a label', async () => {
    const { fetchImpl, calls } = fakeUps();
    const ups = client({ simulationOnly: true, fetchImpl });

    await expect(ups.createShipment({ shipFrom: {}, shipTo: {}, package: {} })).rejects.toMatchObject({ details: { code: 'ups_simulation_only' } });
    await expect(ups.voidShipment('1Z1')).rejects.toMatchObject({ details: { code: 'ups_simulation_only' } });
    expect(calls).toHaveLength(0);
  });

  test('quotes with transit time through Shoptimeintransit', async () => {
    const { fetchImpl, calls } = fakeUps({
      '/api/rating/v2403/Shoptimeintransit': () => jsonResponse(200, {
        RateResponse: {
          RatedShipment: [
            { Service: { Code: '03' }, TotalCharges: { MonetaryValue: '14.10', CurrencyCode: 'USD' }, TimeInTransit: { ServiceSummary: { EstimatedArrival: { BusinessDaysInTransit: '2' } } } },
            { Service: { Code: '02' }, TotalCharges: { MonetaryValue: '31.00', CurrencyCode: 'USD' } }
          ]
        }
      })
    });
    const ups = client({ simulationOnly: true, fetchImpl });

    const rated = await ups.rate({
      shipFrom: { zipcode: '10001', state: 'NY' },
      shipTo: { zipcode: '94105', state: 'CA' },
      package: { weight_lb: 10 },
      allowedServiceCodes: [],
      withTransit: true,
      pickupDate: new Date('2026-10-07T12:00:00Z')
    });

    const body = JSON.parse(calls[1].init.body);
    expect(calls[1].url).toBe(`${CIE}/api/rating/v2403/Shoptimeintransit`);
    expect(body.RateRequest.Shipment.DeliveryTimeInformation).toEqual({ PackageBillType: '03', Pickup: { Date: '20261007' } });
    expect(rated).toMatchObject({ serviceCode: '03', monetaryValue: 14.1, deliveryDays: 2 });
    expect(rated.ratedShipments).toHaveLength(2);
  });

  test('reads the UPS address validation verdict and candidates', async () => {
    const { fetchImpl, calls } = fakeUps({
      '/api/addressvalidation/v2/1': () => jsonResponse(200, {
        XAVResponse: {
          ValidAddressIndicator: '',
          Candidate: {
            AddressKeyFormat: { AddressLine: ['26601 ALISO CREEK RD'], PoliticalDivision2: 'ALISO VIEJO', PoliticalDivision1: 'CA', PostcodePrimaryLow: '92656', PostcodeExtendedLow: '4301' }
          }
        }
      })
    });
    const ups = client({ fetchImpl });

    const result = await ups.validateAddress({ street: '26601 Aliso Creek Rd', city: 'Aliso Viejo', state: 'ca', zipcode: '92656' });

    expect(JSON.parse(calls[1].init.body).XAVRequest.AddressKeyFormat).toMatchObject({ PoliticalDivision1: 'CA', PostcodePrimaryLow: '92656' });
    expect(result).toEqual({
      status: 'valid',
      candidates: [{ street: '26601 ALISO CREEK RD', street2: '', city: 'ALISO VIEJO', state: 'CA', zipcode: '92656-4301' }]
    });
  });

  test('Rating says PackagingType and Shipping says Packaging', async () => {
    const { fetchImpl, calls } = fakeUps({
      '/api/rating/v2403/Shop': () => jsonResponse(200, {
        RateResponse: { RatedShipment: [{ Service: { Code: '03' }, TotalCharges: { MonetaryValue: '1' } }] }
      }),
      '/api/shipments/v2409/ship': () => jsonResponse(200, {
        ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: '1ZSHIP', PackageResults: { TrackingNumber: '1ZSHIP' } } }
      })
    });
    const ups = clientFromEnv(envFor('local'), fetchImpl);
    const parties = { shipFrom: { zipcode: '33101' }, shipTo: { zipcode: '10001' }, package: {} };

    await ups.rate(parties);
    await ups.createShipment(parties);

    const bodyOf = (path) => JSON.parse(calls.find((call) => call.url.includes(path)).init.body);
    const shipped = bodyOf('/shipments/').ShipmentRequest.Shipment.Package;
    expect(shipped.Packaging).toMatchObject({ Code: '02' });
    expect(shipped.PackagingType).toBeUndefined();
    expect(bodyOf('/rating/').RateRequest.Shipment.Package.PackagingType).toMatchObject({ Code: '02' });
  });
});

describe('UpsClient ship-to name', () => {
  test('cuts a long recipient to the 35 characters UPS accepts', () => {
    const name = 'Maria Aparecida dos Santos Oliveira Albuquerque';
    expect(name.length).toBeGreaterThan(35);
    const address = client().buildAddress({ name });
    expect(address.Name).toBe(name.slice(0, 35));
    expect(address.AttentionName).toBe(name.slice(0, 35));
  });
});

describe('UPS pickup', () => {
  const shipFrom = { name: 'Eden Bowls', street: '100 Main St', street2: 'Suite 2', city: 'Boca Raton', state: 'FL', zipcode: '33431', country: 'US', phone: '(305) 555-0100' };

  test('creates a pickup with the date, window, count, address, phone and total weight', async () => {
    const { fetchImpl, calls } = fakeUps({
      '/api/pickupcreation/v2409/pickup': () => jsonResponse(200, { PickupCreationResponse: { PRN: '2929602E9CP' } })
    });
    const ups = client({ fetchImpl });

    const result = await ups.createPickup({ pickupDate: '2026-11-09', readyTime: '14:00', closeTime: '18:00', packageCount: 8, shipFrom, serviceCode: '03', weightLb: 10 });

    expect(result.prn).toBe('2929602E9CP');
    const call = calls.find((item) => item.url.includes('/api/pickupcreation/'));
    expect(call.init.method).toBe('POST');
    const body = JSON.parse(call.init.body).PickupCreationRequest;
    expect(body.RatePickupIndicator).toBe('N');
    expect(body.Shipper.Account.AccountNumber).toBe('A1B2C3');
    expect(body.PickupDateInfo).toEqual({ PickupDate: '20261109', ReadyTime: '1400', CloseTime: '1800' });
    expect(body.PickupAddress).toMatchObject({ AddressLine: '100 Main St Suite 2', City: 'Boca Raton', StateProvince: 'FL', PostalCode: '33431', Phone: { Number: '3055550100' } });
    expect(body.PickupPiece).toEqual([{ ServiceCode: '003', Quantity: '8', DestinationCountryCode: 'US', ContainerCode: '01' }]);
    expect(body.TotalWeight).toEqual({ Weight: '80', UnitOfMeasurement: 'LBS' });
    expect(body.PaymentMethod).toBe('01');
  });

  test('a response without PRN is ups_pickup_incomplete', async () => {
    const { fetchImpl } = fakeUps({ '/api/pickupcreation/v2409/pickup': () => jsonResponse(200, { PickupCreationResponse: {} }) });
    await expect(client({ fetchImpl }).createPickup({ pickupDate: '2026-11-09', readyTime: '14:00', closeTime: '18:00', packageCount: 1, shipFrom }))
      .rejects.toMatchObject({ statusCode: 502, details: { code: 'ups_pickup_incomplete' } });
  });

  test('a 401 on create is not repeated', async () => {
    const { fetchImpl, calls } = fakeUps({ '/api/pickupcreation/v2409/pickup': () => jsonResponse(401, {}) });
    await expect(client({ fetchImpl }).createPickup({ pickupDate: '2026-11-09', readyTime: '14:00', closeTime: '18:00', packageCount: 1, shipFrom })).rejects.toBeTruthy();
    expect(calls.filter((item) => item.url.includes('/api/pickupcreation/'))).toHaveLength(1);
  });

  test('cancels by PRN in the header', async () => {
    const { fetchImpl, calls } = fakeUps();
    await client({ fetchImpl }).cancelPickup('2929602E9CP');
    const call = calls.find((item) => item.url.includes('/pickup/02'));
    expect(call.url).toBe(`${CIE}/api/shipments/v2409/pickup/02`);
    expect(call.init.method).toBe('DELETE');
    expect(call.init.headers.Prn).toBe('2929602E9CP');
  });

  test('the simulation client refuses both', async () => {
    const ups = client({ simulationOnly: true, fetchImpl: fakeUps().fetchImpl });
    await expect(ups.createPickup({ pickupDate: '2026-11-09', readyTime: '14:00', closeTime: '18:00', packageCount: 1, shipFrom })).rejects.toMatchObject({ details: { code: 'ups_simulation_only' } });
    await expect(ups.cancelPickup('X')).rejects.toMatchObject({ details: { code: 'ups_simulation_only' } });
  });

  test('a label buy carries the ship-from phone when there is one', async () => {
    const { fetchImpl, calls } = fakeUps({
      '/api/shipments/v2409/ship': () => jsonResponse(200, {
        ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: '1ZSHIP', PackageResults: { TrackingNumber: '1ZSHIP' } } }
      })
    });
    await client({ fetchImpl }).createShipment({ shipFrom, shipTo: { zipcode: '10001' }, package: {} });
    const body = JSON.parse(calls.find((item) => item.url.includes('/ship')).init.body);
    expect(body.ShipmentRequest.Shipment.Shipper.Phone).toEqual({ Number: '3055550100' });
  });
});

describe('UPS dry ice declaration', () => {
  const DRY_ICE = {
    DryIce: {
      RegulationSet: 'CFR',
      DryIceWeight: { UnitOfMeasurement: { Code: '00', Description: 'Kilograms' }, Weight: '0.5' }
    }
  };
  const parties = {
    shipFrom: { zipcode: '33431', state: 'FL' },
    shipTo: { zipcode: '10001', state: 'NY' },
    package: { weight_lb: 10, length_in: 12, width_in: 12, height_in: 12, dry_ice_kg: 0.5 }
  };

  function upsWithRates() {
    const rated = () => jsonResponse(200, {
      RateResponse: { RatedShipment: [{ Service: { Code: '03' }, TotalCharges: { MonetaryValue: '22.65', CurrencyCode: 'USD' } }] }
    });
    return fakeUps({
      '/api/rating/v2403/Shop': rated,
      '/api/rating/v2403/Shoptimeintransit': rated,
      '/api/shipments/v2409/ship': () => jsonResponse(200, {
        ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: '1ZDRY', PackageResults: { TrackingNumber: '1ZDRY' } } }
      })
    });
  }

  const bodyOf = (calls, path) => JSON.parse(calls.find((call) => new URL(call.url).pathname.endsWith(path)).init.body);

  test('Label with the deploy value: 0.5 kg under CFR on the package, service 03', async () => {
    const { fetchImpl, calls } = upsWithRates();
    const ups = clientFromEnv(envFor('local'), fetchImpl);

    await ups.createShipment({ ...parties, serviceCode: '03' });

    const shipment = bodyOf(calls, '/ship').ShipmentRequest.Shipment;
    expect(shipment.Service).toMatchObject({ Code: '03' });
    expect(shipment.Package.PackageServiceOptions).toEqual(DRY_ICE);
    expect(shipment.Package.Packaging).toMatchObject({ Code: '02' });
    expect(shipment.Package.PackagingType).toBeUndefined();
  });

  test('Shop and Shoptimeintransit rate requests carry the same block', async () => {
    const { fetchImpl, calls } = upsWithRates();
    const ups = clientFromEnv(envFor('local'), fetchImpl);

    await ups.rate(parties);
    await ups.rate({ ...parties, withTransit: true, pickupDate: new Date('2026-11-10T12:00:00Z') });

    expect(bodyOf(calls, '/rating/v2403/Shop').RateRequest.Shipment.Package.PackageServiceOptions).toEqual(DRY_ICE);
    const transit = bodyOf(calls, '/Shoptimeintransit').RateRequest.Shipment;
    expect(transit.Package.PackageServiceOptions).toEqual(DRY_ICE);
    expect(transit.ShipmentTotalWeight).toEqual({ UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' }, Weight: '10' });
  });

  test('sends the weight with one decimal place and no medical or audit flag', () => {
    const block = client().buildPackage({ weight_lb: 10, dry_ice_kg: 2 }).PackageServiceOptions.DryIce;

    expect(block.DryIceWeight.Weight).toBe('2.0');
    expect(block).not.toHaveProperty('MedicalUseIndicator');
    expect(block).not.toHaveProperty('AuditRequired');
  });

  test('a package without dry ice sends no service options', () => {
    expect(client().buildPackage({ weight_lb: 10 })).not.toHaveProperty('PackageServiceOptions');
  });
});
