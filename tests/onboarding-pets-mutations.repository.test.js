const { OnboardingPetUpdateRepository } = require('../src/infrastructure/repositories/onboarding-pets-update.repository');
const { OnboardingPetDeleteRepository } = require('../src/infrastructure/repositories/onboarding-pets-delete.repository');

describe('user-owned pet mutation repositories', () => {
  test('updates only the active pet belonging to the authenticated user', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest
        .fn()
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([{ id: 'pet-1', name: 'Luna', breed: 'Mixed', age_years: 3, age_months: 0, weight_input: 12, weight_unit: 'kg', size: 'medium', activity_level: 'high', pet_condition: 'ideal', neutered: 1, image_url: null }])
    };
    const repository = new OnboardingPetUpdateRepository(dataSource);

    const pet = await repository.updatePet(7, 'pet-1', { name: 'Luna', weight: 12 });

    expect(pet).toEqual(expect.objectContaining({ id: 'pet-1', name: 'Luna', weight: 12 }));
    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE `id` = ? AND `user_id` = ? AND `deleted_at` IS NULL'),
      ['Luna', 12, 'pet-1', 7]
    );
  });

  test('soft deletes only the active pet belonging to the authenticated user', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 1 }) };
    const repository = new OnboardingPetDeleteRepository(dataSource);

    const result = await repository.deletePet(7, 'pet-1', '2026-08-13T00:00:00.000Z');

    expect(result.removed_pet).toEqual(expect.objectContaining({ id: 'pet-1', deleted_by_user_id: 7 }));
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE `id` = ? AND `user_id` = ? AND `deleted_at` IS NULL'),
      ['2026-08-13T00:00:00.000Z', 'pet-1', 7]
    );
  });

  test('returns null when a foreign or missing pet cannot be mutated', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 0 }) };
    const repository = new OnboardingPetDeleteRepository(dataSource);

    await expect(repository.deletePet(7, 'foreign-pet', '2026-08-13T00:00:00.000Z')).resolves.toBeNull();
  });

  test('returns null when a foreign or missing pet cannot be updated', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue({ affectedRows: 0 }) };
    const repository = new OnboardingPetUpdateRepository(dataSource);

    await expect(repository.updatePet(7, 'foreign-pet', { name: 'Luna' })).resolves.toBeNull();
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE `id` = ? AND `user_id` = ? AND `deleted_at` IS NULL'),
      ['Luna', 'foreign-pet', 7]
    );
  });
});
