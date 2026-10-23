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

  test('reads the age reference and birth date of each pet', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([
        { id: 'pet-1', name: 'Luna', age_years: 0, age_months: 5, weight_unit: 'kg', age_recorded_at: new Date('2026-10-18T09:00:00Z'), birth_date: null },
        { id: 'pet-2', name: 'Thor', age_years: 5, age_months: 0, weight_unit: 'kg', age_recorded_at: '2026-03-01 10:00:00', birth_date: new Date('2021-07-10T00:00:00Z') }
      ])
    };

    const result = await new OnboardingPetsRepository(dataSource).listPets(7);

    expect(dataSource.query.mock.calls[0][0]).toContain('`age_recorded_at`, `birth_date`');
    expect(result.pets.map((pet) => [pet.age_recorded_at, pet.birth_date])).toEqual([
      ['2026-10-18T09:00:00.000Z', null],
      ['2026-03-01T10:00:00.000Z', '2021-07-10']
    ]);
  });
});
