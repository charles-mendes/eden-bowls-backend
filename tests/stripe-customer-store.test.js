const { StripeCustomerStore } = require('../src/infrastructure/stripe/stripe-customer-store');
const { CUSTOMER_META_KEYS, LEGACY_CUSTOMER_META_KEY } = require('../src/core/stripe-account');

describe('StripeCustomerStore account isolation', () => {
  test('requires an account to read or write a customer id', async () => {
    const store = new StripeCustomerStore({ isInitialized: true, query: jest.fn() });

    await expect(store.getCustomerId(7)).rejects.toMatchObject({
      details: { code: 'invalid_stripe_account' }
    });
    await expect(store.saveCustomerId(7, 'cus_1')).rejects.toMatchObject({
      details: { code: 'invalid_stripe_account' }
    });
  });

  test('reads US from the renamed meta key and falls back to the legacy key', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ meta_value: 'cus_legacy' }]);
    const store = new StripeCustomerStore({ isInitialized: true, query });

    await expect(store.getCustomerId(7, 'us')).resolves.toBe('cus_legacy');
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('meta_key'),
      [7, CUSTOMER_META_KEYS.us]
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('meta_key'),
      [7, LEGACY_CUSTOMER_META_KEY]
    );
  });

  test('does not read the US customer id when loading BR', async () => {
    const query = jest.fn().mockResolvedValue([{ meta_value: 'cus_us' }]);
    const store = new StripeCustomerStore({ isInitialized: true, query });

    await store.getCustomerId(7, 'br');

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), [7, CUSTOMER_META_KEYS.br]);
  });

  test('writes each account to its own meta key', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const store = new StripeCustomerStore({ isInitialized: true, query });

    await store.saveCustomerId(7, 'cus_br', 'br');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT'),
      [7, CUSTOMER_META_KEYS.br, 'cus_br']
    );
  });
});
