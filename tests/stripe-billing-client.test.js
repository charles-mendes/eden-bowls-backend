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
    invoices: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'in_123',
        confirmation_secret: {
          client_secret: 'pi_retrieved_secret',
          type: 'payment_intent'
        }
      })
    },
    prices: {
      retrieve: jest.fn().mockImplementation(async (id) => ({
        id,
        currency: 'usd',
        recurring: { interval: 'month', interval_count: 1 }
      })),
      list: jest.fn().mockResolvedValue({ data: [] }),
      create: jest.fn().mockResolvedValue({ id: 'price_live' })
    },
    products: {
      create: jest.fn().mockResolvedValue({ id: 'prod_ship' }),
      update: jest.fn().mockImplementation(async (id, payload) => ({ id, ...payload }))
    },
    promotionCodes: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'promo_1m',
        active: true,
        promotion: { type: 'coupon', coupon: 'eden_fp_1m' }
      })
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
        payment_settings: { save_default_payment_method: 'on_subscription' },
        billing_mode: { type: 'flexible' },
        discounts: [{ coupon: 'eden_fp_1m' }]
      }),
      { idempotencyKey: 'eb-sub-create-7-test' }
    );
    expect(stripe.subscriptions.create.mock.calls[0][0].expand).toBeUndefined();
  });

  test('retrieves confirmation_secret when create returns only an invoice id', async () => {
    const { stripe, client } = buildClient({
      stripe: {
        subscriptions: {
          create: jest.fn().mockResolvedValue({
            id: 'sub_plain',
            status: 'incomplete',
            latest_invoice: 'in_clover'
          })
        },
        invoices: {
          retrieve: jest.fn().mockResolvedValue({
            id: 'in_clover',
            subtotal: 4000,
            total: 5290,
            amount_due: 5290,
            currency: 'usd',
            confirmation_secret: {
              client_secret: 'pi_fetched_secret_xyz',
              type: 'payment_intent'
            }
          })
        }
      }
    });

    const result = await client.createOnboardingSubscription(validInput);

    expect(stripe.invoices.retrieve).toHaveBeenCalledWith('in_clover', {
      expand: ['confirmation_secret']
    });
    expect(result.checkout.stripe_client_secret).toBe('pi_fetched_secret_xyz');
    expect(result.checkout.stripe_payment_intent_id).toBe('pi_fetched');
  });

  test('reads the Clover confirmation_secret when payment_intent is absent', async () => {
    const { client } = buildClient({
      stripe: {
        subscriptions: {
          create: jest.fn().mockResolvedValue({
            id: 'sub_clover',
            status: 'incomplete',
            latest_invoice: {
              subtotal: 4000,
              total: 5290,
              amount_due: 5290,
              currency: 'usd',
              confirmation_secret: {
                client_secret: 'pi_clover_secret_abc',
                type: 'payment_intent'
              }
            }
          })
        }
      }
    });

    const result = await client.createOnboardingSubscription(validInput);

    expect(result.checkout.stripe_client_secret).toBe('pi_clover_secret_abc');
    expect(result.checkout.stripe_payment_intent_id).toBe('pi_clover');
    expect(result.checkout.payment_state).toBe('requires_confirmation');
  });

  test('materializes seeded catalog prices before creating the subscription', async () => {
    const { stripe, client } = buildClient({
      stripe: {
        prices: {
          retrieve: jest.fn().mockImplementation(async (id) => ({
            id,
            currency: 'brl',
            recurring: { interval: 'month', interval_count: 1 }
          })),
          list: jest.fn().mockResolvedValue({ data: [] }),
          create: jest.fn()
            .mockResolvedValueOnce({ id: 'price_live_beef' })
            .mockResolvedValueOnce({ id: 'price_live_fish' })
        },
        products: {
          create: jest.fn()
            .mockResolvedValueOnce({ id: 'prod_beef' })
            .mockResolvedValueOnce({ id: 'prod_fish' })
        }
      }
    });

    await client.createOnboardingSubscription({
      ...validInput,
      currency: 'brl',
      address: { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' },
      items: [
        { price: 'price_seed_br_beef_300g', quantity: 2, unit_price: 25, currency: 'brl' },
        { price: 'price_seed_br_fish_300g', quantity: 1, unit_price: 35, currency: 'brl' }
      ]
    });

    expect(stripe.prices.create).toHaveBeenCalledWith(expect.objectContaining({
      currency: 'brl',
      unit_amount: 2500,
      lookup_key: 'eden_seed_br_beef_300g',
      recurring: { interval: 'month' }
    }));
    expect(stripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { price: 'price_live_beef', quantity: 2 },
          { price: 'price_live_fish', quantity: 1 }
        ]
      }),
      expect.any(Object)
    );
  });

  test('reuses an existing Stripe price for a seeded catalog lookup key', async () => {
    const { stripe, client } = buildClient({
      stripe: {
        prices: {
          retrieve: jest.fn(),
          list: jest.fn().mockResolvedValue({ data: [{ id: 'price_existing' }] }),
          create: jest.fn()
        }
      }
    });

    await client.createOnboardingSubscription({
      ...validInput,
      items: [{ price: 'price_seed_us_beef_10_6oz', quantity: 1, unit_price: 25, currency: 'usd' }]
    });

    expect(stripe.prices.create).not.toHaveBeenCalled();
    expect(stripe.subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ price: 'price_existing', quantity: 1 }]
      }),
      expect.any(Object)
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
      details: {
        code: 'stripe_subscription_failed',
        stripe_code: 'card_declined',
        stripe_type: 'StripeCardError'
      }
    });
  });

  test('creates a new Stripe customer when the stored one is in another currency', async () => {
    const { stripe, client } = buildClient({
      stripe: {
        customers: {
          retrieve: jest.fn().mockResolvedValue({ id: 'cus_stored', currency: 'brl', deleted: false }),
          list: jest.fn().mockResolvedValue({
            data: [{ id: 'cus_stored', currency: 'brl', deleted: false }]
          }),
          create: jest.fn().mockResolvedValue({ id: 'cus_usd' }),
          update: jest.fn().mockResolvedValue({ id: 'cus_usd' })
        }
      }
    });

    const result = await client.createOnboardingSubscription(validInput);

    expect(stripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'jane@example.com',
      metadata: expect.objectContaining({ billing_currency: 'usd' })
    }));
    expect(stripe.subscriptions.create.mock.calls[0][0].customer).toBe('cus_usd');
    expect(result.customerId).toBe('cus_usd');
  });

  test('clones a saved card onto the currency-matching Stripe customer', async () => {
    const { stripe, client } = buildClient({
      stripe: {
        paymentMethods: {
          retrieve: jest.fn().mockResolvedValue({ id: 'pm_123', customer: 'cus_brl' }),
          attach: jest.fn(),
          create: jest.fn().mockResolvedValue({ id: 'pm_cloned', customer: 'cus_stored' })
        }
      }
    });

    await client.createOnboardingSubscription(validInput);

    expect(stripe.paymentMethods.create).toHaveBeenCalledWith({
      customer: 'cus_stored',
      payment_method: 'pm_123'
    });
    expect(stripe.paymentMethods.attach).not.toHaveBeenCalled();
    expect(stripe.subscriptions.create.mock.calls[0][0].default_payment_method).toBe('pm_cloned');
  });

  test('maps a Stripe currency-conflict error to a safe checkout message', async () => {
    const { client } = buildClient({
      stripe: {
        subscriptions: {
          create: jest.fn().mockRejectedValue({
            type: 'StripeInvalidRequestError',
            message: 'You cannot combine currencies on a single customer. This customer has an active subscription, subscription schedule, discount, quote, or invoice item with currency brl.'
          })
        }
      }
    });

    await expect(client.createOnboardingSubscription(validInput)).rejects.toMatchObject({
      statusCode: 502,
      message: 'This account already has a subscription in a different currency. Finish checkout in that currency, or add a new card to start a plan in this one.',
      details: { code: 'stripe_subscription_failed' }
    });
  });

  test('forwards Stripe param when the error has no code', async () => {
    const { client } = buildClient({
      stripe: {
        subscriptions: {
          create: jest.fn().mockRejectedValue({
            type: 'StripeInvalidRequestError',
            rawType: 'invalid_request_error',
            param: 'expand',
            raw: { type: 'invalid_request_error', param: 'expand' },
            message: 'This property cannot be expanded.'
          })
        }
      }
    });

    await expect(client.createOnboardingSubscription(validInput)).rejects.toMatchObject({
      statusCode: 502,
      message: 'Unable to create Stripe subscription.',
      details: {
        code: 'stripe_subscription_failed',
        stripe_code: null,
        stripe_type: 'StripeInvalidRequestError',
        stripe_param: 'expand'
      }
    });
  });

  test('applies the promotion coupon instead of promotion_code', async () => {
    const { stripe, client } = buildClient();

    await client.createOnboardingSubscription(validInput);

    expect(stripe.promotionCodes.retrieve).toHaveBeenCalledWith('promo_1m');
    expect(stripe.subscriptions.create.mock.calls[0][0].discounts).toEqual([{ coupon: 'eden_fp_1m' }]);
  });

  test('reuses an incomplete Stripe subscription for the same fingerprint', async () => {
    const { stripe, client } = buildClient({
      stripe: {
        subscriptions: {
          list: jest.fn().mockResolvedValue({
            data: [{
              id: 'sub_existing',
              status: 'incomplete',
              latest_invoice: 'in_existing',
              metadata: { checkout_context_fingerprint: 'abc', user_id: '7' }
            }]
          }),
          create: jest.fn(),
          update: jest.fn().mockResolvedValue({ id: 'sub_existing' })
        },
        invoices: {
          retrieve: jest.fn().mockResolvedValue({
            id: 'in_existing',
            subtotal: 4000,
            total: 5290,
            amount_due: 5290,
            currency: 'usd',
            confirmation_secret: {
              client_secret: 'pi_existing_secret_abc',
              type: 'payment_intent'
            }
          })
        }
      }
    });

    const result = await client.createOnboardingSubscription(validInput);

    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(result.checkout.stripe_subscription_id).toBe('sub_existing');
    expect(result.checkout.stripe_client_secret).toBe('pi_existing_secret_abc');
    expect(result.checkout.reused).toBe(true);
  });

  test('rejects a promotion code that Stripe cannot retrieve', async () => {
    const { client } = buildClient({
      stripe: {
        promotionCodes: {
          retrieve: jest.fn().mockRejectedValue({
            type: 'StripeInvalidRequestError',
            code: 'resource_missing',
            param: 'id',
            message: 'No such promotion code'
          })
        }
      }
    });

    await expect(client.createOnboardingSubscription(validInput)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_promotion_code_id', stripe_code: 'resource_missing' }
    });
  });
});

