const { OnboardingZipcodeRepository } = require('../src/infrastructure/repositories/onboarding-zipcode.repository');

describe('OnboardingZipcodeRepository', () => {
  test('upserts a confirmed address under the authenticated user id', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingZipcodeRepository(dataSource);
    const payload = { zipcode: '94105', country: 'US', state: 'CA', city: 'San Francisco' };

    const result = await repository.saveZipcode(7, payload);

    expect(result).toEqual({ zipcode: payload });
    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql.replace(/\s+/g, ' ')).toContain('INSERT INTO `onboarding_user_state` (`user_id`, `address`, `market`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `address` = VALUES(`address`)');
    expect(params).toEqual([7, JSON.stringify(payload), 'US']);
  });

  test('fills an empty market on a row another step created, and never replaces a stored one', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 2 }) };
    await new OnboardingZipcodeRepository(dataSource).saveZipcode(7, { zipcode: '01310100', country: 'BR' });

    const [sql] = dataSource.query.mock.calls[0];
    expect(sql).toContain("`market` = COALESCE(NULLIF(`market`, ''), VALUES(`market`))");
    expect(sql).not.toContain('`market` = VALUES(`market`)');
  });
});

describe('OnboardingZipcodeRepository.getAddress', () => {
  test('parses the stored JSON and returns null without a row', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValueOnce([{ address: '{"delivery_instructions":"Interfone 12"}' }]).mockResolvedValueOnce([]) };
    const repository = new OnboardingZipcodeRepository(dataSource);
    await expect(repository.getAddress(7)).resolves.toEqual({ delivery_instructions: 'Interfone 12' });
    await expect(repository.getAddress(8)).resolves.toBeNull();
    expect(dataSource.query.mock.calls[0][1]).toEqual([7]);
  });
});
