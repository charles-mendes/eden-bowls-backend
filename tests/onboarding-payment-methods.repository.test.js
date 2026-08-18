const { OnboardingPaymentMethodsRepository } = require('../src/infrastructure/repositories/onboarding-payment-methods.repository');

describe('OnboardingPaymentMethodsRepository', () => {
  test('returns an empty list when the user has no Stripe customer', async () => {
    const repository = new OnboardingPaymentMethodsRepository({
      customerStore: { getCustomerId: jest.fn().mockResolvedValue('') },
      stripeBilling: { listCardPaymentMethods: jest.fn() }
    });

    await expect(repository.listSavedPaymentMethods(7)).resolves.toEqual([]);
  });

  test('lists cards from Stripe when a customer exists', async () => {
    const stripeBilling = {
      listCardPaymentMethods: jest.fn().mockResolvedValue([
        { id: 'pm_real', brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2028, is_default: true }
      ])
    };
    const repository = new OnboardingPaymentMethodsRepository({
      customerStore: { getCustomerId: jest.fn().mockResolvedValue('cus_123') },
      stripeBilling
    });

    await expect(repository.listSavedPaymentMethods(7)).resolves.toEqual([
      expect.objectContaining({ id: 'pm_real', last4: '4242' })
    ]);
    expect(stripeBilling.listCardPaymentMethods).toHaveBeenCalledWith('cus_123');
  });
});
