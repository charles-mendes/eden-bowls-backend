const { OnboardingQuotesRepository } = require('../src/infrastructure/repositories/onboarding-quotes.repository');

describe('OnboardingQuotesRepository', () => {
  test('persists a quote without requiring a user', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingQuotesRepository(dataSource);
    const expiresAt = new Date('2026-08-14T12:00:00.000Z');

    await repository.createQuote({
      id: 'quote-1',
      payloadHash: 'hash-1',
      payload: { pets: [] },
      pricing: { total: 20 },
      expiresAt
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES (?, ?, ?, ?, ?, 'active', ?)"),
      ['quote-1', null, 'hash-1', JSON.stringify({ pets: [] }), JSON.stringify({ total: 20 }), expiresAt]
    );
  });

  test('consumes a quote only once while it is active', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingQuotesRepository(dataSource);
    const now = new Date('2026-08-14T12:00:00.000Z');

    await expect(repository.consumeQuote('quote-1', now)).resolves.toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE `id` = ? AND `status` = 'active' AND `expires_at` > ?"),
      [now, 'quote-1', now]
    );
  });
});