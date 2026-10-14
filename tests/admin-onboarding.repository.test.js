const { AdminOnboardingRepository } = require('../src/infrastructure/repositories/admin-onboarding.repository');

describe('AdminOnboardingRepository.getCheckout', () => {
  function createDataSource(userRows, petRows = []) {
    return {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce(userRows)
        .mockResolvedValueOnce(petRows)
    };
  }

  test('returns pets for a customer without an onboarding state row', async () => {
    const dataSource = createDataSource([{
      user_id: 42,
      email: 'ana@x.com',
      displayName: 'Ana',
      activationStatus: null,
      profileMarket: 'br',
      checkout_reference: null,
      plan_selection: null,
      recurrence: null,
      address: null,
      shipping: null,
      payment_reference: null,
      market: null,
      created_at: null,
      updated_at: null
    }], [{ id: 7, name: 'Rex', breed: '', age_years: 2, age_months: 0, weight_input: 10, weight_unit: 'kg', size: '', activity_level: '', pet_condition: '', neutered: 1 }]);
    const repository = new AdminOnboardingRepository(dataSource);

    const result = await repository.getCheckout('42');

    const sql = dataSource.query.mock.calls[0][0];
    expect(sql).toContain('FROM `wp_users` u');
    expect(sql).toContain('LEFT JOIN `onboarding_user_state` s ON s.user_id = u.ID');
    expect(sql).not.toContain('GROUP BY');
    expect(result).toMatchObject({
      userId: '42',
      checkoutReference: null,
      market: 'BR',
      pets: [{ id: '7', name: 'Rex', neutered: true }]
    });
  });

  test('prefers the state row market over the profile market', async () => {
    const dataSource = createDataSource([{ user_id: 42, market: 'us', profileMarket: 'BR' }]);
    const repository = new AdminOnboardingRepository(dataSource);

    const result = await repository.getCheckout('42');

    expect(result.market).toBe('US');
  });

  test('returns null when the user does not exist', async () => {
    const dataSource = createDataSource([]);
    const repository = new AdminOnboardingRepository(dataSource);

    await expect(repository.getCheckout('42')).resolves.toBeNull();
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });
});
