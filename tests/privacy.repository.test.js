const { PrivacyRepository } = require('../src/infrastructure/repositories/privacy.repository');

describe('PrivacyRepository export queries', () => {
  test('reads the subscription summary from the subscriptions ledger table', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue([]) };
    const repository = new PrivacyRepository(dataSource);

    await repository.listSubscriptionSummary(5);

    expect(dataSource.query.mock.calls[0][0]).toContain('FROM `stripe_subscriptions`');
  });

  test('the subscription summary carries each subscription instructions', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue([
      { id: 1, status: 'active', delivery_instructions: 'Portão verde' },
      { id: 2, status: 'cancelled', delivery_instructions: null }
    ]) };
    const rows = await new PrivacyRepository(dataSource).listSubscriptionSummary(5);
    expect(dataSource.query.mock.calls[0][0]).toContain("JSON_EXTRACT(`address`, '$.delivery_instructions')");
    expect(rows.map((row) => row.deliveryInstructions)).toEqual(['Portão verde', null]);
  });
});
