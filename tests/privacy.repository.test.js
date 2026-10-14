const { PrivacyRepository } = require('../src/infrastructure/repositories/privacy.repository');

describe('PrivacyRepository export queries', () => {
  test('reads the subscription summary from the subscriptions ledger table', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue([]) };
    const repository = new PrivacyRepository(dataSource);

    await repository.listSubscriptionSummary(5);

    expect(dataSource.query.mock.calls[0][0]).toContain('FROM `stripe_subscriptions`');
  });
});
