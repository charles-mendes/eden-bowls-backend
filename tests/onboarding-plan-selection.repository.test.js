const { OnboardingPlanSelectionRepository } = require('../src/infrastructure/repositories/onboarding-plan-selection.repository');

describe('OnboardingPlanSelectionRepository', () => {
  test('upserts plan selection under the authenticated user id', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingPlanSelectionRepository(dataSource);
    const payload = { subscription_term_months: 3, pets: [{ pet_id: 'pet-1', enabled: true }] };

    const result = await repository.setPlanSelection(7, payload);

    expect(result.plan_selection).toEqual(expect.objectContaining({ subscription_term_months: 3 }));
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `onboarding_user_state` (`user_id`, `plan_selection`) VALUES (?, ?) ON DUPLICATE KEY UPDATE'),
      [7, expect.stringContaining('"subscription_term_months":3')]
    );
  });

  test('reads plan selection for the authenticated user', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{
        plan_selection: { pets: [{ pet_id: 'pet-1', pet_name: 'luna' }] }
      }])
    };
    const repository = new OnboardingPlanSelectionRepository(dataSource);

    await expect(repository.getPlanSelection(5)).resolves.toEqual({
      pets: [{ pet_id: 'pet-1', pet_name: 'luna' }]
    });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT `plan_selection` FROM `onboarding_user_state`'),
      [5]
    );
  });
});
