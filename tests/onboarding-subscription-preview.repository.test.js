const { OnboardingSubscriptionPreviewRepository } = require('../src/infrastructure/repositories/onboarding-subscription-preview.repository');

describe('OnboardingSubscriptionPreviewRepository', () => {
  test('loads fallback price ids only from the authenticated user plan selection', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{ plan_selection: JSON.stringify({ pets: [{ price_ids: ['price_123', 'invalid'] }] }) }])
    };
    const repository = new OnboardingSubscriptionPreviewRepository(dataSource);

    await expect(repository.getFallbackPriceIds(7)).resolves.toEqual(['price_123']);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM `onboarding_user_state` WHERE `user_id` = ?'),
      [7]
    );
  });

  test('the US preview is priced from the plan items only, so a waived shipping never reaches the preview', async () => {
    const stripeBilling = { previewSubscriptionInvoice: jest.fn().mockResolvedValue({ total: 40 }) };
    const repository = new OnboardingSubscriptionPreviewRepository({ isInitialized: true }, { stripeBilling });

    await repository.preview({ address: { country: 'US' }, priceIds: ['price_123'], shipping: { cost: 18.4 } });

    expect(stripeBilling.previewSubscriptionInvoice).toHaveBeenCalledWith({
      address: { country: 'US' },
      items: [{ price: 'price_123', quantity: 1 }]
    });
  });
});

