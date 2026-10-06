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
