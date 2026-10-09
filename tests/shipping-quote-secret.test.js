const path = require('path');
const { spawnSync } = require('child_process');
const { parseEnv } = require('../src/config/env');
const { ShippingQuoteSigner, verifiedDeliveryQuote } = require('../src/core/shipping-quote-token');

const JWT_SECRET = 'jwt-secret-value';

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    JWT_AUTH_SECRET_KEY: JWT_SECRET,
    JWT_AUTH_ISSUER: 'https://api.edenbowls.com',
    AUTH_REFRESH_COOKIE_SECURE: 'true',
    AUTH_REFRESH_COOKIE_SAME_SITE: 'lax',
    AUTH_REFRESH_COOKIE_DOMAIN: '',
    AUTH_OTP_PEPPER: 'pepper-value',
    AUTH_SMTP_HOST: 'smtp.example.com',
    AUTH_MAIL_FROM: 'ops@example.com',
    STRIPE_US_SECRET_KEY: 'sk_us',
    STRIPE_US_WEBHOOK_SECRET: 'whsec_us',
    STRIPE_BR_SECRET_KEY: 'sk_br',
    STRIPE_BR_WEBHOOK_SECRET: 'whsec_br',
    STRIPE_BR_ENABLED: 'true',
    UPS_CLIENT_ID: 'ups-id',
    UPS_CLIENT_SECRET: 'ups-secret',
    UPS_ACCOUNT_NUMBER: 'ups-account',
    UPS_ENV: 'production',
    METRICS_TOKEN: 'metrics-token',
    DB_PASSWORD: 'db-password',
    CORS_ORIGINS: 'https://edenbowls.com,https://admin.edenbowls.com',
    EDEN_RUNTIME: 'production',
    ...overrides
  };
}

function usQuote(signer) {
  return {
    cost: 12.9,
    delivery_days: 1,
    quote_token: signer.sign({ country: 'US', zipcode: '94105', cost: 12.9, deliveryDays: 1 })
  };
}

function refusal(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected a refusal.');
}

describe('shipping quote secret', () => {
  test('production refuses to start without SHIPPING_QUOTE_SECRET', () => {
    expect(() => parseEnv(productionEnv())).toThrow(/SHIPPING_QUOTE_SECRET must be set/);
    expect(() => parseEnv(productionEnv({ SHIPPING_QUOTE_SECRET: '   ' }))).toThrow(/SHIPPING_QUOTE_SECRET must be set/);
  });

  test('production refuses the development key and the JWT key', () => {
    expect(() => parseEnv(productionEnv({ SHIPPING_QUOTE_SECRET: 'eden-local-shipping-quote' })))
      .toThrow(/SHIPPING_QUOTE_SECRET must be set/);
    expect(() => parseEnv(productionEnv({ SHIPPING_QUOTE_SECRET: JWT_SECRET })))
      .toThrow(/SHIPPING_QUOTE_SECRET must differ from JWT_AUTH_SECRET_KEY/);
  });

  test('production accepts its own SHIPPING_QUOTE_SECRET', () => {
    const env = parseEnv(productionEnv({ SHIPPING_QUOTE_SECRET: 'shipping-quote-only' }));
    expect(env.SHIPPING_QUOTE_SECRET).toBe('shipping-quote-only');
  });

  test('outside production the development key is used, never the JWT key', () => {
    const qa = parseEnv(productionEnv({ EDEN_RUNTIME: 'qa', UPS_ENV: 'cie' }));
    const local = parseEnv({ NODE_ENV: 'development', EDEN_RUNTIME: 'local', JWT_AUTH_SECRET_KEY: JWT_SECRET });
    expect(qa.SHIPPING_QUOTE_SECRET).toBe('eden-local-shipping-quote');
    expect(local.SHIPPING_QUOTE_SECRET).toBe('eden-local-shipping-quote');
  });

  test('a quote signed with the JWT key is refused', () => {
    const jwtSigner = new ShippingQuoteSigner({ secret: JWT_SECRET });
    const environments = [
      parseEnv({ NODE_ENV: 'development', EDEN_RUNTIME: 'local', JWT_AUTH_SECRET_KEY: JWT_SECRET }),
      parseEnv(productionEnv({ SHIPPING_QUOTE_SECRET: 'shipping-quote-only' }))
    ];
    for (const env of environments) {
      const signer = new ShippingQuoteSigner({ secret: env.SHIPPING_QUOTE_SECRET });
      expect(refusal(() => verifiedDeliveryQuote(signer, 'US', usQuote(jwtSigner), { zipcode: '94105' })).details)
        .toEqual({ code: 'delivery_area_unverified' });
      expect(verifiedDeliveryQuote(signer, 'US', usQuote(signer), { zipcode: '94105' })).toMatchObject({ cost: 12.9 });
    }
  });

  test('the API process exits and logs the reason when production has no SHIPPING_QUOTE_SECRET', () => {
    const run = spawnSync(process.execPath, ['src/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: productionEnv({ SHIPPING_QUOTE_SECRET: '', SENTRY_DSN: '', LOG_LEVEL: 'info' }),
      encoding: 'utf8',
      timeout: 30000
    });
    const output = `${run.stdout}${run.stderr}`;
    expect(run.status).toBe(1);
    expect(output).toContain('Failed to start application.');
    expect(output).toContain('SHIPPING_QUOTE_SECRET must be set to a non-placeholder value in production.');
  });
});
