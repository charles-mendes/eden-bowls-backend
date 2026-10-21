const { OnboardingPetUpdateService } = require('../src/services/onboarding-pets-update.service');
const { OnboardingPetCreateRepository } = require('../src/infrastructure/repositories/onboarding-pets-create.repository');
const { parseOnboardingPetUpdateInput } = require('../src/api/validators/onboarding-pets-update.validator');
const { parseOnboardingPetCreateInput } = require('../src/api/validators/onboarding-pets-create.validator');
const { parseOnboardingPetsSyncInput } = require('../src/api/validators/onboarding-pets-sync.validator');
const { MARKETS } = require('../src/core/market');

const NOW = new Date('2026-11-02T15:00:00Z');

function storedPet(overrides = {}) {
  return {
    id: 'pet-1',
    name: 'Luna',
    breed: '',
    size: 'medium',
    age_years: 0,
    age_months: 5,
    weight_input: 8,
    weight_unit: 'kg',
    age_recorded_at: '2026-10-18T09:00:00.000Z',
    birth_date: null,
    ...overrides
  };
}

function serviceFor(current) {
  const repository = {
    findPet: jest.fn().mockResolvedValue(current),
    updatePet: jest.fn(async (_userId, _petId, update) => ({ ...current, ...update }))
  };
  const ageChangesRepository = { record: jest.fn() };
  const lifeStageService = { resolve: jest.fn(async (pet) => ({ lifeStage: Number(pet.age_years) >= 8 ? 'senior' : (Number(pet.age_years) >= 1 ? 'adult' : 'puppy') })) };
  const service = new OnboardingPetUpdateService(repository, { ageChangesRepository, lifeStageService, now: () => NOW });
  return { service, repository, ageChangesRepository };
}

describe('birth date input', () => {
  test('create, update and sync accept an optional birth date and clear it with an empty value', () => {
    expect(parseOnboardingPetCreateInput({ name: 'Luna', birth_date: '2021-07-10' }, MARKETS.BR).birth_date).toBe('2021-07-10');
    expect(parseOnboardingPetCreateInput({ name: 'Luna' }, MARKETS.BR).birth_date).toBeNull();
    expect(parseOnboardingPetUpdateInput({ birth_date: '', change_source: 'dashboard' }).birth_date).toBeNull();
    expect(parseOnboardingPetUpdateInput({ name: 'Luna', change_source: 'onboarding' })).not.toHaveProperty('birth_date');
    expect(parseOnboardingPetsSyncInput({ pets: [{ local_id: 'l-1', name: 'Luna', birth_date: '2021-07-10' }] }).pets[0].birth_date).toBe('2021-07-10');
  });

  test('rejects an impossible date', () => {
    expect(() => parseOnboardingPetUpdateInput({ birth_date: '2021-02-30', change_source: 'dashboard' })).toThrow();
    expect(() => parseOnboardingPetUpdateInput({ birth_date: '10/07/2021', change_source: 'dashboard' })).toThrow();
  });
});

describe('sync keeps the age of an existing pet', () => {
  test('the upsert writes age and birth date only for a new row', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockResolvedValue([]) };
    await new OnboardingPetCreateRepository(dataSource).syncPets(7, [{ pet_id: 'pet-1', name: 'Luna', age_years: 0, age_months: 9, birth_date: '2026-01-10' }]);

    const [sql, params] = dataSource.query.mock.calls[0];
    const [insert, update] = sql.split('ON DUPLICATE KEY UPDATE');
    expect(insert).toContain('`age_years`, `age_months`');
    expect(insert).toContain('`birth_date`');
    expect(params).toEqual(expect.arrayContaining([9, '2026-01-10']));
    expect(update).not.toMatch(/age_years|age_months|birth_date|age_recorded_at/);
    expect(update).toContain('`name` = VALUES(`name`)');
  });
});

describe('PATCH age change', () => {
  test('a new age moves age_recorded_at and writes one history row', async () => {
    const { service, repository, ageChangesRepository } = serviceFor(storedPet());

    await service.updatePet({ userId: 7, petId: 'pet-1', payload: { age_years: 0, age_months: 6, change_source: 'dashboard' }, market: MARKETS.BR });

    expect(repository.updatePet).toHaveBeenCalledWith(7, 'pet-1', { age_years: 0, age_months: 6, age_recorded_at: NOW });
    expect(ageChangesRepository.record).toHaveBeenCalledTimes(1);
    expect(ageChangesRepository.record.mock.calls[0][0]).toMatchObject({
      petId: 'pet-1', userId: 7, oldAgeMonths: 5, newAgeMonths: 6, oldLifeStage: 'puppy', newLifeStage: 'puppy', source: 'dashboard'
    });
  });

  test('the same age keeps age_recorded_at and writes no history', async () => {
    const { service, repository, ageChangesRepository } = serviceFor(storedPet());

    await service.updatePet({ userId: 7, petId: 'pet-1', payload: { age_years: 0, age_months: 5, name: 'Lua' }, market: MARKETS.BR });

    expect(repository.updatePet.mock.calls[0][2]).not.toHaveProperty('age_recorded_at');
    expect(ageChangesRepository.record).not.toHaveBeenCalled();
  });

  test('a birth date change is recorded without moving age_recorded_at, with the source sent', async () => {
    const { service, repository, ageChangesRepository } = serviceFor(storedPet({ age_years: 5, age_months: 0 }));

    await service.updatePet({ userId: 7, petId: 'pet-1', payload: { birth_date: '2021-07-10', change_source: 'onboarding' }, market: MARKETS.BR });

    expect(repository.updatePet.mock.calls[0][2]).toEqual({ birth_date: '2021-07-10' });
    expect(ageChangesRepository.record.mock.calls[0][0]).toMatchObject({ oldBirthDate: null, newBirthDate: '2021-07-10', source: 'onboarding' });
  });

  test('a change that does not touch the age reads nothing extra', async () => {
    const { service, repository, ageChangesRepository } = serviceFor(storedPet());

    await service.updatePet({ userId: 7, petId: 'pet-1', payload: { name: 'Lua' }, market: MARKETS.BR });

    expect(repository.findPet).not.toHaveBeenCalled();
    expect(ageChangesRepository.record).not.toHaveBeenCalled();
  });
});
