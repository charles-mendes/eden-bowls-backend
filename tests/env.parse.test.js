const { parseEnv } = require('../src/config/env');

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    JWT_AUTH_SECRET_KEY: 'jwt-secret-value',
    JWT_AUTH_ISSUER: 'https://qa-api.edenbowls.com',
    AUTH_REFRESH_COOKIE_SECURE: 'true',
    AUTH_REFRESH_COOKIE_SAME_SITE: 'lax',
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
    UPS_ENV: 'cie',
    METRICS_TOKEN: 'metrics-token',
    DB_PASSWORD: 'db-password',
    CORS_ORIGINS: 'https://qa.edenbowls.com,https://qa-admin.edenbowls.com',
    EDEN_RUNTIME: 'qa',
    ...overrides
  };
}

describe('parseEnv', () => {
  test('rejects a missing runtime label', () => {
    expect(() => parseEnv({ NODE_ENV: 'development' })).toThrow(/EDEN_RUNTIME/);
    expect(() => parseEnv(productionEnv({ EDEN_RUNTIME: '' }))).toThrow(/EDEN_RUNTIME/);
    expect(() => parseEnv(productionEnv({ EDEN_RUNTIME: 'staging' }))).toThrow(/EDEN_RUNTIME/);
  });

  test('keeps development defaults when production keys are absent', () => {
    const env = parseEnv({ NODE_ENV: 'development', EDEN_RUNTIME: 'local' });

    expect(env.UPS_ENV).toBe('cie');
    expect(env.UPS_CLIENT_ID).toBe('');
    expect(env.METRICS_TOKEN).toBe('');
    expect(env.JWT_AUTH_ISSUER).toBe('http://localhost:3000');
    expect(env.DB_PASSWORD).toBe('root');
    expect(env.AUTH_OTP_PEPPER).toBe('hsr-default-salt');
    expect(env.STRIPE_BR_ENABLED).toBe(false);
    expect(env.AUTH_REFRESH_COOKIE_DOMAIN).toBe('');
  });

  test('keeps an explicit UPS production client id outside production', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      EDEN_RUNTIME: 'local',
      UPS_ENV: 'production',
      UPS_CLIENT_ID: 'abc'
    });

    expect(env.UPS_ENV).toBe('production');
    expect(env.UPS_CLIENT_ID).toBe('abc');
  });

  test('accepts a QA-only CORS list with SameSite lax', () => {
    const env = parseEnv(productionEnv());

    expect(env.NODE_ENV).toBe('production');
    expect(env.AUTH_REFRESH_COOKIE_SAME_SITE).toBe('lax');
    expect(env.CORS_ORIGINS).toEqual([
      'https://qa.edenbowls.com',
      'https://qa-admin.edenbowls.com'
    ]);
    expect(env.STRIPE_BR_ENABLED).toBe(true);
    expect(env.UPS_ENV).toBe('cie');
    expect(env.STRIPE_SHIPPING_PRODUCT_ID).toBeUndefined();
    expect(env.STRIPE_US_SHIPPING_PRODUCT_ID).toBeUndefined();
    expect(env.STRIPE_BR_SHIPPING_PRODUCT_ID).toBeUndefined();
  });

  test('ignores leftover shipping product ids', () => {
    const env = parseEnv(productionEnv({
      STRIPE_SHIPPING_PRODUCT_ID: 'prod_legacy',
      STRIPE_US_SHIPPING_PRODUCT_ID: 'prod_us',
      STRIPE_BR_SHIPPING_PRODUCT_ID: 'prod_br'
    }));

    expect(env.STRIPE_SHIPPING_PRODUCT_ID).toBeUndefined();
    expect(env.STRIPE_US_SHIPPING_PRODUCT_ID).toBeUndefined();
    expect(env.STRIPE_BR_SHIPPING_PRODUCT_ID).toBeUndefined();
  });

  test('ignores legacy Stripe credentials when the regional keys are absent', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      STRIPE_SECRET_KEY: 'sk_legacy',
      STRIPE_WEBHOOK_SECRET: 'whsec_legacy'
    });

    expect(env.STRIPE_US_SECRET_KEY).toBe('');
    expect(env.STRIPE_US_WEBHOOK_SECRET).toBe('');
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });

  test('ignores legacy Stripe credentials when the regional keys are set', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      STRIPE_SECRET_KEY: 'sk_legacy',
      STRIPE_WEBHOOK_SECRET: 'whsec_legacy',
      STRIPE_US_SECRET_KEY: 'sk_us',
      STRIPE_US_WEBHOOK_SECRET: 'whsec_us'
    });

    expect(env.STRIPE_US_SECRET_KEY).toBe('sk_us');
    expect(env.STRIPE_US_WEBHOOK_SECRET).toBe('whsec_us');
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });

  test('defaults the shared Stripe API version and retries', () => {
    const env = parseEnv({ NODE_ENV: 'development' });

    expect(env.STRIPE_API_VERSION).toBe('2025-09-30.clover');
    expect(env.STRIPE_MAX_RETRIES).toBe(2);
  });

  test('rejects production that only sets the legacy Stripe credentials', () => {
    expect(() => parseEnv(productionEnv({
      STRIPE_US_SECRET_KEY: '',
      STRIPE_SECRET_KEY: 'sk_legacy'
    }))).toThrow(/STRIPE_US_SECRET_KEY/);
    expect(() => parseEnv(productionEnv({
      STRIPE_US_WEBHOOK_SECRET: '',
      STRIPE_WEBHOOK_SECRET: 'whsec_legacy'
    }))).toThrow(/STRIPE_US_WEBHOOK_SECRET/);
  });

  test('parses production when the regional Stripe credentials are set', () => {
    const env = parseEnv(productionEnv({ STRIPE_BR_ENABLED: 'false' }));

    expect(env.STRIPE_US_SECRET_KEY).toBe('sk_us');
    expect(env.STRIPE_US_WEBHOOK_SECRET).toBe('whsec_us');
    expect(env.STRIPE_BR_SECRET_KEY).toBe('sk_br');
    expect(env.STRIPE_BR_WEBHOOK_SECRET).toBe('whsec_br');
    expect(env.STRIPE_BR_ENABLED).toBe(false);
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });

  test('accepts STRIPE_BR_ENABLED false', () => {
    const env = parseEnv(productionEnv({ STRIPE_BR_ENABLED: 'false' }));
    expect(env.STRIPE_BR_ENABLED).toBe(false);
  });

  test.each(['1', 'yes', 'on', ''])('rejects STRIPE_BR_ENABLED=%j in production', (value) => {
    expect(() => parseEnv(productionEnv({ STRIPE_BR_ENABLED: value }))).toThrow(/STRIPE_BR_ENABLED/);
  });

  test('rejects placeholder and blank production secrets', () => {
    expect(() => parseEnv(productionEnv({ JWT_AUTH_SECRET_KEY: 'change-this-in-production' }))).toThrow(/JWT_AUTH_SECRET_KEY/);
    expect(() => parseEnv(productionEnv({ AUTH_OTP_PEPPER: 'hsr-default-salt' }))).toThrow(/AUTH_OTP_PEPPER/);
    expect(() => parseEnv(productionEnv({ AUTH_OTP_PEPPER: '', AUTH_SALT: '' }))).toThrow(/AUTH_OTP_PEPPER/);
    expect(() => parseEnv(productionEnv({ DB_PASSWORD: '' }))).toThrow(/DB_PASSWORD/);
    expect(() => parseEnv(productionEnv({ METRICS_TOKEN: '' }))).toThrow(/METRICS_TOKEN/);
    expect(() => parseEnv(productionEnv({ UPS_ENV: '' }))).toThrow(/UPS_ENV/);
  });

  test('rejects a localhost JWT issuer in production', () => {
    expect(() => parseEnv(productionEnv({ JWT_AUTH_ISSUER: 'http://localhost:3000' }))).toThrow(/JWT_AUTH_ISSUER/);
  });

  test('rejects a non-empty refresh cookie domain in production', () => {
    expect(() => parseEnv(productionEnv({ AUTH_REFRESH_COOKIE_DOMAIN: '.edenbowls.com' }))).toThrow(/AUTH_REFRESH_COOKIE_DOMAIN/);
  });

  test('rejects http and localhost CORS origins in production', () => {
    expect(() => parseEnv(productionEnv({ CORS_ORIGINS: 'http://qa.edenbowls.com' }))).toThrow(/CORS_ORIGINS/);
    expect(() => parseEnv(productionEnv({ CORS_ORIGINS: 'https://localhost:5173' }))).toThrow(/CORS_ORIGINS/);
  });

  test('requires SameSite none when both TLDs are allowed', () => {
    const origins = 'https://www.edenbowls.com,https://www.edenbowls.com.br';
    expect(() => parseEnv(productionEnv({ CORS_ORIGINS: origins }))).toThrow(/SAME_SITE/);
    const env = parseEnv(productionEnv({
      CORS_ORIGINS: origins,
      AUTH_REFRESH_COOKIE_SAME_SITE: 'none'
    }));
    expect(env.AUTH_REFRESH_COOKIE_SAME_SITE).toBe('none');
  });
});
