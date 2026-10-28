const { LifeStageSettingsService } = require('../src/services/life-stage-settings.service');

const SIZE_CLASSES = [
  { sizeClass: 'small', adultFromMonths: 10, seniorFromMonths: 120 },
  { sizeClass: 'medium', adultFromMonths: 12, seniorFromMonths: 96 },
  { sizeClass: 'large', adultFromMonths: 15, seniorFromMonths: 84 },
  { sizeClass: 'giant', adultFromMonths: 18, seniorFromMonths: 72 }
];
const GREAT_DANE = {
  id: 4, market: 'BR', namePt: 'Dogue Alemão', nameEn: 'Great Dane',
  namePtNormalized: 'dogue alemao', nameEnNormalized: 'great dane', sizeClass: 'giant', active: true
};

function setup({ pets = [] } = {}) {
  const repository = {
    listMarket: jest.fn().mockResolvedValue({ market: 'BR', sizeClasses: SIZE_CLASSES, breeds: [GREAT_DANE] }),
    saveLimits: jest.fn(),
    findBreed: jest.fn(async (id) => (id === GREAT_DANE.id ? GREAT_DANE : null)),
    createBreed: jest.fn(async (market, breed) => ({ id: 9, market, ...breed })),
    updateBreed: jest.fn(async (id, changes) => ({ ...GREAT_DANE, ...changes })),
    listSubscribedPets: jest.fn().mockResolvedValue(pets)
  };
  const auditRepository = { createIn: jest.fn() };
  const service = new LifeStageSettingsService({
    repository,
    auditRepository,
    dataSource: { transaction: async (work) => work({ tx: true }) },
    now: () => new Date('2026-10-27T12:00:00Z')
  });
  return { service, repository, auditRepository };
}

const vet = { userId: '5', email: 'vet@edenbowls.com' };
const dog = (id, months, extra = {}) => ({ id: String(id), breed: '', size: 'medium', age_years: Math.floor(months / 12), age_months: months % 12, age_recorded_at: '2026-10-27T09:00:00.000Z', birth_date: null, ...extra });

describe('LifeStageSettingsService', () => {
  test('Invalid limits: senior below adult answers 422 and stores nothing', async () => {
    const { service, repository, auditRepository } = setup();

    await expect(service.updateLimits('BR', { small: { adult_from_months: 120, senior_from_months: 100 } }, vet)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'life_stage_limits_invalid', fields: ['small.senior_from_months'] }
    });
    expect(repository.saveLimits).not.toHaveBeenCalled();
    expect(auditRepository.createIn).not.toHaveBeenCalled();
  });

  test('refuses months outside 1 to 240 and unknown size classes', async () => {
    const { service } = setup();
    await expect(service.updateLimits('BR', { medium: { adult_from_months: 0, senior_from_months: 241 }, tiny: {} }, vet)).rejects.toMatchObject({
      details: { fields: ['medium.adult_from_months', 'medium.senior_from_months', 'tiny'] }
    });
    await expect(service.updateLimits('BR', {}, vet)).rejects.toMatchObject({ statusCode: 422 });
  });

  test('saving limits records life_stage.limits.update with the values before and after', async () => {
    const { service, repository, auditRepository } = setup();

    await service.updateLimits('BR', { medium: { adult_from_months: 12, senior_from_months: 84 } }, vet);

    expect(repository.saveLimits).toHaveBeenCalledWith('BR', { medium: { adultFromMonths: 12, seniorFromMonths: 84 } }, 5, { tx: true });
    expect(auditRepository.createIn).toHaveBeenCalledWith({ tx: true }, {
      actorUserId: 5,
      actorEmail: 'vet@edenbowls.com',
      action: 'life_stage.limits.update',
      metadata: {
        market: 'BR',
        before: { medium: { adultFromMonths: 12, seniorFromMonths: 96 } },
        after: { medium: { adultFromMonths: 12, seniorFromMonths: 84 } }
      }
    });
  });

  test('adds and deactivates a breed, recording life_stage.breed.update', async () => {
    const { service, repository, auditRepository } = setup();

    await service.createBreed('BR', { name_pt: ' Mastim  Napolitano ', name_en: 'Neapolitan Mastiff', size_class: 'giant' }, vet);
    expect(repository.createBreed).toHaveBeenCalledWith('BR', {
      namePt: 'Mastim Napolitano', namePtNormalized: 'mastim napolitano',
      nameEn: 'Neapolitan Mastiff', nameEnNormalized: 'neapolitan mastiff',
      sizeClass: 'giant', active: true
    }, 5, { tx: true });

    await service.updateBreed('BR', 4, { active: false }, vet);
    expect(repository.updateBreed).toHaveBeenCalledWith(4, { active: false }, 5, { tx: true });
    expect(auditRepository.createIn.mock.calls.map(([, event]) => event.action)).toEqual(['life_stage.breed.update', 'life_stage.breed.update']);
    expect(auditRepository.createIn.mock.calls[1][1].metadata).toMatchObject({ market: 'BR', breed_id: 4, before: { active: true }, after: { active: false } });
  });

  test('a breed of another market or an invalid size class is refused', async () => {
    const { service, repository } = setup();
    await expect(service.updateBreed('US', 4, { active: false }, vet)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.createBreed('BR', { name_pt: 'X', name_en: 'Y', size_class: 'huge' }, vet)).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'life_stage_breed_invalid', fields: ['size_class'] }
    });
    expect(repository.updateBreed).not.toHaveBeenCalled();
  });

  test('Preview before lowering the senior age: counts the BR pets that would become senior and writes nothing', async () => {
    const pets = [dog(1, 90), dog(2, 85), dog(3, 60), dog(4, 100), dog(5, 90, { breed: 'Great Dane', size: 'large' })];
    const { service, repository, auditRepository } = setup({ pets });

    const result = await service.preview('BR', 'br', { limits: { medium: { adult_from_months: 12, senior_from_months: 84 } } });

    expect(result).toEqual({
      market: 'BR',
      pets_evaluated: 5,
      pets_changing: 2,
      transitions: [{ from: 'adult', to: 'senior', count: 2 }]
    });
    expect(repository.listSubscribedPets).toHaveBeenCalledWith('br');
    expect(repository.saveLimits).not.toHaveBeenCalled();
    expect(auditRepository.createIn).not.toHaveBeenCalled();
  });

  test('previewing a breed moved out of giant counts the change of its dogs', async () => {
    const pets = [dog(1, 80, { breed: 'Dogue Alemão', size: 'large' })];
    const { service } = setup({ pets });

    const result = await service.preview('BR', 'br', { breed: { id: 4, size_class: 'large' } });

    expect(result.transitions).toEqual([{ from: 'senior', to: 'adult', count: 1 }]);
  });

  test('a preview with invalid limits answers 422 before reading the pets', async () => {
    const { service, repository } = setup();
    await expect(service.preview('BR', 'br', { limits: { small: { adult_from_months: 120, senior_from_months: 100 } } })).rejects.toMatchObject({ statusCode: 422 });
    expect(repository.listSubscribedPets).not.toHaveBeenCalled();
  });
});
