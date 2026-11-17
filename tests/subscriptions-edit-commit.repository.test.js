const { SubscriptionsEditCommitRepository } = require('../src/infrastructure/repositories/subscriptions-edit-commit.repository');
const { buildCurrentHash } = require('../src/core/subscription-edit-hash');
const { ShippingQuoteSigner } = require('../src/core/shipping-quote-token');

const quoteSigner = new ShippingQuoteSigner({ secret: 'test-shipping-quote-secret' });
const withoutRecipient = ({ recipient_name: _recipient, ...address }) => address;
const US_EDIT_ADDRESS = { country: 'US', state: 'CA', postal_code: '94105', line1: '1 Market St', city: 'San Francisco', recipient_name: 'Ana Costa' };

function signedShipping({ cost = 12.9, deliveryDays = 1, zipcode = '94105', signer = quoteSigner } = {}) {
  return {
    method_id: 'ups_ground',
    cost,
    total: cost,
    delivery_days: deliveryDays,
    quote_token: signer.sign({ country: 'US', zipcode, cost, deliveryDays })
  };
}

const prorationInvoice = (amount) => ({
  amount_due: 437500 + amount,
  currency: 'usd',
  lines: { data: [{ amount, parent: { subscription_item_details: { proration: true } } }] }
});

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
      chargedDeliveries: 1,
      address: { country: 'US' },
      shipping: { cost: 12.9 },
      ...overrides.ledgerRow
    };
    const ledgerRepository = {
      findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(ledgerRow),
      upsert: jest.fn().mockResolvedValue(ledgerRow),
      startContract: jest.fn()
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
      fiscalRepository: overrides.fiscalRepository,
      blingNfeService: overrides.blingNfeService,
      addressIssueService: overrides.addressIssueService,
      logger: overrides.logger || { error: jest.fn(), warn() {}, info() {} }
    });
  }

  const moreRecipes = [{ price: 'price_abc', quantity: 2 }];

  describe('term change', () => {
    const save = (repository, term = 3) => repository.commit(7, 'sub_123', {
      subscription_term_months: term,
      expected_current_hash: hash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
      address: US_EDIT_ADDRESS,
      shipping: signedShipping()
    });

    test('One month to three: the contract starts before the term is saved', async () => {
      const repository = buildRepo({ ledgerRow: { chargedDeliveries: 1 } });
      const order = [];
      repository.ledgerRepository.startContract = jest.fn(async () => { order.push('start'); });
      repository.ledgerRepository.upsert.mockImplementation(async () => { order.push('upsert'); });

      await save(repository);

      expect(repository.ledgerRepository.startContract).toHaveBeenCalledWith('sub_123');
      expect(order).toEqual(['start', 'upsert']);
    });

    test('Other edit', async () => {
      const repository = buildRepo({ proposedItems: moreRecipes, ledgerRow: { chargedDeliveries: 1 } });
      repository.ledgerRepository.startContract = jest.fn();
      await save(repository, 1);
      expect(repository.ledgerRepository.startContract).not.toHaveBeenCalled();
    });

    test('Renewal off after the last charge: removes the scheduled end', async () => {
      const setCancelAtPeriodEnd = jest.fn().mockResolvedValue({});
      const repository = buildRepo({
        stripeBilling: { setCancelAtPeriodEnd },
        ledgerRow: { chargedDeliveries: 1, autoRenew: false, cancelAtPeriodEnd: true }
      });
      repository.ledgerRepository.startContract = jest.fn();
      await save(repository);
      expect(setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', false);
    });

    test.each([[true], [null]])('Explicit cancellation with stored auto_renew %s keeps the scheduled end', async (autoRenew) => {
      const setCancelAtPeriodEnd = jest.fn();
      const repository = buildRepo({
        stripeBilling: { setCancelAtPeriodEnd },
        ledgerRow: { chargedDeliveries: 1, autoRenew, cancelAtPeriodEnd: true }
      });
      repository.ledgerRepository.startContract = jest.fn();
      await save(repository);
      expect(setCancelAtPeriodEnd).not.toHaveBeenCalled();
      expect(repository.ledgerRepository.startContract).toHaveBeenCalled();
    });

    test('seeds an unknown count from Stripe before changing anything', async () => {
      const listPaidInvoicesForSubscription = jest.fn().mockResolvedValue([
        { id: 'in_1', billing_reason: 'subscription_create', subtotal: 3000 },
        { id: 'in_move', billing_reason: 'subscription_update', subtotal: 0 }
      ]);
      const repository = buildRepo({ stripeBilling: { listPaidInvoicesForSubscription }, ledgerRow: { chargedDeliveries: null } });
      repository.ledgerRepository.seedChargedDeliveries = jest.fn();
      repository.ledgerRepository.startContract = jest.fn();
      await save(repository);
      expect(repository.ledgerRepository.seedChargedDeliveries).toHaveBeenCalledWith('sub_123', ['in_1']);
    });

    test('refuses the edit when the count cannot be read, with nothing changed', async () => {
      const repository = buildRepo({
        stripeBilling: { listPaidInvoicesForSubscription: jest.fn().mockRejectedValue(new Error('stripe down')) },
        ledgerRow: { chargedDeliveries: null }
      });
      await expect(save(repository)).rejects.toMatchObject({ details: { code: 'contract_count_unavailable' } });
      expect(repository.stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
      expect(repository.ledgerRepository.upsert).not.toHaveBeenCalled();
    });

    test('Edit waiting for payment: stores the change and starts nothing yet', async () => {
      const repository = buildRepo({
        ledgerRow: { chargedDeliveries: 1 },
        stripeBilling: {
          previewProration: jest.fn().mockResolvedValue(prorationInvoice(1000)),
          updateSubscriptionItems: jest.fn().mockResolvedValue({
            latest_invoice: { id: 'in_edit', payment_intent: { id: 'pi_1', status: 'requires_action', client_secret: 'cs_1' } },
            default_payment_method: { id: 'pm_123' }
          }),
          resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation')
        }
      });
      repository.ledgerRepository.startContract = jest.fn();
      await save(repository);
      expect(repository.ledgerRepository.startContract).not.toHaveBeenCalled();
      expect(repository.ledgerRepository.upsert.mock.calls[0][0].editPending).toMatchObject({ term_months: 3, term_changed: true });
    });
  });

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

  test('holds the edit when the invoice carries only a confirmation secret', async () => {
    const repository = buildRepo({
      proposedItems: moreRecipes,
      stripeBilling: {
        previewProration: jest.fn().mockResolvedValue(prorationInvoice(1250)),
        updateSubscriptionItems: jest.fn().mockResolvedValue({
          latest_invoice: { id: 'in_edit', status: 'open', confirmation_secret: { client_secret: 'pi_9_secret_x' } },
          default_payment_method: { id: 'pm_123' }
        }),
        resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation')
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

    expect(result.stripe_client_secret).toBe('pi_9_secret_x');
    expect(result.payment_state).toBe('requires_confirmation');
    expect(result.edit_payment_pending).toBe(true);
  });

  test('does not hold the edit when the invoice is already paid', async () => {
    const resolvePaymentState = jest.fn().mockReturnValue('paid');
    const repository = buildRepo({
      proposedItems: moreRecipes,
      stripeBilling: {
        previewProration: jest.fn().mockResolvedValue(prorationInvoice(1250)),
        updateSubscriptionItems: jest.fn().mockResolvedValue({
          latest_invoice: { id: 'in_edit', status: 'paid', confirmation_secret: { client_secret: 'pi_9_secret_x' } },
          default_payment_method: { id: 'pm_123' }
        }),
        resolvePaymentState
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

    expect(resolvePaymentState).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentStatus: 'succeeded' }));
    expect(result.stripe_client_secret).toBeNull();
    expect(result.edit_payment_pending).toBe(false);
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
        previewProration: jest.fn().mockResolvedValue(prorationInvoice(1250)),
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
        previewProration: jest.fn().mockResolvedValue(prorationInvoice(1250)),
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

    test('a street change without the recipient keeps the stored one', async () => {
      const storedAddress = { country: 'US', postal_code: '94105', recipient_name: 'João Lima' };
      const storedHash = buildCurrentHash({
        items: [{ price: 'price_abc', quantity: 1 }], termMonths: 1, address: storedAddress, shipping: { cost: 12.9 }
      });
      const repository = buildRepo({ ledgerRow: { address: storedAddress } });
      await repository.commit(7, 'sub_123', {
        ...addressPayload, expected_current_hash: storedHash, address: { ...withoutRecipient(US_EDIT_ADDRESS), line1: '2 Market St' }, shipping: signedShipping()
      });

      expect(repository.ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
        address: expect.objectContaining({ line1: '2 Market St', recipient_name: 'João Lima' })
      }));
    });

    test('a street change without the instructions keeps the stored ones', async () => {
      const storedAddress = { country: 'US', postal_code: '94105', recipient_name: 'Ana Costa', delivery_instructions: 'Portão azul' };
      const storedHash = buildCurrentHash({
        items: [{ price: 'price_abc', quantity: 1 }], termMonths: 1, address: storedAddress, shipping: { cost: 12.9 }
      });
      const repository = buildRepo({ ledgerRow: { address: storedAddress } });
      await repository.commit(7, 'sub_123', {
        ...addressPayload, expected_current_hash: storedHash, address: { ...US_EDIT_ADDRESS, line1: '2 Market St' }, shipping: signedShipping()
      });

      expect(repository.ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
        address: expect.objectContaining({ line1: '2 Market St', delivery_instructions: 'Portão azul' })
      }));
    });

    test('an instructions-only change saves them without prorating or moving the charge', async () => {
      const storedAddress = { ...US_EDIT_ADDRESS, delivery_instructions: 'Portão azul' };
      const storedHash = buildCurrentHash({
        items: [{ price: 'price_abc', quantity: 1 }], termMonths: 1, address: storedAddress, shipping: { cost: 12.9 }
      });
      const repository = buildRepo({ ledgerRow: { address: storedAddress } });
      const result = await repository.commit(7, 'sub_123', {
        ...addressPayload, expected_current_hash: storedHash,
        address: { ...US_EDIT_ADDRESS, delivery_instructions: 'Deixar com o porteiro' }, shipping: signedShipping()
      });

      expect(repository.stripeBilling.previewProration).not.toHaveBeenCalled();
      expect(repository.stripeBilling.updateSubscriptionItems.mock.calls[0][0].prorationBehavior).toBe('none');
      expect(result.edit_payment_pending).toBe(false);
      expect(repository.ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
        address: expect.objectContaining({ delivery_instructions: 'Deixar com o porteiro', recipient_name: 'Ana Costa' })
      }));
    });

    test('a new recipient replaces the stored one', async () => {
      const storedAddress = { country: 'US', postal_code: '94105', recipient_name: 'João Lima' };
      const storedHash = buildCurrentHash({
        items: [{ price: 'price_abc', quantity: 1 }], termMonths: 1, address: storedAddress, shipping: { cost: 12.9 }
      });
      const repository = buildRepo({ ledgerRow: { address: storedAddress } });
      await repository.commit(7, 'sub_123', {
        ...addressPayload, expected_current_hash: storedHash,
        address: { ...US_EDIT_ADDRESS, recipient_name: 'Portaria Ed. Sol' }, shipping: signedShipping()
      });

      expect(repository.ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
        address: expect.objectContaining({ recipient_name: 'Portaria Ed. Sol' })
      }));
    });

    test('a US address with a 2-day transit is refused and nothing is saved', async () => {
      const repository = buildRepo();
      await expect(repository.commit(7, 'sub_123', { ...addressPayload, shipping: signedShipping({ deliveryDays: 2 }) }))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'outside_delivery_area' } });
      expect(repository.stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
      expect(repository.ledgerRepository.upsert).not.toHaveBeenCalled();
    });

    const brShippingAt = (distance) => ({
      method_id: 'distance_km',
      cost: 20,
      total: 20,
      distance,
      quote_token: quoteSigner.sign({ country: 'BR', zipcode: '01310100', cost: 20, distance })
    });
    const brAddress = { zipcode: '01310-100', line1: 'Av. Paulista', number: '1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', recipient_name: 'Ana Costa' };
    const brRow = { stripeAccount: 'br', address: { country: 'BR' } };

    test('a Brazilian address 51 km away is refused and nothing is saved', async () => {
      const repository = buildRepo({ ledgerRow: brRow });
      await expect(repository.commit(7, 'sub_123', {
        ...addressPayload,
        address: { ...brAddress, country: 'BR' },
        shipping: brShippingAt(51)
      })).rejects.toMatchObject({ statusCode: 422, details: { code: 'outside_delivery_area' } });
      expect(repository.stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
      expect(repository.ledgerRepository.upsert).not.toHaveBeenCalled();
    });

    test('a Brazilian subscription refuses an address that claims the US, instead of rewriting its country', async () => {
      const repository = buildRepo({ ledgerRow: brRow });
      await expect(repository.commit(7, 'sub_123', {
        ...addressPayload,
        address: { ...brAddress, country: 'US' },
        shipping: brShippingAt(10)
      })).rejects.toMatchObject({ statusCode: 422, details: { code: 'address_country_mismatch' } });
      expect(repository.stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
      expect(repository.ledgerRepository.upsert).not.toHaveBeenCalled();
    });

    test('a US subscription cannot switch to a Brazilian address', async () => {
      const repository = buildRepo();
      await expect(repository.commit(7, 'sub_123', {
        ...addressPayload,
        address: { ...brAddress, country: 'BR' },
        shipping: brShippingAt(10)
      })).rejects.toMatchObject({ statusCode: 422, details: { code: 'address_country_mismatch' } });
      expect(repository.ledgerRepository.upsert).not.toHaveBeenCalled();
    });

    test('an address without a country takes the account market', async () => {
      const storedHash = buildCurrentHash({
        items: [{ price: 'price_abc', quantity: 1 }], termMonths: 1, address: brRow.address, shipping: { cost: 12.9 }
      });
      const repository = buildRepo({ ledgerRow: brRow });
      await repository.commit(7, 'sub_123', { ...addressPayload, expected_current_hash: storedHash, address: brAddress, shipping: brShippingAt(10) });
      expect(repository.ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
        address: expect.objectContaining({ country: 'BR', number: '1000' })
      }));
    });

    test('a subscription whose stored address is of another market cannot edit its address', async () => {
      const repository = buildRepo({ ledgerRow: { stripeAccount: 'us', address: { country: 'BR', recipient_name: 'Ana Costa' } } });
      await expect(repository.commit(7, 'sub_123', { ...addressPayload, shipping: signedShipping() }))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'subscription_market_mismatch' } });
      expect(repository.stripeBilling.retrieveSubscription).not.toHaveBeenCalled();
    });

    test('a Brazilian address without the neighborhood is refused with the field', async () => {
      const repository = buildRepo({ ledgerRow: brRow });
      await expect(repository.commit(7, 'sub_123', {
        ...addressPayload, address: { ...brAddress, neighborhood: '' }, shipping: brShippingAt(10)
      })).rejects.toMatchObject({ statusCode: 422, details: { code: 'address_incomplete', fields: ['neighborhood'] } });
      expect(repository.ledgerRepository.upsert).not.toHaveBeenCalled();
    });

    test('an address with no recipient, sent or stored, is refused', async () => {
      const repository = buildRepo();
      await expect(repository.commit(7, 'sub_123', { ...addressPayload, address: withoutRecipient(US_EDIT_ADDRESS), shipping: signedShipping() }))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'recipient_name_required' } });
      expect(repository.ledgerRepository.upsert).not.toHaveBeenCalled();
    });
  });

  describe('CPF and fiscal name', () => {
    const fiscalRepository = () => ({ saveTaxDocument: jest.fn(), saveFiscalName: jest.fn() });
    const brHash = buildCurrentHash({ items: [{ price: 'price_abc', quantity: 1 }], termMonths: 1, address: { country: 'BR' }, shipping: { cost: 12.9 } });
    const planPayload = {
      subscription_term_months: 1,
      expected_current_hash: brHash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }]
    };
    const brRow = { stripeAccount: 'br', address: { country: 'BR' } };

    test('a Brazil edit saves a valid fiscal name and CPF for the account after the edit', async () => {
      const fiscal = fiscalRepository();
      const repository = buildRepo({ ledgerRow: brRow, fiscalRepository: fiscal });
      await repository.commit(7, 'sub_123', { ...planPayload, fiscal_name: ' Maria   Souza ', tax_document: '529.982.247-25' });

      expect(fiscal.saveFiscalName).toHaveBeenCalledWith(7, 'Maria Souza');
      expect(fiscal.saveTaxDocument).toHaveBeenCalledWith(7, '52998224725');
      expect(repository.ledgerRepository.upsert.mock.invocationCallOrder[0])
        .toBeLessThan(fiscal.saveFiscalName.mock.invocationCallOrder[0]);
    });

    test('saving fiscal data reads the blocked notes again, and their failure does not undo the edit', async () => {
      const fiscal = fiscalRepository();
      const blingNfeService = { refreshBlockedForUser: jest.fn().mockRejectedValue(new Error('db down')) };
      const repository = buildRepo({ ledgerRow: brRow, fiscalRepository: fiscal, blingNfeService });
      await expect(repository.commit(7, 'sub_123', { ...planPayload, fiscal_name: 'Maria Souza' })).resolves.toMatchObject({ subscription_id: 'sub_123' });
      expect(blingNfeService.refreshBlockedForUser).toHaveBeenCalledWith(7);
      expect(fiscal.saveFiscalName.mock.invocationCallOrder[0])
        .toBeLessThan(blingNfeService.refreshBlockedForUser.mock.invocationCallOrder[0]);
    });

    test('an edit without fiscal data does not read the notes', async () => {
      const blingNfeService = { refreshBlockedForUser: jest.fn() };
      const repository = buildRepo({ ledgerRow: brRow, fiscalRepository: fiscalRepository(), blingNfeService });
      await repository.commit(7, 'sub_123', planPayload);
      expect(blingNfeService.refreshBlockedForUser).not.toHaveBeenCalled();
    });

    test('an invalid CPF is refused and nothing is saved', async () => {
      const fiscal = fiscalRepository();
      const repository = buildRepo({ ledgerRow: brRow, fiscalRepository: fiscal });
      await expect(repository.commit(7, 'sub_123', { ...planPayload, tax_document: '111.111.111-11' }))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'tax_document_required' } });
      expect(repository.stripeBilling.updateSubscriptionItems).not.toHaveBeenCalled();
      expect(fiscal.saveTaxDocument).not.toHaveBeenCalled();
    });

    test('a US edit refuses the fiscal fields', async () => {
      const repository = buildRepo({ fiscalRepository: fiscalRepository() });
      await expect(repository.commit(7, 'sub_123', { ...planPayload, expected_current_hash: hash, fiscal_name: 'Maria Souza' }))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'fiscal_fields_not_allowed' } });
    });

    test('a Stripe failure saves no fiscal data', async () => {
      const fiscal = fiscalRepository();
      const repository = buildRepo({
        ledgerRow: brRow,
        fiscalRepository: fiscal,
        stripeBilling: { updateSubscriptionItems: jest.fn().mockRejectedValue(new Error('stripe down')) }
      });
      await expect(repository.commit(7, 'sub_123', { ...planPayload, fiscal_name: 'Maria Souza' })).rejects.toThrow('stripe down');
      expect(fiscal.saveFiscalName).not.toHaveBeenCalled();
    });
  });

  describe('address problems after the save', () => {
    const { DeliveryAddressIssueService } = require('../src/services/delivery-address-issue.service');
    const CPF = '52998224725';
    const brHash = buildCurrentHash({ items: [{ price: 'price_abc', quantity: 1 }], termMonths: 1, address: { country: 'BR' }, shipping: { cost: 12.9 } });
    const brRow = { id: 5, stripeAccount: 'br', address: { country: 'BR' } };
    const brAddress = { country: 'BR', zipcode: '01310-100', line1: 'Av. Paulista', number: '1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', recipient_name: 'Ana Costa' };
    const brShipping = () => ({
      method_id: 'distance_km', cost: 20, total: 20, distance: 10,
      quote_token: quoteSigner.sign({ country: 'BR', zipcode: '01310100', cost: 20, distance: 10 })
    });
    const base = {
      subscription_term_months: 1,
      expected_current_hash: brHash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }]
    };

    // One open problem per row, kept in memory; the ledger the service reads is what the commit just saved.
    function setup({ issues, fiscal = { taxDocument: CPF, fiscalName: 'Ana Costa' }, others = [] }) {
      const fiscalData = { ...fiscal };
      const fiscalRepository = {
        saveTaxDocument: jest.fn(async (userId, value) => { fiscalData.taxDocument = value; }),
        saveFiscalName: jest.fn(async (userId, value) => { fiscalData.fiscalName = value; }),
        findFiscalData: jest.fn(async () => fiscalData)
      };
      const rows = issues.map((issue, index) => ({ id: index + 1, userId: 7, open: true, stripeAccount: 'br', ...issue }));
      const issueRepository = {
        rows,
        listOpenByUser: jest.fn(async () => rows.filter((row) => row.open)),
        close: jest.fn(async (id, { resolvedBy }) => { Object.assign(rows.find((row) => row.id === id), { open: false, resolvedBy }); return true; }),
        updateCodes: jest.fn(async (id, codes) => { rows.find((row) => row.id === id).codes = codes; })
      };
      const mailer = { notifyDeliveryAddressIssue: jest.fn() };
      let repository;
      const ledgerRepository = {
        findByStripeSubscriptionId: jest.fn(async (id) => {
          if (id !== 'sub_123') return others.find((other) => other.stripeSubscriptionId === id) || null;
          const saved = repository.ledgerRepository.upsert.mock.calls.at(-1);
          return { ...brRow, stripeSubscriptionId: 'sub_123', userId: 7, address: saved ? saved[0].address : brRow.address };
        })
      };
      const addressIssueService = new DeliveryAddressIssueService({ repository: issueRepository, fiscalRepository, ledgerRepository, mailer });
      repository = buildRepo({ ledgerRow: brRow, fiscalRepository, addressIssueService });
      return { repository, rows, mailer };
    }

    test('a fixed address closes the problem', async () => {
      const { repository, rows } = setup({ issues: [{ stripeSubscriptionId: 'sub_123', codes: ['address_number_missing'] }] });
      await repository.commit(7, 'sub_123', { ...base, address: brAddress, shipping: brShipping() });
      expect(rows[0]).toMatchObject({ open: false, resolvedBy: 'customer' });
    });

    test('only the number saved, CPF still missing: open with only the CPF and no email', async () => {
      const { repository, rows, mailer } = setup({
        issues: [{ stripeSubscriptionId: 'sub_123', codes: ['address_number_missing', 'tax_document_missing'] }],
        fiscal: { taxDocument: '', fiscalName: 'Ana Costa' }
      });
      await repository.commit(7, 'sub_123', { ...base, address: brAddress, shipping: brShipping() });
      expect(rows[0]).toMatchObject({ open: true, codes: ['tax_document_missing'] });
      expect(mailer.notifyDeliveryAddressIssue).not.toHaveBeenCalled();
    });

    test('a fiscal name saved on one subscription closes the problem of the other BR subscription', async () => {
      const other = { id: 6, stripeSubscriptionId: 'sub_other', userId: 7, stripeAccount: 'br', address: brAddress };
      const { repository, rows } = setup({
        issues: [
          { stripeSubscriptionId: 'sub_123', codes: ['fiscal_name_missing'] },
          { stripeSubscriptionId: 'sub_other', codes: ['fiscal_name_missing'] }
        ],
        fiscal: { taxDocument: CPF, fiscalName: '' },
        others: [other]
      });
      await repository.commit(7, 'sub_123', { ...base, address: brAddress, shipping: brShipping(), fiscal_name: 'Ana Costa' });
      expect(rows.map((row) => row.open)).toEqual([false, false]);
    });

    test('a new address clears courier_address_unusable', async () => {
      const { repository, rows } = setup({ issues: [{ stripeSubscriptionId: 'sub_123', codes: ['courier_address_unusable'] }] });
      await repository.commit(7, 'sub_123', { ...base, address: brAddress, shipping: brShipping() });
      expect(rows[0]).toMatchObject({ open: false, resolvedBy: 'customer' });
    });
  });
});
