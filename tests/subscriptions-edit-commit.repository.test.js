const { SubscriptionsEditCommitRepository } = require('../src/infrastructure/repositories/subscriptions-edit-commit.repository');
const { buildCurrentHash } = require('../src/core/subscription-edit-hash');
const { ShippingQuoteSigner } = require('../src/core/shipping-quote-token');

const quoteSigner = new ShippingQuoteSigner({ secret: 'test-shipping-quote-secret' });
const US_EDIT_ADDRESS = { country: 'US', state: 'CA', postal_code: '94105', line1: '1 Market St', city: 'San Francisco' };

function signedShipping({ cost = 12.9, deliveryDays = 1, zipcode = '94105', signer = quoteSigner } = {}) {
  return {
    method_id: 'ups_ground',
    cost,
    total: cost,
    delivery_days: deliveryDays,
    quote_token: signer.sign({ country: 'US', zipcode, cost, deliveryDays })
  };
}

describe('SubscriptionsEditCommitRepository', () => {
  const previousRuntime = process.env.EDEN_RUNTIME;

  beforeAll(() => {
    process.env.EDEN_RUNTIME = 'qa';
  });

  afterAll(() => {
    if (previousRuntime === undefined) {
      delete process.env.EDEN_RUNTIME;
    } else {
      process.env.EDEN_RUNTIME = previousRuntime;
    }
  });

  const currentItems = [{ id: 'si_1', price: 'price_abc', quantity: 1 }];
  const hash = buildCurrentHash({
    items: [{ price: 'price_abc', quantity: 1 }],
    termMonths: 1,
    address: { country: 'US' },
    shipping: { cost: 12.9 }
  });

  function buildRepo(overrides = {}) {
    const stripeBilling = {
      retrieveSubscription: jest.fn().mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        customer: 'cus_1',
        default_payment_method: { id: 'pm_123' },
        items: { data: currentItems.map((item) => ({ id: item.id, price: { id: item.price }, quantity: item.quantity })) },
        metadata: { wp_user_id: '7' }
      }),
      previewProration: jest.fn().mockResolvedValue({ amount_due: 0, total: 0, currency: 'usd' }),
      updateSubscriptionItems: jest.fn().mockResolvedValue({
        latest_invoice: {},
        default_payment_method: { id: 'pm_123' }
      }),
      resolvePaymentState: jest.fn().mockReturnValue('paid'),
      shippingProductId: 'prod_ship',
      ...overrides.stripeBilling
    };
    const ledgerRow = {
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_1',
      status: 'active',
      subscriptionTermMonths: 1,
      address: { country: 'US' },
      shipping: { cost: 12.9 }
    };
    const ledgerRepository = {
      findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(ledgerRow),
      upsert: jest.fn().mockResolvedValue(ledgerRow)
    };
    const planPreviewRepository = {
      previewPlan: jest.fn().mockResolvedValue({
        subscription_term_months: 1,
        catalog_pricing: { subtotal: 30, currency: 'USD', line_items: [] },
        pets: [{ pet_id: 'pet_1', pet_name: 'Milo' }]
      })
    };

    return new SubscriptionsEditCommitRepository({
      ledgerRepository,
      stripeBilling,
      planPreviewRepository,
      resolveSubscriptionItems: jest.fn().mockResolvedValue(overrides.proposedItems || [{ price: 'price_abc', quantity: 1 }]),
      shippingQuoteSigner: quoteSigner,
      transactionalMailer: overrides.transactionalMailer || null,
      logger: overrides.logger || { error: jest.fn(), warn() {}, info() {} }
    });
  }

  const moreRecipes = [{ price: 'price_abc', quantity: 2 }];

  test('applies credit/none without a client secret and without first-purchase discounts', async () => {
    const repository = buildRepo({ proposedItems: moreRecipes });
    const result = await repository.commit(7, 'sub_123', {
      subscription_term_months: 1,
      expected_current_hash: hash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
      address: US_EDIT_ADDRESS,
      shipping: signedShipping()
    });

    expect(result.stripe_client_secret).toBeNull();
    expect(result.edit_payment_pending).toBe(false);
    expect(result.payment_state).toBe('paid');
    expect(repository.stripeBilling.updateSubscriptionItems).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_123',
      prorationBehavior: 'create_prorations'
    }));
    const updateArg = repository.stripeBilling.updateSubscriptionItems.mock.calls[0][0];
    expect(updateArg.discounts).toBeUndefined();
    expect(updateArg.promotion_code).toBeUndefined();
  });

  test('returns requires_confirmation when the proration invoice needs a PaymentIntent', async () => {
    const repository = buildRepo({
      proposedItems: moreRecipes,
      stripeBilling: {
        retrieveSubscription: jest.fn().mockResolvedValue({
          id: 'sub_123',
          status: 'active',
          customer: 'cus_1',
          default_payment_method: { id: 'pm_123' },
          items: { data: currentItems.map((item) => ({ id: item.id, price: { id: item.price }, quantity: item.quantity })) },
          metadata: {}
        }),
        previewProration: jest.fn().mockResolvedValue({ amount_due: 1250, total: 1250, currency: 'usd' }),
        updateSubscriptionItems: jest.fn().mockResolvedValue({
          latest_invoice: {
            id: 'in_prorate',
            payment_intent: {
              id: 'pi_1',
              status: 'requires_confirmation',
              client_secret: 'pi_1_secret'
            }
          },
          default_payment_method: { id: 'pm_123' }
        }),
        resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation'),
        shippingProductId: 'prod_ship'
      }
    });

    const result = await repository.commit(7, 'sub_123', {
      subscription_term_months: 1,
      expected_current_hash: hash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
      address: US_EDIT_ADDRESS,
      shipping: signedShipping(),
      payment_method_id: 'pm_123'
    });

    expect(result.edit_payment_pending).toBe(true);
    expect(result.payment_state).toBe('requires_confirmation');
    expect(result.stripe_client_secret).toBe('pi_1_secret');
  });

  test('sends plan changed after an immediate commit and still succeeds when mail throws', async () => {
    const notifyPlanChanged = jest.fn().mockResolvedValue({ claimed: true });
    const repository = buildRepo({
      transactionalMailer: { notifyPlanChanged }
    });
    const payload = {
      subscription_term_months: 1,
      expected_current_hash: hash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
      address: US_EDIT_ADDRESS,
      shipping: signedShipping()
    };

    const result = await repository.commit(7, 'sub_123', payload);

    expect(result.edit_payment_pending).toBe(false);
    expect(notifyPlanChanged).toHaveBeenCalledTimes(1);
    expect(notifyPlanChanged).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_123',
      referenceId: expect.stringMatching(/^plan:/)
    }));

    notifyPlanChanged.mockRejectedValueOnce(Object.assign(new Error('smtp down'), { code: 'EENVELOPE' }));
    await expect(repository.commit(7, 'sub_123', payload)).resolves.toMatchObject({
      subscription_id: 'sub_123',
      edit_payment_pending: false
    });
  });

  test('does not send plan changed when the edit is waiting for payment', async () => {
    const notifyPlanChanged = jest.fn();
    const repository = buildRepo({
      proposedItems: moreRecipes,
      transactionalMailer: { notifyPlanChanged },
      stripeBilling: {
        retrieveSubscription: jest.fn().mockResolvedValue({
          id: 'sub_123',
          status: 'active',
          customer: 'cus_1',
          default_payment_method: { id: 'pm_123' },
          items: { data: currentItems.map((item) => ({ id: item.id, price: { id: item.price }, quantity: item.quantity })) },
          metadata: {}
        }),
        previewProration: jest.fn().mockResolvedValue({ amount_due: 1250, total: 1250, currency: 'usd' }),
        updateSubscriptionItems: jest.fn().mockResolvedValue({
          latest_invoice: {
            id: 'in_prorate',
            payment_intent: {
              id: 'pi_1',
              status: 'requires_confirmation',
              client_secret: 'pi_1_secret'
            }
          },
          default_payment_method: { id: 'pm_123' }
        }),
        resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation'),
        shippingProductId: 'prod_ship'
      }
    });

    const result = await repository.commit(7, 'sub_123', {
      subscription_term_months: 1,
      expected_current_hash: hash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
      address: US_EDIT_ADDRESS,
      shipping: signedShipping(),
      payment_method_id: 'pm_123'
    });

    expect(result.edit_payment_pending).toBe(true);
    expect(notifyPlanChanged).not.toHaveBeenCalled();
  });

  describe('signed shipping quote', () => {
    const basePayload = {
      subscription_term_months: 1,
      expected_current_hash: hash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
      address: US_EDIT_ADDRESS
    };

    async function expectRefused(repository, payload) {
      await expect(repository.commit(7, 'sub_123', payload)).rejects.toMatchObject({
        statusCode: 422,
        details: { code: 'delivery_area_unverified' }
      });
      expect(repository.stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
      expect(repository.ledgerRepository.upsert).not.toHaveBeenCalled();
    }

    test('refuses a shipping value changed after signing and leaves Stripe untouched', async () => {
      const repository = buildRepo();
      await expectRefused(repository, { ...basePayload, shipping: { ...signedShipping(), cost: 0.5, total: 0.5 } });
    });

    test('refuses a missing quote, a quote for another ZIP code, and an address sent without a quote', async () => {
      await expectRefused(buildRepo(), { ...basePayload, shipping: { cost: 12.9 } });
      await expectRefused(buildRepo(), { ...basePayload, shipping: signedShipping({ zipcode: '10001' }) });
      await expectRefused(buildRepo(), basePayload);
    });

    test('refuses a signed transit above 1 day as outside the delivery area', async () => {
      const repository = buildRepo();
      await expect(repository.commit(7, 'sub_123', { ...basePayload, shipping: signedShipping({ deliveryDays: 2 }) }))
        .rejects.toMatchObject({ details: { code: 'outside_delivery_area' } });
      expect(repository.stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
    });

    test('a valid quote passes and Stripe carries the signed shipping value', async () => {
      const repository = buildRepo();
      await repository.commit(7, 'sub_123', { ...basePayload, shipping: signedShipping({ cost: 14.25 }) });
      const updateArg = repository.stripeBilling.updateSubscriptionItems.mock.calls[0][0];
      expect(updateArg.metadata.shipping_amount_minor).toBe('1425');
      expect(repository.ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
        shipping: expect.objectContaining({ cost: 14.25 })
      }));
    });

    test('a term change still works with a valid quote', async () => {
      const repository = buildRepo();
      const result = await repository.commit(7, 'sub_123', {
        ...basePayload,
        subscription_term_months: 3,
        shipping: signedShipping()
      });
      expect(result.term_change).toBe(true);
      const updateArg = repository.stripeBilling.updateSubscriptionItems.mock.calls[0][0];
      expect(updateArg.metadata.subscription_term_months).toBe('3');
      expect(updateArg.metadata.shipping_amount_minor).toBe('1290');
      expect(repository.ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
        subscriptionTermMonths: 3
      }));
    });
  });

  describe('address change', () => {
    const addressPayload = {
      subscription_term_months: 1,
      expected_current_hash: hash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
      address: US_EDIT_ADDRESS
    };

    test('an address inside the area saves without prorating or moving the charge', async () => {
      const repository = buildRepo();
      const result = await repository.commit(7, 'sub_123', { ...addressPayload, shipping: signedShipping({ cost: 14.25 }) });

      expect(repository.stripeBilling.previewProration).not.toHaveBeenCalled();
      const updateArg = repository.stripeBilling.updateSubscriptionItems.mock.calls[0][0];
      expect(updateArg.prorationBehavior).toBe('none');
      expect(updateArg.trial_end).toBeUndefined();
      expect(updateArg.metadata.shipping_amount_minor).toBe('1425');
      expect(result.edit_payment_pending).toBe(false);
      expect(result.term_change).toBe(false);
    });

    test('a term change sent with the address still prorates', async () => {
      const repository = buildRepo();
      await repository.commit(7, 'sub_123', {
        ...addressPayload,
        subscription_term_months: 3,
        shipping: signedShipping()
      });

      expect(repository.stripeBilling.previewProration).toHaveBeenCalledTimes(1);
      expect(repository.stripeBilling.updateSubscriptionItems.mock.calls[0][0].prorationBehavior).toBe('create_prorations');
    });

    test('the saved US address keeps the signed transit for later delivery reads', async () => {
      const repository = buildRepo();
      await repository.commit(7, 'sub_123', { ...addressPayload, shipping: signedShipping({ deliveryDays: 1 }) });

      expect(repository.ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
        address: expect.objectContaining({ postal_code: '94105', business_days_in_transit: 1 })
      }));
    });

    test('a US address with a 2-day transit is refused and nothing is saved', async () => {
      const repository = buildRepo();
      await expect(repository.commit(7, 'sub_123', { ...addressPayload, shipping: signedShipping({ deliveryDays: 2 }) }))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'outside_delivery_area' } });
      expect(repository.stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
      expect(repository.ledgerRepository.upsert).not.toHaveBeenCalled();
    });

    test('a Brazilian address 41 km away is refused and nothing is saved', async () => {
      const repository = buildRepo();
      const brShipping = {
        method_id: 'local_delivery',
        cost: 20,
        total: 20,
        distance: 41,
        quote_token: quoteSigner.sign({ country: 'BR', zipcode: '01310100', cost: 20, distance: 41 })
      };
      await expect(repository.commit(7, 'sub_123', {
        ...addressPayload,
        address: { country: 'BR', zipcode: '01310-100', line1: 'Av. Paulista, 1000', city: 'São Paulo', state: 'SP' },
        shipping: brShipping
      })).rejects.toMatchObject({ statusCode: 422, details: { code: 'outside_delivery_area' } });
      expect(repository.stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
      expect(repository.ledgerRepository.upsert).not.toHaveBeenCalled();
    });
  });
});
