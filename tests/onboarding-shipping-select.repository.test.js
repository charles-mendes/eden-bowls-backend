const { OnboardingShippingSelectRepository } = require('../src/infrastructure/repositories/onboarding-shipping-select.repository');

describe('OnboardingShippingSelectRepository', () => {
  test('upserts the shipping snapshot under the authenticated user id', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingShippingSelectRepository(dataSource);
    const shipping = { rate_id: 'rate-1', total: 5.5, zipcode: '94105' };

    await expect(repository.selectShipping(7, shipping)).resolves.toEqual({ shipping });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `onboarding_user_state` (`user_id`, `shipping`) VALUES (?, ?) ON DUPLICATE KEY UPDATE'),
      [7, JSON.stringify(shipping)]
    );
  });
});
