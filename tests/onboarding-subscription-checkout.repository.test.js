const { OnboardingSubscriptionCheckoutRepository } = require('../src/infrastructure/repositories/onboarding-subscription-checkout.repository');

describe('OnboardingSubscriptionCheckoutRepository', () => {
  test('persists checkout reference under the authenticated user id', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingSubscriptionCheckoutRepository(dataSource);

    const result = await repository.checkout(7, { paymentMethodId: 'pm_123', checkout_mode: 'subscription_first' });

    expect(result.order_id).toBe(101);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `onboarding_user_state` (`user_id`, `checkout_reference`) VALUES (?, ?) ON DUPLICATE KEY UPDATE'),
      [7, expect.stringContaining('"order_id":101')]
    );
  });

  test('persists the first-purchase discount snapshot and Stripe discounts payload', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingSubscriptionCheckoutRepository(dataSource);

    const result = await repository.checkout(7, {
      discount_eligibility: { validated: true, eligible: true, reason: null },
      discount_applied_percent: 25,
      stripe_promotion_code_id: 'promo_3m',
      stripe_discount_duration: 'once',
      plan_selection: { subscription_term_months: 3 }
    });

    expect(result).toEqual(expect.objectContaining({
      discount_applied_percent: 25,
      stripe_promotion_code_id: 'promo_3m',
      stripe_discount_percent: 25,
      stripe_discount_amount: 6.25,
      stripe_discount_duration: 'once',
      discounts: [{ promotion_code: 'promo_3m' }]
    }));
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('(`user_id`, `checkout_reference`, `plan_selection`)'),
      [7, expect.stringContaining('"stripe_promotion_code_id":"promo_3m"'), expect.stringContaining('"subscription_term_months":3')]
    );
  });

  test('omits Stripe discounts when the user is not eligible', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingSubscriptionCheckoutRepository(dataSource);

    const result = await repository.checkout(7, {
      discount_eligibility: { validated: true, eligible: false, reason: 'HAS_PREVIOUS_PURCHASE' },
      discount_applied_percent: 0
    });

    expect(result.discounts).toEqual([]);
    expect(result.stripe_promotion_code_id).toBeNull();
    expect(result.stripe_discount_amount).toBe(0);
  });

  test('reads plan_selection for the authenticated user', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{ plan_selection: { subscription_term_months: 6 } }])
    };
    const repository = new OnboardingSubscriptionCheckoutRepository(dataSource);

    await expect(repository.getPlanSelection(7)).resolves.toEqual({ subscription_term_months: 6 });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT `plan_selection` FROM `onboarding_user_state`'),
      [7]
    );
  });
});
