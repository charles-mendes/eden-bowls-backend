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

  test('the selection keeps the quoted charge fields, the company cost and the source', () => {
    const { normalizeShippingPayload } = require('../src/services/onboarding-shipping-select.service');
    const shipping = normalizeShippingPayload({
      rate_id: 'ups:03',
      cost: 18.4,
      original_amount: 18.4,
      charged_amount: 0,
      charge_enabled: false,
      source: 'ups'
    });
    expect(shipping).toMatchObject({
      cost: 18.4,
      original_amount: 18.4,
      charged_amount: 0,
      charge_enabled: false,
      company_cost: 18.4,
      source: 'ups'
    });
    expect(normalizeShippingPayload({ rate_id: 'br:1', cost: 15 })).toMatchObject({
      original_amount: 15,
      charged_amount: 15,
      charge_enabled: true,
      company_cost: null,
      source: null
    });
  });
});
