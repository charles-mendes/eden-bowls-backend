const { HttpError } = require('../src/core/http-error');
const {
  CUSTOMER_META_KEYS,
  ledgerStripeAccount,
  parseStripeAccountInput,
  resolveStripeAccountFromCountry,
  stripeAccountFromMarket
} = require('../src/core/stripe-account');

describe('stripe account helpers', () => {
  test('resolves BR and US from country', () => {
    expect(resolveStripeAccountFromCountry('BR')).toBe('br');
    expect(resolveStripeAccountFromCountry('US')).toBe('us');
    expect(stripeAccountFromMarket({ country: 'BR' })).toBe('br');
  });

  test('rejects countries outside BR and US', () => {
    expect(() => resolveStripeAccountFromCountry('AR')).toThrow(HttpError);
  });

  test('parses account input with US fallback', () => {
    expect(parseStripeAccountInput('')).toBe('us');
    expect(parseStripeAccountInput('BR')).toBe('br');
    expect(() => parseStripeAccountInput('eu')).toThrow(HttpError);
  });

  test('reads the persisted ledger account instead of the current country', () => {
    expect(ledgerStripeAccount({ stripe_account: 'br' })).toBe('br');
    expect(ledgerStripeAccount({ stripeAccount: 'us' })).toBe('us');
    expect(ledgerStripeAccount({})).toBe('us');
  });

  test('keeps customer meta keys isolated per account', () => {
    expect(CUSTOMER_META_KEYS.br).toBe('_hsr_stripe_customer_id_br');
    expect(CUSTOMER_META_KEYS.us).toBe('_hsr_stripe_customer_id_us');
  });
});
