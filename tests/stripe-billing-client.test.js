const { StripeBillingClient } = require('../src/infrastructure/stripe/stripe-billing-client');

function buildClient(overrides = {}) {
  const stripe = {
    customers: {
      retrieve: jest.fn().mockResolvedValue({ id: 'cus_stored', deleted: false }),
      list: jest.fn().mockResolvedValue({ data: [] }),
      create: jest.fn().mockResolvedValue({ id: 'cus_new' }),
      update: jest.fn().mockResolvedValue({ id: 'cus_stored' })
    },
    paymentMethods: {
      retrieve: jest.fn().mockResolvedValue({ id: 'pm_123', customer: null }),
      attach: jest.fn().mockResolvedValue({ id: 'pm_123' })
    },
    prices: {
      retrieve: jest.fn().mockImplementation(async (id) => ({
        id,
        currency: 'usd',
        recurring: { interval: 'month', interval_count: 1 }
      }))
    },
    products: {
      create: jest.fn().mockResolvedValue({ id: 'prod_ship' })
    },
    subscriptions: {
      create: jest.fn().mockResolvedValue({
        id: 'sub_123',
        status: 'incomplete',
        latest_invoice: {
          subtotal: 4000,
          total: 5290,
          amount_due: 5290,
          tax: 0,
          currency: 'usd',
          payment_intent: {
            id: 'pi_123',
            status: 'requires_confirmation',
            client_secret: 'pi_123_secret'
          }
        }
      })
    },
    ...overrides.stripe
  };

  return {
    stripe,
    client: new StripeBillingClient({
      client: stripe,
      automaticTaxEnabled: overrides.automaticTaxEnabled !== false,
      shippingProductId: overrides.shippingProductId || 'prod_ship'
    })
  };
}

const validInput = {
  userId: 7,
  email: 'jane@example.com',
  name: 'Jane Doe',
  existingCustomerId: 'cus_stored',
  paymentMethodId: 'pm_123',
  items: [{ price: 'price_abc', quantity: 1 }],
  address: { country: 'US', zipcode: '94105', state: 'CA', city: 'San Francisco' },
  shipping: { cost: 12.9 },
  currency: 'usd',
  promotionCodeId: 'promo_1m',
  subscriptionTermMonths: 1,
  attemptId: 'attempt-1',
  checkoutContextFingerprint: 'abc',
  idempotencyKey: 'eb-sub-create-7-test'
};

describe('StripeBillingClient.createOnboardingSubscription', () => {
  test('creates a subscription with order_id 0 and automatic tax for US', async () => {
    const { stripe, client } = buildClient();

    const result = await client.createOnboardingSubscription(validInput);

    expect(result.checkout.order_id).toBe(0);
    expect(result.checkout.stripe_client_secret).toBe('pi_123_secret');
    expect(result.checkout.payment_state).toBe('requires_confirmation');
    expect(result.checkout.total).toBe(52.9);
    expect(stripe.customers.list).not.toHaveBeenCalled();
    expect(stripe.customers.retrieve).toHaveBeenCalledWith('cus_stored');
    expect(stripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        automatic_tax: { enabled: true },
        default_payment_method: 'pm_123',
        payment_behavior: 'default_incomplete',
        discounts: [{ promotion_code: 'promo_1m' }]
      }),
      { idempotencyKey: 'eb-sub-create-7-test' }
    );
  });

  test('does not enable automatic tax for BR', async () => {
    const { stripe, client } = buildClient();

    await client.createOnboardingSubscription({
      ...validInput,
      address: { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' }
    });

    const params = stripe.subscriptions.create.mock.calls[0][0];
    expect(params.automatic_tax).toBeUndefined();
  });

  test('rejects US automatic tax without a ZIP', async () => {
    const { client } = buildClient();

    await expect(client.createOnboardingSubscription({
      ...validInput,
      address: { country: 'US', state: 'CA', city: 'San Francisco' }
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'sales_tax_unavailable' }
    });
  });

  test('rejects checkout without a payment method', async () => {
    const { client } = buildClient();

    await expect(client.createOnboardingSubscription({
      ...validInput,
      paymentMethodId: ''
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_payment_method' }
    });
  });

  test('rejects mixed price cycles', async () => {
    const { client } = buildClient({
      stripe: {
        prices: {
          retrieve: jest.fn()
            .mockResolvedValueOnce({ id: 'price_a', currency: 'usd', recurring: { interval: 'month', interval_count: 1 } })
            .mockResolvedValueOnce({ id: 'price_b', currency: 'usd', recurring: { interval: 'month', interval_count: 3 } })
        }
      }
    });

    await expect(client.createOnboardingSubscription({
      ...validInput,
      items: [{ price: 'price_a', quantity: 1 }, { price: 'price_b', quantity: 1 }]
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_subscription_items_mixed_cycle_or_currency' }
    });
  });

  test('maps Stripe errors without leaking the upstream message', async () => {
    const { client } = buildClient({
      stripe: {
        subscriptions: {
          create: jest.fn().mockRejectedValue({
            type: 'StripeCardError',
            code: 'card_declined',
            message: 'Your card was declined for secret reason xyz'
          })
        }
      }
    });

    await expect(client.createOnboardingSubscription(validInput)).rejects.toMatchObject({
      statusCode: 502,
      message: 'The card could not be charged.',
      details: { code: 'stripe_subscription_failed' }
    });
  });
});

describe('StripeBillingClient.resolvePaymentState', () => {
  test('treats requires_payment_method as failed', () => {
    const { client } = buildClient();
    expect(client.resolvePaymentState({
      paymentMethodId: 'pm_123',
      paymentIntentStatus: 'requires_payment_method'
    })).toBe('failed');
  });
});
