const { HttpError } = require('../src/core/http-error');
const { StripeAccounts } = require('../src/infrastructure/stripe/stripe-accounts');

function client(account) {
  return { account, missingReason: null };
}

function expectHttpError(fn, code) {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect(error.statusCode).toBe(503);
    expect(error.details.code).toBe(code);
  }
}

describe('StripeAccounts registry', () => {
  test('blocks BR creation when the kill switch is off', () => {
    const accounts = new StripeAccounts({
      us: client('us'),
      br: client('br'),
      brEnabled: false
    });

    expectHttpError(() => accounts.getForCreation('br'), 'stripe_br_disabled');
    expect(accounts.get('br').account).toBe('br');
  });

  test('returns stripe_br_not_configured when the BR secret is missing', () => {
    const accounts = new StripeAccounts({
      us: client('us'),
      br: { account: 'br', missingReason: 'secret' },
      brEnabled: true
    });

    expectHttpError(() => accounts.getForCreation('br'), 'stripe_br_not_configured');
  });

  test('names STRIPE_US_SECRET_KEY when the US secret is missing', () => {
    const accounts = new StripeAccounts({
      us: { account: 'us', missingReason: 'secret' },
      br: client('br'),
      brEnabled: true
    });

    try {
      accounts.get('us');
      throw new Error('expected stripe_secret_missing');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error.statusCode).toBe(503);
      expect(error.details.code).toBe('stripe_secret_missing');
      expect(error.message).toContain('STRIPE_US_SECRET_KEY');
    }
  });

  test('keeps US creation available while BR is disabled', () => {
    const accounts = new StripeAccounts({
      us: client('us'),
      br: client('br'),
      brEnabled: false
    });

    expect(accounts.getForCreation('us').account).toBe('us');
  });
});

describe('StripeAccounts webhook secrets', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  let dir;
  let secretsFile;
  let previousFileEnv;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-secrets-'));
    secretsFile = path.join(dir, 'stripe-webhook-secrets.json');
    previousFileEnv = process.env.STRIPE_WEBHOOK_SECRETS_FILE;
    process.env.STRIPE_WEBHOOK_SECRETS_FILE = secretsFile;
  });

  afterEach(() => {
    if (previousFileEnv === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRETS_FILE;
    } else {
      process.env.STRIPE_WEBHOOK_SECRETS_FILE = previousFileEnv;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function build(nodeEnv, logger) {
    return new StripeAccounts({
      us: client('us'),
      br: client('br'),
      usWebhookSecret: 'whsec_envUs',
      brWebhookSecret: 'whsec_envBr',
      nodeEnv,
      logger
    });
  }

  test('prefers the listener file over the env in development', () => {
    fs.writeFileSync(secretsFile, JSON.stringify({ us: 'whsec_fileUs', br: 'whsec_fileBr' }));
    const accounts = build('development');

    expect(accounts.webhookSecret('us')).toBe('whsec_fileUs');
    expect(accounts.webhookSecret('br')).toBe('whsec_fileBr');
  });

  test('falls back to the env when the file is missing in development', () => {
    const logger = { warn: jest.fn() };
    const accounts = build('development', logger);

    expect(accounts.webhookSecret('us')).toBe('whsec_envUs');
    expect(accounts.webhookSecret('us')).toBe('whsec_envUs');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('falls back to the env when the file is invalid JSON in development', () => {
    fs.writeFileSync(secretsFile, '{not json');
    const accounts = build('development', { warn: jest.fn() });

    expect(() => accounts.webhookSecret('br')).not.toThrow();
    expect(accounts.webhookSecret('br')).toBe('whsec_envBr');
  });

  test('falls back to the env for an account missing from the file', () => {
    fs.writeFileSync(secretsFile, JSON.stringify({ us: 'whsec_fileUs' }));
    const accounts = build('development');

    expect(accounts.webhookSecret('br')).toBe('whsec_envBr');
  });

  test.each(['production', 'test'])('ignores the file in %s', (nodeEnv) => {
    fs.writeFileSync(secretsFile, JSON.stringify({ us: 'whsec_fileUs', br: 'whsec_fileBr' }));
    const readSpy = jest.spyOn(fs, 'readFileSync');
    const accounts = build(nodeEnv);

    expect(accounts.webhookSecret('us')).toBe('whsec_envUs');
    expect(accounts.webhookSecret('br')).toBe('whsec_envBr');
    expect(readSpy).not.toHaveBeenCalledWith(secretsFile, expect.anything());
    readSpy.mockRestore();
  });

  test('reads the new secret when the file changes between calls', () => {
    fs.writeFileSync(secretsFile, JSON.stringify({ us: 'whsec_first' }));
    const accounts = build('development');
    expect(accounts.webhookSecret('us')).toBe('whsec_first');

    fs.writeFileSync(secretsFile, JSON.stringify({ us: 'whsec_second' }));
    expect(accounts.webhookSecret('us')).toBe('whsec_second');
  });

  test('says the listener secret is not available yet when no source has one', async () => {
    const { StripeWebhookService } = require('../src/services/stripe-webhook.service');
    const accounts = new StripeAccounts({ us: client('us'), br: client('br'), nodeEnv: 'development' });
    const service = new StripeWebhookService({ stripeAccounts: accounts, eventsRepository: {}, ledgerRepository: {} });

    await expect(service.handle({ account: 'us', rawBody: Buffer.from('{}'), signature: 'sig' })).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining('listener secret for US is not available yet'),
      details: { code: 'stripe_webhook_secret_missing' }
    });
  });
});
