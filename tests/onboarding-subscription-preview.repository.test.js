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
});
