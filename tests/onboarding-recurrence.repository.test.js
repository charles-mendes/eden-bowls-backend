const { OnboardingRecurrenceRepository } = require('../src/infrastructure/repositories/onboarding-recurrence.repository');

describe('OnboardingRecurrenceRepository', () => {
  test('upserts recurrence under the authenticated user id', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingRecurrenceRepository(dataSource);

    const result = await repository.setRecurrence(7, { frequency: 'monthly', periodDays: 30 });

    expect(result.recurrence).toEqual(expect.objectContaining({ frequency: 'monthly', period_days: 30 }));
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `onboarding_user_state` (`user_id`, `recurrence`) VALUES (?, ?) ON DUPLICATE KEY UPDATE'),
      [7, expect.stringContaining('"frequency":"monthly"')]
    );
  });
});
