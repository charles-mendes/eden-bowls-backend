const { HttpError } = require('../src/core/http-error');
const { createCheckoutLockStore } = require('../src/core/checkout-idempotency');
const { OnboardingSubscriptionCheckoutService } = require('../src/services/onboarding-subscription-checkout.service');
const { ShippingQuoteSigner } = require('../src/core/shipping-quote-token');

const quoteSigner = new ShippingQuoteSigner({ secret: 'test-shipping-quote-secret' });
const US_ADDRESS = { country: 'US', zipcode: '94105', state: 'CA', city: 'San Francisco' };
const BR_ADDRESS = { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' };

function quoted(address, shipping, signer = quoteSigner) {
  return {
    ...shipping,
    quote_token: signer.sign({
      country: address.country,
      zipcode: address.zipcode,
      cost: shipping.cost || shipping.total,
      distance: shipping.distance,
      deliveryDays: shipping.delivery_days
    })
  };
}

const validContext = {
  pets: [{ id: 1 }],
  planSelection: {
    subscription_term_months: 1,
    catalog_pricing: {
      subtotal: 40,
      currency: 'usd',
      line_items: [{ stripe_price_id: 'price_abc', quantity: 1 }]
    }
  },
  address: US_ADDRESS,
  shipping: quoted(US_ADDRESS, { rate_id: 'fixed_us:default', cost: 12.9, delivery_days: 1 }),
  recurrence: { subscription_term_months: 1 },
  checkoutReference: null
};

function buildService(overrides = {}) {
  const repository = overrides.repository || {
    checkout: jest.fn().mockImplementation(async (_userId, payload) => payload.checkout),
    getPlanSelection: jest.fn().mockResolvedValue(validContext.planSelection),
    getCheckoutContext: jest.fn().mockResolvedValue(validContext),
    resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
    getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
  };
  const authService = overrides.authService || {
    assertCriticalOperationAllowed: jest.fn().mockResolvedValue({ id: 7, activation_status: 'active' })
  };
  const discountEligibilityRepository = overrides.discountEligibilityRepository || {
    getEligibility: jest.fn().mockResolvedValue({ validated: true, eligible: true, reason: null })
  };
  const stripeCouponService = overrides.stripeCouponService || {
    resolveFirstPurchasePromotionForCheckout: jest.fn().mockResolvedValue({
      promotion_code_id: 'promo_1m',
      discount_percent: 10,
      discount_duration: 'once'
    })
  };
  const stripeBilling = overrides.stripeBilling || {
    automaticTaxEnabled: true,
    createOnboardingSubscription: jest.fn().mockResolvedValue({
      customerId: 'cus_1',
      subscription: { id: 'sub_123', status: 'incomplete' },
      checkout: {
        order_id: 0,
        payment_state: 'requires_confirmation',
        stripe_client_secret: 'secret_123',
        stripe_subscription_id: 'sub_123',
        status: 'incomplete'
      }
    }),
    retrievePaymentIntent: jest.fn(),
    resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation')
  };
  const customerStore = overrides.customerStore || {
    getCustomerId: jest.fn().mockResolvedValue(''),
    saveCustomerId: jest.fn().mockResolvedValue(undefined)
  };
  const lockStore = overrides.lockStore || createCheckoutLockStore();
  const petsSyncRepository = overrides.petsSyncRepository || {
    syncPets: jest.fn().mockResolvedValue({ pets: [] })
  };

  return {
    service: new OnboardingSubscriptionCheckoutService(repository, {
      authService,
      discountEligibilityRepository,
      stripeCouponService,
      stripeBilling,
      customerStore,
      stripeAccounts: overrides.stripeAccounts || null,
      stripeBrEnabled: overrides.stripeBrEnabled,
      lockStore,
      planPreviewRepository: overrides.planPreviewRepository || null,
      petsSyncRepository,
      shippingQuoteSigner: overrides.shippingQuoteSigner || quoteSigner
    }),
    petsSyncRepository,
    repository,
    authService,
    discountEligibilityRepository,
    stripeCouponService,
    stripeBilling,
    customerStore,
    stripeAccounts: overrides.stripeAccounts || null
  };
}

const payload = { paymentMethodId: 'pm_123', billing: { first_name: 'Jane', last_name: 'Doe' } };

describe('OnboardingSubscriptionCheckoutService', () => {
  test('checks fresh account status before creating checkout', async () => {
    const { service, authService, repository } = buildService();

    const result = await service.checkout({ userId: 7, payload });

    expect(result.success).toBe(true);
    expect(result.data.order_id).toBe(0);
    expect(result.data.session_id).toBeUndefined();
    expect(result.data.stripe_client_secret).toBe('secret_123');
    expect(authService.assertCriticalOperationAllowed).toHaveBeenCalledWith(7);
    expect(repository.checkout).toHaveBeenCalledWith(7, expect.objectContaining({
      payment_method_id: 'pm_123',
      checkout_mode: 'subscription_first'
    }));
  });

  test('does not create checkout when the account guard rejects', async () => {
    const { service, repository } = buildService({
      authService: { assertCriticalOperationAllowed: jest.fn().mockRejectedValue(new Error('blocked')) }
    });

    await expect(service.checkout({ userId: 7, payload })).rejects.toThrow('blocked');
    expect(repository.checkout).not.toHaveBeenCalled();
  });

  test('rejects checkout without a Stripe payment method', async () => {
    const { service, stripeBilling } = buildService();

    await expect(service.checkout({ userId: 7, payload: {} })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_payment_method' }
    });
    expect(stripeBilling.createOnboardingSubscription).not.toHaveBeenCalled();
  });

  test('attaches the resolved promotion for an eligible user', async () => {
    const { service, repository, stripeCouponService, stripeBilling } = buildService();

    await service.checkout({ userId: 7, payload });

    expect(stripeCouponService.resolveFirstPurchasePromotionForCheckout).toHaveBeenCalledWith({
      eligible: true,
      termMonths: 1,
      account: 'us'
    });
    expect(stripeBilling.createOnboardingSubscription).toHaveBeenCalledWith(expect.objectContaining({
      promotionCodeId: 'promo_1m',
      paymentMethodId: 'pm_123',
      email: 'jane@example.com'
    }));
    expect(repository.checkout).toHaveBeenCalledWith(7, expect.objectContaining({
      discount_applied_percent: 10,
      stripe_promotion_code_id: 'promo_1m',
      stripe_discount_duration: 'once',
      discount_eligibility: { validated: true, eligible: true, reason: null }
    }));
  });

  test('blocks eligible checkout when the promo slot is empty', async () => {
    const { service, repository } = buildService({
      stripeCouponService: {
        resolveFirstPurchasePromotionForCheckout: jest.fn().mockRejectedValue(
          new HttpError(503, 'First purchase promotion is not configured.', {
            code: 'first_purchase_promo_not_configured'
          })
        )
      }
    });

    await expect(service.checkout({ userId: 7, payload })).rejects.toMatchObject({
      statusCode: 503,
      details: { code: 'first_purchase_promo_not_configured' }
    });
    expect(repository.checkout).not.toHaveBeenCalled();
  });

  test('creates checkout without discounts when the user is not eligible', async () => {
    const { service, repository, stripeCouponService, stripeBilling } = buildService({
      discountEligibilityRepository: {
        getEligibility: jest.fn().mockResolvedValue({
          validated: true,
          eligible: false,
          reason: 'HAS_PREVIOUS_PURCHASE'
        })
      },
      stripeCouponService: {
        resolveFirstPurchasePromotionForCheckout: jest.fn().mockResolvedValue(null)
      }
    });

    await service.checkout({ userId: 7, payload });

    expect(stripeCouponService.resolveFirstPurchasePromotionForCheckout).toHaveBeenCalledWith({
      eligible: false,
      termMonths: 1,
      account: 'us'
    });
    expect(stripeBilling.createOnboardingSubscription).toHaveBeenCalledWith(expect.objectContaining({
      promotionCodeId: null
    }));
    expect(repository.checkout).toHaveBeenCalledWith(7, expect.objectContaining({
      discount_applied_percent: 0,
      stripe_promotion_code_id: null,
      stripe_discount_duration: null,
      discount_eligibility: {
        validated: true,
        eligible: false,
        reason: 'HAS_PREVIOUS_PURCHASE'
      }
    }));
  });

  test('recalculates catalog pricing for the first invoice when eligible', async () => {
    const { service, repository } = buildService({
      repository: {
        getPlanSelection: jest.fn().mockResolvedValue({
          subscription_term_months: 3,
          catalog_pricing: { subtotal: 40, discounted_first_month_total: 40, line_items: [{ stripe_price_id: 'price_abc', quantity: 1 }] }
        }),
        getCheckoutContext: jest.fn().mockResolvedValue({
          ...validContext,
          planSelection: {
            subscription_term_months: 3,
            catalog_pricing: { subtotal: 40, discounted_first_month_total: 40, line_items: [{ stripe_price_id: 'price_abc', quantity: 1 }] }
          }
        }),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane' }),
        checkout: jest.fn().mockImplementation(async (_userId, nextPayload) => nextPayload.checkout)
      },
      stripeCouponService: {
        resolveFirstPurchasePromotionForCheckout: jest.fn().mockResolvedValue({
          promotion_code_id: 'promo_3m',
          discount_percent: 25,
          discount_duration: 'once'
        })
      }
    });

    await service.checkout({ userId: 7, payload });

    expect(repository.checkout).toHaveBeenCalledWith(7, expect.objectContaining({
      discount_applied_percent: 25,
      plan_selection: expect.objectContaining({
        catalog_pricing: expect.objectContaining({
          subtotal: 40,
          discounted_first_month_total: 30
        })
      })
    }));
  });

  test('upserts an incomplete ledger row after Stripe create', async () => {
    const ledgerRepository = {
      listByUserId: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({})
    };
    const { service } = buildService();
    service.ledgerRepository = ledgerRepository;

    await service.checkout({ userId: 7, payload });

    expect(ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_1',
      status: 'incomplete'
    }));
  });

  test('reuses an incomplete subscription with the same fingerprint', async () => {
    const lockStore = createCheckoutLockStore();
    const first = buildService({ lockStore });
    const firstResult = await first.service.checkout({ userId: 7, payload });
    const stored = first.repository.checkout.mock.calls[0][1].checkout;

    const stripeBilling = {
      automaticTaxEnabled: true,
      createOnboardingSubscription: jest.fn(),
      retrievePaymentIntent: jest.fn().mockResolvedValue({
        status: 'requires_confirmation',
        client_secret: 'secret_123'
      }),
      resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation')
    };
    const second = buildService({
      lockStore,
      stripeBilling,
      repository: {
        ...first.repository,
        getCheckoutContext: jest.fn().mockResolvedValue({
          ...validContext,
          checkoutReference: stored
        }),
        checkout: jest.fn().mockImplementation(async (_userId, nextPayload) => nextPayload.checkout)
      }
    });

    const reused = await second.service.checkout({ userId: 7, payload });

    expect(reused.data.reused).toBe(true);
    expect(reused.data.stripe_subscription_id).toBe('sub_123');
    expect(stripeBilling.createOnboardingSubscription).not.toHaveBeenCalled();
    expect(firstResult.data.stripe_subscription_id).toBe('sub_123');
  });

  test('creates a new subscription when shipping changes the fingerprint', async () => {
    const stored = {
      stripe_subscription_id: 'sub_old',
      status: 'incomplete',
      stripe_payment_intent_status: 'requires_confirmation',
      checkout_context_fingerprint: 'old-fingerprint',
      attempt_id: 'attempt-old'
    };
    const { service, stripeBilling } = buildService({
      repository: {
        checkout: jest.fn().mockImplementation(async (_userId, nextPayload) => nextPayload.checkout),
        getPlanSelection: jest.fn().mockResolvedValue(validContext.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue({
          ...validContext,
          shipping: quoted(US_ADDRESS, { rate_id: 'fixed_us:default', cost: 20, delivery_days: 1 }),
          checkoutReference: stored
        }),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });

    await service.checkout({ userId: 7, payload });

    expect(stripeBilling.createOnboardingSubscription).toHaveBeenCalledTimes(1);
  });

  test('creates a new subscription when a paid checkout is for a different pet', async () => {
    const stored = {
      stripe_subscription_id: 'sub_old',
      status: 'active',
      stripe_payment_intent_status: 'succeeded',
      checkout_context_fingerprint: 'old-fingerprint',
      pet_ids: ['pet-1']
    };
    const ledgerRepository = {
      listByUserId: jest.fn().mockResolvedValue([{
        status: 'active',
        petsSnapshot: { pet_ids: ['pet-1'] },
        planSelection: { pets: [{ pet_id: 'pet-1' }] }
      }]),
      upsert: jest.fn().mockResolvedValue({})
    };
    const { service, stripeBilling } = buildService({
      repository: {
        checkout: jest.fn().mockImplementation(async (_userId, nextPayload) => nextPayload.checkout),
        getPlanSelection: jest.fn().mockResolvedValue(validContext.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue({
          ...validContext,
          pets: [{ id: 2, pet_id: 'pet-2' }],
          planSelection: {
            ...validContext.planSelection,
            pets: [{
              pet_id: 'pet-2',
              pet_name: 'Tobby',
              enabled: true,
              selected_flavors: ['chicken'],
              flavor_weights: [8]
            }]
          },
          checkoutReference: stored
        }),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });
    service.ledgerRepository = ledgerRepository;

    const result = await service.checkout({ userId: 7, payload });

    expect(result.success).toBe(true);
    expect(result.data.reused).toBe(false);
    expect(stripeBilling.createOnboardingSubscription).toHaveBeenCalledTimes(1);
    expect(ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      stripeSubscriptionId: 'sub_123'
    }));
  });

  test('rejects a paid checkout when the same pets change shipping', async () => {
    const stored = {
      stripe_subscription_id: 'sub_old',
      status: 'active',
      stripe_payment_intent_status: 'succeeded',
      checkout_context_fingerprint: 'old-fingerprint',
      pet_ids: ['1']
    };
    const { service, stripeBilling } = buildService({
      repository: {
        checkout: jest.fn(),
        getPlanSelection: jest.fn().mockResolvedValue(validContext.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue({
          ...validContext,
          shipping: quoted(US_ADDRESS, { rate_id: 'fixed_us:default', cost: 20, delivery_days: 1 }),
          checkoutReference: stored
        }),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });
    service.ledgerRepository = {
      listByUserId: jest.fn().mockResolvedValue([{
        status: 'active',
        petsSnapshot: { pet_ids: ['1'] },
        planSelection: { pets: [{ id: 1 }] }
      }])
    };

    await expect(service.checkout({ userId: 7, payload })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'checkout_context_mismatch' }
    });
    expect(stripeBilling.createOnboardingSubscription).not.toHaveBeenCalled();
  });

  test('persists plan-selection pets when onboarding_pets is empty', async () => {
    const planPets = [{
      pet_id: '526fb705-9da4-4d27-965e-da39a20d3b12',
      pet_name: 'luna',
      enabled: true,
      selected_flavors: ['bovino', 'frango'],
      flavor_weights: [5, 5],
      weight: '28.66',
      weight_unit: 'lb'
    }];
    const emptyContext = {
      pets: [],
      planSelection: {
        ...validContext.planSelection,
        pets: planPets
      },
      address: validContext.address,
      shipping: validContext.shipping,
      recurrence: validContext.recurrence,
      checkoutReference: null
    };
    const hydratedContext = {
      ...emptyContext,
      pets: [{ id: '526fb705-9da4-4d27-965e-da39a20d3b12' }]
    };
    const petsSyncRepository = {
      syncPets: jest.fn().mockResolvedValue({ pets: [{ id: '526fb705-9da4-4d27-965e-da39a20d3b12' }] })
    };
    const { service, petsSyncRepository: syncRepo } = buildService({
      petsSyncRepository,
      repository: {
        checkout: jest.fn().mockImplementation(async (_userId, nextPayload) => nextPayload.checkout),
        getCheckoutContext: jest.fn()
          .mockResolvedValueOnce(emptyContext)
          .mockResolvedValue(hydratedContext),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });

    const result = await service.checkout({ userId: 5, payload });

    expect(result.success).toBe(true);
    expect(syncRepo.syncPets).toHaveBeenCalledWith(5, [
      expect.objectContaining({
        pet_id: '526fb705-9da4-4d27-965e-da39a20d3b12',
        name: 'luna',
        weight: 28.66,
        weight_unit: 'lb'
      })
    ]);
  });

  test('rejects checkout when the user state is incomplete', async () => {
    const { service, repository } = buildService({
      repository: {
        getCheckoutContext: jest.fn().mockResolvedValue({
          pets: [],
          planSelection: null,
          address: null,
          shipping: null
        }),
        checkout: jest.fn()
      }
    });

    await expect(service.checkout({ userId: 7, payload })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'session_incomplete' }
    });
    expect(repository.checkout).not.toHaveBeenCalled();
  });

  test('prices a stored plan selection that is missing catalog_pricing', async () => {
    const unpricedContext = {
      ...validContext,
      planSelection: {
        subscription_term_months: 1,
        pets: [{
          pet_id: 'pet-1',
          pet_name: 'Luna',
          enabled: true,
          selected_flavors: ['chicken'],
          flavor_weights: [8]
        }]
      }
    };
    const planPreviewRepository = {
      previewPlan: jest.fn().mockResolvedValue({
        subscription_term_months: 1,
        catalog_pricing: validContext.planSelection.catalog_pricing,
        flavors_by_pet: [{ pet_id: 'pet-1', flavors: { chicken: 8 } }]
      })
    };
    const { service, stripeBilling } = buildService({
      planPreviewRepository,
      repository: {
        checkout: jest.fn().mockImplementation(async (_userId, nextPayload) => nextPayload.checkout),
        getCheckoutContext: jest.fn().mockResolvedValue(unpricedContext),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });

    const result = await service.checkout({ userId: 7, payload });

    expect(result.success).toBe(true);
    expect(planPreviewRepository.previewPlan).toHaveBeenCalledWith(7, expect.objectContaining({
      subscription_term_months: 1,
      pets: unpricedContext.planSelection.pets
    }), expect.objectContaining({ country: 'US' }));
    expect(stripeBilling.createOnboardingSubscription).toHaveBeenCalledTimes(1);
  });

  test('rejects an invalid customer email', async () => {
    const { service, stripeBilling } = buildService({
      repository: {
        checkout: jest.fn(),
        getPlanSelection: jest.fn().mockResolvedValue(validContext.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue(validContext),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'not-an-email', name: 'Jane' })
      }
    });

    await expect(service.checkout({
      userId: 7,
      payload: { ...payload, billing: { email: 'also-bad' } }
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_customer_email' }
    });
    expect(stripeBilling.createOnboardingSubscription).not.toHaveBeenCalled();
  });

  test('uses the BR Stripe client for a Brazil address', async () => {
    const brContext = {
      ...validContext,
      address: { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' },
      shipping: quoted(BR_ADDRESS, { ...validContext.shipping, distance: 10 }),
      planSelection: {
        ...validContext.planSelection,
        catalog_pricing: { ...validContext.planSelection.catalog_pricing, currency: 'brl' }
      }
    };
    const usBilling = {
      createOnboardingSubscription: jest.fn()
    };
    const brBilling = {
      automaticTaxEnabled: false,
      createOnboardingSubscription: jest.fn().mockResolvedValue({
        customerId: 'cus_br',
        subscription: { id: 'sub_br', status: 'incomplete' },
        checkout: {
          order_id: 0,
          payment_state: 'requires_confirmation',
          stripe_client_secret: 'secret_br',
          stripe_subscription_id: 'sub_br',
          status: 'incomplete'
        }
      }),
      retrievePaymentIntent: jest.fn(),
      resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation')
    };
    const stripeAccounts = {
      getForCreation: jest.fn((account) => (account === 'br' ? brBilling : usBilling)),
      get: jest.fn((account) => (account === 'br' ? brBilling : usBilling))
    };
    const { service, customerStore, stripeCouponService } = buildService({
      stripeAccounts,
      stripeBilling: usBilling,
      repository: {
        checkout: jest.fn().mockImplementation(async (_userId, checkoutPayload) => checkoutPayload.checkout),
        getPlanSelection: jest.fn().mockResolvedValue(brContext.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue(brContext),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_brl', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });

    const result = await service.checkout({ userId: 7, payload });

    expect(stripeAccounts.getForCreation).toHaveBeenCalledWith('br');
    expect(customerStore.getCustomerId).toHaveBeenCalledWith(7, 'br');
    expect(stripeCouponService.resolveFirstPurchasePromotionForCheckout).toHaveBeenCalledWith(expect.objectContaining({
      account: 'br'
    }));
    expect(brBilling.createOnboardingSubscription).toHaveBeenCalled();
    expect(usBilling.createOnboardingSubscription).not.toHaveBeenCalled();
    expect(result.data.stripe_account).toBe('br');
  });

  test('blocks Brazil checkout when STRIPE_BR_ENABLED is off', async () => {
    const brContext = {
      ...validContext,
      address: { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' },
      shipping: quoted(BR_ADDRESS, { ...validContext.shipping, distance: 10 })
    };
    const { service, stripeBilling } = buildService({
      stripeBrEnabled: false,
      repository: {
        checkout: jest.fn(),
        getPlanSelection: jest.fn().mockResolvedValue(validContext.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue(brContext),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });

    await expect(service.checkout({ userId: 7, payload })).rejects.toMatchObject({
      statusCode: 503,
      details: { code: 'stripe_br_disabled', stripe_account: 'br' }
    });
    expect(stripeBilling.createOnboardingSubscription).not.toHaveBeenCalled();
  });

  test('rejects a Brazil checkout that has no catalog currency', async () => {
    const brContext = {
      ...validContext,
      address: { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' },
      shipping: quoted(BR_ADDRESS, { ...validContext.shipping, distance: 10 }),
      planSelection: {
        ...validContext.planSelection,
        catalog_pricing: { ...validContext.planSelection.catalog_pricing, currency: '' }
      }
    };
    const brBilling = { createOnboardingSubscription: jest.fn() };
    const { service } = buildService({
      stripeBrEnabled: true,
      stripeAccounts: {
        getForCreation: jest.fn(() => brBilling),
        get: jest.fn(() => brBilling)
      },
      repository: {
        checkout: jest.fn(),
        getPlanSelection: jest.fn().mockResolvedValue(brContext.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue(brContext),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });

    await expect(service.checkout({ userId: 7, payload })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'catalog_currency_missing' }
    });
    expect(brBilling.createOnboardingSubscription).not.toHaveBeenCalled();
  });

  test('refuses a Brazil address farther than 50 km and accepts 49 km', async () => {
    const far = {
      ...validContext,
      address: { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' },
      planSelection: {
        ...validContext.planSelection,
        catalog_pricing: { ...validContext.planSelection.catalog_pricing, currency: 'brl' }
      },
      shipping: quoted(BR_ADDRESS, { rate_id: 'br:1', cost: 10, distance: 51 })
    };
    const near = { ...far, shipping: quoted(BR_ADDRESS, { rate_id: 'br:1', cost: 10, distance: 49 }) };
    const farRun = buildService({
      stripeBrEnabled: true,
      repository: {
        checkout: jest.fn().mockImplementation(async (_userId, payload) => payload.checkout),
        getPlanSelection: jest.fn().mockResolvedValue(far.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue(far),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });
    await expect(farRun.service.checkout({ userId: 7, payload })).rejects.toMatchObject({
      statusCode: 422,
      message: 'outside_delivery_area',
      details: { code: 'outside_delivery_area' }
    });
    expect(farRun.stripeBilling.createOnboardingSubscription).not.toHaveBeenCalled();

    const nearBilling = {
      automaticTaxEnabled: false,
      createOnboardingSubscription: jest.fn().mockResolvedValue({
        customerId: 'cus_br',
        subscription: { id: 'sub_br', status: 'incomplete' },
        checkout: { order_id: 0, payment_state: 'requires_confirmation', stripe_client_secret: 'secret', stripe_subscription_id: 'sub_br', status: 'incomplete' }
      }),
      retrievePaymentIntent: jest.fn(),
      resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation')
    };
    const nearRun = buildService({
      stripeBrEnabled: true,
      stripeBilling: nearBilling,
      stripeAccounts: {
        getForCreation: jest.fn(() => nearBilling),
        get: jest.fn(() => nearBilling)
      },
      repository: {
        checkout: jest.fn().mockImplementation(async (_userId, payload) => payload.checkout),
        getPlanSelection: jest.fn().mockResolvedValue(near.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue(near),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });
    const result = await nearRun.service.checkout({ userId: 7, payload });
    expect(result.success).toBe(true);
    expect(nearRun.stripeBilling.createOnboardingSubscription).toHaveBeenCalled();
  });

  test('accepts a Brazil address at exactly 50 km', async () => {
    const exact = {
      ...validContext,
      address: { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' },
      planSelection: {
        ...validContext.planSelection,
        catalog_pricing: { ...validContext.planSelection.catalog_pricing, currency: 'brl' }
      },
      shipping: quoted(BR_ADDRESS, { rate_id: 'br:1', cost: 10, distance: 50 })
    };
    const billing = {
      automaticTaxEnabled: false,
      createOnboardingSubscription: jest.fn().mockResolvedValue({
        customerId: 'cus_br',
        subscription: { id: 'sub_br', status: 'incomplete' },
        checkout: { order_id: 0, payment_state: 'requires_confirmation', stripe_client_secret: 'secret', stripe_subscription_id: 'sub_br', status: 'incomplete' }
      }),
      retrievePaymentIntent: jest.fn(),
      resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation')
    };
    const run = buildService({
      stripeBrEnabled: true,
      stripeBilling: billing,
      stripeAccounts: { getForCreation: jest.fn(() => billing), get: jest.fn(() => billing) },
      repository: {
        checkout: jest.fn().mockImplementation(async (_userId, body) => body.checkout),
        getPlanSelection: jest.fn().mockResolvedValue(exact.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue(exact),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });
    const result = await run.service.checkout({ userId: 7, payload });
    expect(result.success).toBe(true);
  });

  test('refuses checkout when the delivery area cannot be verified', async () => {
    const brazil = {
      ...validContext,
      address: { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' },
      shipping: { rate_id: 'br:1', cost: 10 }
    };
    const unitedStates = {
      ...validContext,
      shipping: quoted(US_ADDRESS, { rate_id: 'fixed_us:default', cost: 12.9, delivery_days: null })
    };
    for (const context of [brazil, unitedStates]) {
      const run = buildService({
        repository: {
          checkout: jest.fn(),
          getPlanSelection: jest.fn().mockResolvedValue(context.planSelection),
          getCheckoutContext: jest.fn().mockResolvedValue(context),
          resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
          getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
        }
      });
      await expect(run.service.checkout({ userId: 7, payload })).rejects.toMatchObject({
        statusCode: 422,
        message: 'delivery_area_unverified',
        details: { code: 'delivery_area_unverified' }
      });
    }
  });

  test('refuses checkout when the saved shipping snapshot has no transit or distance', async () => {
    const { normalizeShippingPayload } = require('../src/services/onboarding-shipping-select.service');
    const { CustomerDeliveriesService } = require('../src/services/customer-deliveries.service');
    const plan = new CustomerDeliveriesService({
      calendar: { listActive: async () => [] },
      shippingQuoteSigner: quoteSigner
    });
    const upsFallback = normalizeShippingPayload({
      rate_id: 'fixed_us:default',
      method_id: 'fixed_us',
      cost: 12.9,
      delivery_days: 0,
      transit_business_days: 0,
      quote_token: quoteSigner.sign({ country: 'US', zipcode: '94105', cost: 12.9, deliveryDays: null })
    });
    const brazilWithoutDistance = normalizeShippingPayload({ rate_id: 'br:1', cost: 10 });
    const cases = [
      ['US', { ...validContext, shipping: upsFallback }, upsFallback],
      ['BR', {
        ...validContext,
        address: BR_ADDRESS,
        shipping: brazilWithoutDistance
      }, brazilWithoutDistance]
    ];
    for (const [market, context, shipping] of cases) {
      const run = buildService({
        repository: {
          checkout: jest.fn(),
          getPlanSelection: jest.fn().mockResolvedValue(context.planSelection),
          getCheckoutContext: jest.fn().mockResolvedValue(context),
          resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
          getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
        }
      });
      await expect(run.service.checkout({ userId: 7, payload })).rejects.toMatchObject({
        statusCode: 422,
        details: { code: 'delivery_area_unverified' }
      });
      expect(run.stripeBilling.createOnboardingSubscription).not.toHaveBeenCalled();
      await expect(plan.applyAddressChange({
        market,
        userId: 7,
        chargeAt: new Date('2026-01-03T17:00:00Z')
      }, { zipcode: context.address.zipcode, shipping })).rejects.toMatchObject({
        details: { code: 'delivery_area_unverified' }
      });
    }
  });

  test('refuses a United States address with 2 transit days and accepts 1', async () => {
    const far = {
      ...validContext,
      shipping: quoted(US_ADDRESS, { rate_id: 'ups:1', cost: 12.9, delivery_days: 2 })
    };
    const near = {
      ...validContext,
      shipping: quoted(US_ADDRESS, { rate_id: 'ups:1', cost: 12.9, delivery_days: 1 })
    };
    const farRun = buildService({
      repository: {
        checkout: jest.fn().mockImplementation(async (_userId, payload) => payload.checkout),
        getPlanSelection: jest.fn().mockResolvedValue(far.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue(far),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });
    await expect(farRun.service.checkout({ userId: 7, payload })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'outside_delivery_area' }
    });
    expect(farRun.stripeBilling.createOnboardingSubscription).not.toHaveBeenCalled();

    const nearRun = buildService({
      repository: {
        checkout: jest.fn().mockImplementation(async (_userId, payload) => payload.checkout),
        getPlanSelection: jest.fn().mockResolvedValue(near.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue(near),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });
    const result = await nearRun.service.checkout({ userId: 7, payload });
    expect(result.success).toBe(true);
  });

  test('checkout and the plan address change agree on the same address', async () => {
    const { CustomerDeliveriesService } = require('../src/services/customer-deliveries.service');
    const plan = new CustomerDeliveriesService({
      calendar: { listActive: async () => [] },
      shippingQuoteSigner: quoteSigner,
      now: () => new Date('2026-01-02T12:00:00Z')
    });
    const cases = [
      ['BR', { distance: 51 }],
      ['BR', { distance: 49 }],
      ['US', { delivery_days: 2 }],
      ['US', { delivery_days: 1 }]
    ];
    for (const [market, shipping] of cases) {
      const context = {
        ...validContext,
        address: market === 'BR'
          ? { country: 'BR', zipcode: '01310100', state: 'SP', city: 'Sao Paulo' }
          : validContext.address,
        planSelection: market === 'BR'
          ? {
            ...validContext.planSelection,
            catalog_pricing: { ...validContext.planSelection.catalog_pricing, currency: 'brl' }
          }
          : validContext.planSelection,
        shipping: quoted(market === 'BR' ? BR_ADDRESS : US_ADDRESS, { rate_id: 'rate', cost: 10, ...shipping })
      };
      let checkoutRefused = false;
      const run = buildService({
        stripeBrEnabled: true,
        repository: {
          checkout: jest.fn().mockImplementation(async (_userId, body) => body.checkout),
          getPlanSelection: jest.fn().mockResolvedValue(context.planSelection),
          getCheckoutContext: jest.fn().mockResolvedValue(context),
          resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
          getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
        }
      });
      try {
        await run.service.checkout({ userId: 7, payload });
      } catch (error) {
        checkoutRefused = error.details && error.details.code === 'outside_delivery_area';
        if (!checkoutRefused) throw error;
      }
      let planRefused = false;
      try {
        await plan.applyAddressChange({
          market,
          userId: 7,
          chargeAt: new Date('2026-01-03T17:00:00Z'),
          transitDays: 0
        }, { zipcode: context.address.zipcode, shipping: context.shipping });
      } catch (error) {
        planRefused = error.details && error.details.code === 'outside_delivery_area';
        if (!planRefused) throw error;
      }
      expect(planRefused).toBe(checkoutRefused);
    }
  });

  describe('server-signed shipping quote', () => {
    const brazilPlanSelection = {
      ...validContext.planSelection,
      catalog_pricing: { ...validContext.planSelection.catalog_pricing, currency: 'brl' }
    };

    function contextRepository(context) {
      return {
        checkout: jest.fn().mockImplementation(async (_userId, body) => body.checkout),
        getPlanSelection: jest.fn().mockResolvedValue(context.planSelection),
        getCheckoutContext: jest.fn().mockResolvedValue(context),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      };
    }

    async function expectUnverified(context, reason) {
      const run = buildService({ stripeBrEnabled: true, repository: contextRepository(context) });
      const error = await run.service.checkout({ userId: 7, payload }).then(
        () => { throw new Error('Expected checkout to be refused.'); },
        (refusal) => refusal
      );
      expect(error.statusCode).toBe(422);
      expect(error.details).toEqual(reason
        ? { code: 'delivery_area_unverified', reason }
        : { code: 'delivery_area_unverified' });
      expect(run.stripeBilling.createOnboardingSubscription).not.toHaveBeenCalled();
      expect(run.repository.checkout).not.toHaveBeenCalled();
    }

    test('refuses a distance changed after the server signed the quote', async () => {
      const signed = quoted(BR_ADDRESS, { rate_id: 'br:1', cost: 10, distance: 55 });
      await expectUnverified({
        ...validContext,
        address: BR_ADDRESS,
        planSelection: brazilPlanSelection,
        shipping: { ...signed, distance: 49 }
      });
    });

    test('refuses a transit changed after the server signed the quote', async () => {
      const signed = quoted(US_ADDRESS, { rate_id: 'ups:03', cost: 12.9, delivery_days: 2 });
      await expectUnverified({ ...validContext, shipping: { ...signed, delivery_days: 1 } });
    });

    test('refuses a shipping value changed after the server signed the quote', async () => {
      const signed = quoted(US_ADDRESS, { rate_id: 'ups:03', cost: 12.9, delivery_days: 1 });
      await expectUnverified({ ...validContext, shipping: { ...signed, cost: 0.5, total: 0.5 } });
    });

    test('refuses a quote signed with another secret', async () => {
      const forger = new ShippingQuoteSigner({ secret: 'not-the-server-secret' });
      await expectUnverified({
        ...validContext,
        shipping: quoted(US_ADDRESS, { rate_id: 'ups:03', cost: 12.9, delivery_days: 1 }, forger)
      });
    });

    test('refuses a quote older than 30 minutes and says it expired', async () => {
      const past = new ShippingQuoteSigner({
        secret: 'test-shipping-quote-secret',
        now: () => new Date(Date.now() - 31 * 60 * 1000)
      });
      await expectUnverified({
        ...validContext,
        shipping: quoted(US_ADDRESS, { rate_id: 'ups:03', cost: 12.9, delivery_days: 1 }, past)
      }, 'quote_expired');
    });

    test('an expired quote that was also changed gives no reason', async () => {
      const past = new ShippingQuoteSigner({
        secret: 'test-shipping-quote-secret',
        now: () => new Date(Date.now() - 31 * 60 * 1000)
      });
      const signed = quoted(US_ADDRESS, { rate_id: 'ups:03', cost: 12.9, delivery_days: 1 }, past);
      await expectUnverified({ ...validContext, shipping: { ...signed, cost: 0.5 } });
      await expectUnverified({
        ...validContext,
        shipping: quoted({ country: 'US', zipcode: '10001' }, { rate_id: 'ups:03', cost: 12.9, delivery_days: 1 }, past)
      });
    });

    test('refuses a quote for another address', async () => {
      await expectUnverified({
        ...validContext,
        shipping: quoted({ country: 'US', zipcode: '10001' }, { rate_id: 'ups:03', cost: 12.9, delivery_days: 1 })
      });
    });

    test('refuses a missing quote', async () => {
      await expectUnverified({ ...validContext, shipping: { rate_id: 'ups:03', cost: 12.9, delivery_days: 1 } });
    });

    test('accepts a valid quote made 29 minutes ago', async () => {
      const recent = new ShippingQuoteSigner({
        secret: 'test-shipping-quote-secret',
        now: () => new Date(Date.now() - 29 * 60 * 1000)
      });
      const context = {
        ...validContext,
        shipping: quoted(US_ADDRESS, { rate_id: 'ups:03', cost: 12.9, delivery_days: 1 }, recent)
      };
      const run = buildService({ repository: contextRepository(context) });
      const result = await run.service.checkout({ userId: 7, payload });
      expect(result.success).toBe(true);
      expect(run.stripeBilling.createOnboardingSubscription).toHaveBeenCalledWith(expect.objectContaining({
        shipping: expect.objectContaining({ cost: 12.9 })
      }));
    });

    test('the plan address change refuses a tampered quote and accepts a valid one', async () => {
      const { CustomerDeliveriesService } = require('../src/services/customer-deliveries.service');
      const plan = new CustomerDeliveriesService({
        calendar: { listActive: async () => [] },
        shippingQuoteSigner: quoteSigner
      });
      const subscription = { market: 'BR', userId: 7, chargeAt: new Date('2026-01-03T17:00:00Z') };
      const signed = quoted(BR_ADDRESS, { rate_id: 'br:1', cost: 10, distance: 55 });
      await expect(plan.applyAddressChange(subscription, {
        zipcode: BR_ADDRESS.zipcode,
        shipping: { ...signed, distance: 49 }
      })).rejects.toMatchObject({ details: { code: 'delivery_area_unverified' } });
      await expect(plan.applyAddressChange(subscription, {
        zipcode: BR_ADDRESS.zipcode,
        shipping: quoted(BR_ADDRESS, { rate_id: 'br:1', cost: 10, distance: 49 })
      })).resolves.toEqual(expect.objectContaining({ stripeChanged: false }));
    });
  });

  describe('United States fixed shipping transit', () => {
    const { ShippingService } = require('../src/services/shipping.service');
    const { normalizeShippingPayload } = require('../src/services/onboarding-shipping-select.service');

    function usSettings(quoteMode) {
      return {
        us: {
          enabled: true,
          quote_mode: quoteMode,
          fallback_enabled: true,
          cost: 12.9,
          label: 'Ground',
          carrier: 'UPS',
          delivery: '1 business day'
        },
        br: { enabled: false, rule: { per_km: 0 } }
      };
    }

    function savedLikeTheStore(quote) {
      return normalizeShippingPayload({
        rate_id: quote.rate_id,
        method_id: quote.method_id,
        cost: quote.shipping,
        total: quote.shipping,
        delivery_days: Number(quote.delivery_days || 0),
        transit_business_days: Number(quote.delivery_days || 0),
        quoted_at: quote.quoted_at,
        zipcode: quote.destination.zipcode,
        quote_token: quote.quote_token
      });
    }

    async function checkoutWith(shipping) {
      const context = { ...validContext, shipping };
      const run = buildService({
        repository: {
          checkout: jest.fn().mockImplementation(async (_userId, body) => body.checkout),
          getPlanSelection: jest.fn().mockResolvedValue(context.planSelection),
          getCheckoutContext: jest.fn().mockResolvedValue(context),
          resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
          getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
        }
      });
      return run.service.checkout({ userId: 7, payload });
    }

    test('fixed mode outside production quotes 1 transit day and checkout closes', async () => {
      const shippingService = new ShippingService({
        settings: usSettings('fixed'),
        quoteSigner,
        production: false
      });
      const { data } = await shippingService.calculateUs({ zipCode: '94105' });
      expect(data.rate_id).toBe('fixed_us:default');
      expect(data.delivery_days).toBe(1);
      const result = await checkoutWith(savedLikeTheStore(data));
      expect(result.success).toBe(true);
    });

    test('fixed transit days is configurable outside production', async () => {
      const shippingService = new ShippingService({
        settings: usSettings('fixed'),
        quoteSigner,
        production: false,
        fixedTransitDays: 2
      });
      const { data } = await shippingService.calculateUs({ zipCode: '94105' });
      expect(data.delivery_days).toBe(2);
      await expect(checkoutWith(savedLikeTheStore(data))).rejects.toMatchObject({
        details: { code: 'outside_delivery_area' }
      });
    });

    test('the fixed fallback in production is unverified and checkout refuses', async () => {
      const shippingService = new ShippingService({
        settings: usSettings('ups'),
        quoteSigner,
        production: true
      });
      const { data } = await shippingService.calculateUs({ zipCode: '94105' });
      expect(data.rate_id).toBe('fixed_us:default');
      expect(data.source).toBe('fallback');
      expect(data.delivery_days).toBeNull();
      await expect(checkoutWith(savedLikeTheStore(data))).rejects.toMatchObject({
        statusCode: 422,
        details: { code: 'delivery_area_unverified' }
      });
    });

    test('fixed mode in production is unverified and logs an error at startup', async () => {
      const logger = { error: jest.fn() };
      const shippingService = new ShippingService({
        settings: usSettings('fixed'),
        quoteSigner,
        production: true
      });
      shippingService.reportQuoteModeAtStartup(logger);
      expect(logger.error).toHaveBeenCalledTimes(1);
      const { data } = await shippingService.calculateUs({ zipCode: '94105' });
      expect(data.delivery_days).toBeNull();
      await expect(checkoutWith(savedLikeTheStore(data))).rejects.toMatchObject({
        details: { code: 'delivery_area_unverified' }
      });

      const quiet = { error: jest.fn() };
      new ShippingService({ settings: usSettings('fixed'), production: false }).reportQuoteModeAtStartup(quiet);
      new ShippingService({ settings: usSettings('ups'), production: true }).reportQuoteModeAtStartup(quiet);
      expect(quiet.error).not.toHaveBeenCalled();
    });
  });
});
