const { OnboardingPetsRepository } = require('../src/infrastructure/repositories/onboarding-pets.repository');

describe('OnboardingPetsRepository', () => {
  test('filters active pets by the authenticated user in SQL', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([
        {
          id: 'pet-1',
          name: 'Milo',
          breed: 'Labrador',
          age_years: 2,
          age_months: 0,
          weight_input: 10,
          weight_unit: 'kg',
          size: 'large',
          activity_level: 'high',
          pet_condition: 'ideal',
          neutered: 1,
          image_url: null
        }
      ])
    };
    const repository = new OnboardingPetsRepository(dataSource);

    await expect(repository.listPets(7)).resolves.toEqual({
      pets: [expect.objectContaining({ id: 'pet-1', name: 'Milo', neutered: true })]
    });
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE `user_id` = ? AND `deleted_at` IS NULL'),
      [7]
    );
  });
});