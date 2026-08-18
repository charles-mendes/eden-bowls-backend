const { HttpError } = require('../src/core/http-error');
const { OnboardingDiscountEligibilityRepository } = require('../src/infrastructure/repositories/onboarding-discount-eligibility.repository');

function createRepository(query) {
  return new OnboardingDiscountEligibilityRepository({
    isInitialized: true,
    query
  });
}

describe('OnboardingDiscountEligibilityRepository', () => {
  test('returns NOT_AUTHENTICATED without querying when userId is missing', async () => {
    const query = jest.fn();
    const repository = createRepository(query);

    await expect(repository.getEligibility(null)).resolves.toEqual({
      validated: false,
      eligible: null,
      reason: 'NOT_AUTHENTICATED'
    });
    expect(query).not.toHaveBeenCalled();
  });

  test('does not treat pending Woo orders as a previous purchase', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ user_email: 'jane@example.com' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const repository = createRepository(query);

    await expect(repository.getEligibility(7)).resolves.toEqual({
      validated: true,
      eligible: true,
      reason: null
    });

    const orderSql = query.mock.calls[1][0];
    expect(orderSql).toContain('_customer_user');
    expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining([
      'processing',
      'completed',
      '7'
    ]));
    expect(query.mock.calls[1][1]).not.toEqual(expect.arrayContaining(['pending', 'on-hold']));
  });

  test('returns HAS_PREVIOUS_PURCHASE when checkout_reference is already paid', async () => {
    const query = jest.fn().mockResolvedValueOnce([{
      checkout_reference: { payment_state: 'paid', stripe_subscription_id: 'sub_123' }
    }]);
    const repository = createRepository(query);

    await expect(repository.getEligibility(7)).resolves.toEqual({
      validated: true,
      eligible: false,
      reason: 'HAS_PREVIOUS_PURCHASE'
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('excludes the current checkout_reference.order_id from previous purchase', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ checkout_reference: { order_id: 101 } }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ user_email: 'jane@example.com' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const repository = createRepository(query);

    await expect(repository.getEligibility(7)).resolves.toEqual({
      validated: true,
      eligible: true,
      reason: null
    });

    const orderSql = query.mock.calls[1][0];
    expect(orderSql).toContain('p.ID <> ?');
    expect(query.mock.calls[1][1]).toContain(101);
  });

  test('returns HAS_ACTIVE_SUBSCRIPTION for the user id', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ user_email: 'jane@example.com' }])
      .mockResolvedValueOnce([{ ok: 1 }]);
    const repository = createRepository(query);

    await expect(repository.getEligibility(7)).resolves.toEqual({
      validated: true,
      eligible: false,
      reason: 'HAS_ACTIVE_SUBSCRIPTION'
    });
  });

  test('returns HAS_ACTIVE_SUBSCRIPTION for the user email fallback', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ user_email: 'jane@example.com' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ok: 1 }]);
    const repository = createRepository(query);

    await expect(repository.getEligibility(7)).resolves.toEqual({
      validated: true,
      eligible: false,
      reason: 'HAS_ACTIVE_SUBSCRIPTION'
    });
    expect(query.mock.calls[4][1]).toEqual(['jane@example.com']);
  });

  test('treats a missing subscriptions table as no active subscription', async () => {
    const missingTable = Object.assign(new Error("Table 'wp_hsr_stripe_subscriptions' doesn't exist"), {
      code: 'ER_NO_SUCH_TABLE',
      errno: 1146
    });
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ user_email: 'jane@example.com' }])
      .mockRejectedValueOnce(missingTable);
    const repository = createRepository(query);

    await expect(repository.getEligibility(7)).resolves.toEqual({
      validated: true,
      eligible: true,
      reason: null
    });
  });

  test('throws when the database is not initialized', async () => {
    const repository = new OnboardingDiscountEligibilityRepository(null);

    await expect(repository.getEligibility(7)).rejects.toBeInstanceOf(HttpError);
    await expect(repository.getEligibility(7)).rejects.toMatchObject({ statusCode: 503 });
  });
});
