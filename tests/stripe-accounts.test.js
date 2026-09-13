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

  test('keeps US creation available while BR is disabled', () => {
    const accounts = new StripeAccounts({
      us: client('us'),
      br: client('br'),
      brEnabled: false
    });

    expect(accounts.getForCreation('us').account).toBe('us');
  });
});
