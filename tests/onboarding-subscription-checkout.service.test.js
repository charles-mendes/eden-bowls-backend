const { HttpError } = require('../src/core/http-error');
const { OnboardingSubscriptionCheckoutService } = require('../src/services/onboarding-subscription-checkout.service');

const validContext = {
  pets: [{ id: 1 }],
  planSelection: {
    subscription_term_months: 1,
    catalog_pricing: {
      subtotal: 40,
      line_items: [{ stripe_price_id: 'price_abc', quantity: 1 }]
    }
  },
  address: { country: 'US', zipcode: '94105', state: 'CA', city: 'San Francisco' },
  shipping: { rate_id: 'fixed_us:default', cost: 12.9 },
  recurrence: { subscription_term_months: 1 }
};

function buildService(overrides = {}) {
  const repository = overrides.repository || {
    checkout: jest.fn().mockResolvedValue({ order_id: 101 }),
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
    createOnboardingSubscription: jest.fn().mockResolvedValue({
      customerId: 'cus_1',
      checkout: {
        order_id: 101,
        payment_state: 'requires_confirmation',
        stripe_client_secret: 'secret_123',
        stripe_subscription_id: 'sub_123'
      }
    })
  };
  const customerStore = overrides.customerStore || {
    getCustomerId: jest.fn().mockResolvedValue(''),
    saveCustomerId: jest.fn().mockResolvedValue(undefined)
  };

  return {
    service: new OnboardingSubscriptionCheckoutService(repository, {
      authService,
      discountEligibilityRepository,
      stripeCouponService,
      stripeBilling,
      customerStore
    }),
    repository,
    authService,
    discountEligibilityRepository,
    stripeCouponService,
    stripeBilling,
    customerStore
  };
}

describe('OnboardingSubscriptionCheckoutService', () => {
  test('checks fresh account status before creating checkout', async () => {
    const { service, authService, repository } = buildService();

    await expect(service.checkout({ userId: 7, payload: { paymentMethodId: 'pm_123' } })).resolves.toEqual({
      success: true,
      data: { order_id: 101 }
    });
    expect(authService.assertCriticalOperationAllowed).toHaveBeenCalledWith(7);
    expect(repository.checkout).toHaveBeenCalledWith(7, expect.objectContaining({
      payment_method_id: 'pm_123',
      checkout_mode: 'order_first'
    }));
  });

  test('does not create checkout when the account guard rejects', async () => {
    const { service, repository } = buildService({
      authService: { assertCriticalOperationAllowed: jest.fn().mockRejectedValue(new Error('blocked')) }
    });

    await expect(service.checkout({ userId: 7, payload: {} })).rejects.toThrow('blocked');
    expect(repository.checkout).not.toHaveBeenCalled();
  });

  test('attaches the resolved promotion for an eligible user', async () => {
    const { service, repository, stripeCouponService } = buildService();

    await service.checkout({ userId: 7, payload: {} });

    expect(stripeCouponService.resolveFirstPurchasePromotionForCheckout).toHaveBeenCalledWith({
      eligible: true,
      termMonths: 1
    });
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

    await expect(service.checkout({ userId: 7, payload: {} })).rejects.toMatchObject({
      statusCode: 503,
      details: { code: 'first_purchase_promo_not_configured' }
    });
    expect(repository.checkout).not.toHaveBeenCalled();
  });

  test('creates checkout without discounts when the user is not eligible', async () => {
    const { service, repository, stripeCouponService } = buildService({
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

    await service.checkout({ userId: 7, payload: {} });

    expect(stripeCouponService.resolveFirstPurchasePromotionForCheckout).toHaveBeenCalledWith({
      eligible: false,
      termMonths: 1
    });
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
        checkout: jest.fn().mockResolvedValue({ order_id: 101 })
      },
      stripeCouponService: {
        resolveFirstPurchasePromotionForCheckout: jest.fn().mockResolvedValue({
          promotion_code_id: 'promo_3m',
          discount_percent: 25,
          discount_duration: 'once'
        })
      }
    });

    await service.checkout({ userId: 7, payload: {} });

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

    await expect(service.checkout({ userId: 7, payload: {} })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'session_incomplete' }
    });
    expect(repository.checkout).not.toHaveBeenCalled();
  });
});
