const { OnboardingSubscriptionCheckoutService } = require('../src/services/onboarding-subscription-checkout.service');

describe('OnboardingSubscriptionCheckoutService', () => {
  test('checks fresh account status before creating checkout', async () => {
    const repository = { checkout: jest.fn().mockResolvedValue({ order_id: 101 }) };
    const authService = { assertCriticalOperationAllowed: jest.fn().mockResolvedValue({ id: 7, activation_status: 'active' }) };
    const service = new OnboardingSubscriptionCheckoutService(repository, { authService });

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
    const repository = { checkout: jest.fn() };
    const authService = { assertCriticalOperationAllowed: jest.fn().mockRejectedValue(new Error('blocked')) };
    const service = new OnboardingSubscriptionCheckoutService(repository, { authService });

    await expect(service.checkout({ userId: 7, payload: {} })).rejects.toThrow('blocked');
    expect(repository.checkout).not.toHaveBeenCalled();
  });
});
