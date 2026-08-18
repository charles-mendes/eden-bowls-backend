const { HttpError } = require('../src/core/http-error');
const { createCheckoutLockStore } = require('../src/core/checkout-idempotency');
const { OnboardingSubscriptionCheckoutService } = require('../src/services/onboarding-subscription-checkout.service');

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
  address: { country: 'US', zipcode: '94105', state: 'CA', city: 'San Francisco' },
  shipping: { rate_id: 'fixed_us:default', cost: 12.9 },
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

  return {
    service: new OnboardingSubscriptionCheckoutService(repository, {
      authService,
      discountEligibilityRepository,
      stripeCouponService,
      stripeBilling,
      customerStore,
      lockStore,
      planPreviewRepository: overrides.planPreviewRepository || null
    }),
    repository,
    authService,
    discountEligibilityRepository,
    stripeCouponService,
    stripeBilling,
    customerStore
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
      termMonths: 1
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
      termMonths: 1
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
          shipping: { rate_id: 'fixed_us:default', cost: 20 },
          checkoutReference: stored
        }),
        resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
        getUserEmail: jest.fn().mockResolvedValue({ email: 'jane@example.com', name: 'Jane Doe' })
      }
    });

    await service.checkout({ userId: 7, payload });

    expect(stripeBilling.createOnboardingSubscription).toHaveBeenCalledTimes(1);
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
});
