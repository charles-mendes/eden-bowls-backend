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
});
