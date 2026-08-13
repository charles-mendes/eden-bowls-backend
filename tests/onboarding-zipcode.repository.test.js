const { OnboardingZipcodeRepository } = require('../src/infrastructure/repositories/onboarding-zipcode.repository');

describe('OnboardingZipcodeRepository', () => {
  test('upserts a confirmed address under the authenticated user id', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingZipcodeRepository(dataSource);
    const payload = { zipcode: '94105', country: 'US', state: 'CA', city: 'San Francisco' };

    const result = await repository.saveZipcode(7, payload);

    expect(result).toEqual({ zipcode: payload });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `onboarding_user_state` (`user_id`, `address`) VALUES (?, ?) ON DUPLICATE KEY UPDATE'),
      [7, JSON.stringify(payload)]
    );
  });
});