describe('StripeBillingClient.ensureClient', () => {
  test('reports a missing secret key', () => {
    const client = new StripeBillingClient({});
    expect(() => client.ensureClient()).toThrow(expect.objectContaining({
      statusCode: 503,
      details: { code: 'stripe_secret_missing' }
    }));
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

describe('StripeBillingClient.archiveCatalogProduct', () => {
  test('archives a live Stripe product', async () => {
    const { stripe, client } = buildClient();

    await expect(client.archiveCatalogProduct('prod_live_2011')).resolves.toBe('prod_live_2011');
    expect(stripe.products.update).toHaveBeenCalledWith('prod_live_2011', { active: false });
  });

  test('skips seed Stripe product ids', async () => {
    const { stripe, client } = buildClient();

    await expect(client.archiveCatalogProduct('prod_seed_br_beef_300g')).resolves.toBeNull();
    expect(stripe.products.update).not.toHaveBeenCalled();
  });
});

describe('extractInvoicePayment', () => {
  const { couponIdFromPromotion, extractInvoicePayment } = require('../src/infrastructure/stripe/stripe-billing-client');

  test('prefers confirmation_secret on Clover invoices', () => {
    expect(extractInvoicePayment({
      confirmation_secret: { client_secret: 'pi_abc_secret_xyz', type: 'payment_intent' }
    })).toEqual({
      clientSecret: 'pi_abc_secret_xyz',
      paymentIntentId: 'pi_abc',
      paymentIntentStatus: ''
    });
  });

  test('reads Clover promotion.coupon', () => {
    expect(couponIdFromPromotion({
      promotion: { type: 'coupon', coupon: 'nVJYDOag' }
    })).toBe('nVJYDOag');
  });
});
