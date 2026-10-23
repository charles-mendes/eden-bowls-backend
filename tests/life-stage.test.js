const { fullMonthsBetween, resolveLifeStage, resolveSizeClass } = require('../src/core/life-stage');
const { buildSizeClassSeedRows, normalizeBreedName } = require('../src/core/life-stage-seed');

function seededLimits(market = 'BR') {
  const limits = {};
  for (const row of buildSizeClassSeedRows().filter((item) => item.market === market)) {
    limits[row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  return limits;
}

const giants = new Map([[normalizeBreedName('Dogue Alemão'), 'giant'], [normalizeBreedName('Great Dane'), 'giant']]);
const today = new Date('2026-10-18T12:00:00Z');

// A dog registered today with the given age in months.
function stageAt(size, months, extra = {}) {
  return resolveLifeStage(
    { size, age_years: Math.floor(months / 12), age_months: months % 12, age_recorded_at: '2026-10-18 09:00:00', ...extra },
    { limits: seededLimits(), breedClasses: giants, now: today }
  ).lifeStage;
}

describe('life stage thresholds (L-01)', () => {
  test('small dog becomes adult at 10 months', () => {
    expect(stageAt('small', 9)).toBe('puppy');
    expect(stageAt('small', 10)).toBe('adult');
  });

  test('medium dog becomes senior at 8 years', () => {
    expect(stageAt('medium', 95)).toBe('adult');
    expect(stageAt('medium', 96)).toBe('senior');
  });

  test('large dog outside the giant list', () => {
    expect(stageAt('large', 14, { breed: 'Labrador Retriever' })).toBe('puppy');
    expect(stageAt('large', 84, { breed: 'Labrador Retriever' })).toBe('senior');
  });

  test('giant dog thresholds', () => {
    expect(stageAt('large', 17, { breed: 'Great Dane' })).toBe('puppy');
    expect(stageAt('large', 18, { breed: 'Great Dane' })).toBe('adult');
    expect(stageAt('large', 72, { breed: 'Great Dane' })).toBe('senior');
  });
});

describe('size class from breed and size', () => {
  test('giant by Portuguese or English name, ignoring case, accents and spaces', () => {
    expect(resolveSizeClass({ breed: ' dogue alemão ', size: 'large' }, giants)).toBe('giant');
    expect(resolveSizeClass({ breed: 'GREAT DANE', size: 'large' }, giants)).toBe('giant');
  });

  test('breed outside the list uses size, and a missing size uses medium', () => {
    expect(resolveSizeClass({ breed: 'Labrador Retriever', size: 'large' }, giants)).toBe('large');
    expect(resolveSizeClass({ breed: 'Labrador Retriever', size: '' }, giants)).toBe('medium');
    expect(resolveSizeClass({ breed: '', size: 'unknown' }, giants)).toBe('medium');
  });
});

describe('age advances from the registration date (L-02, L-03)', () => {
  const limits = seededLimits();

  test('a puppy becomes adult with time, with no change to the record', () => {
    const pet = { size: 'medium', age_years: 0, age_months: 5, age_recorded_at: '2026-10-18 09:00:00' };
    expect(resolveLifeStage(pet, { limits, now: new Date('2027-05-17T12:00:00Z') })).toMatchObject({ lifeStage: 'puppy', currentAgeMonths: 11 });
    expect(resolveLifeStage(pet, { limits, now: new Date('2027-05-18T12:00:00Z') })).toMatchObject({ lifeStage: 'adult', currentAgeYears: 1, currentAgeMonths: 0 });
  });

  test('whole years mean 0 months in the month of registration', () => {
    const pet = { size: 'medium', age_years: 1, age_months: 0, age_recorded_at: '2026-10-18 09:00:00' };
    expect(resolveLifeStage(pet, { limits, now: today })).toMatchObject({ lifeStage: 'adult', currentAgeYears: 1, currentAgeMonths: 0 });
  });

  test('next stage dates for a puppy and an adult, and null for a senior', () => {
    const puppy = { size: 'medium', age_months: 5, age_recorded_at: '2026-10-18 09:00:00' };
    const adult = { size: 'medium', age_years: 1, age_recorded_at: '2026-10-18 09:00:00' };
    const senior = { size: 'medium', age_years: 9, age_recorded_at: '2026-10-18 09:00:00' };
    expect(resolveLifeStage(puppy, { limits, now: today }).lifeStageNextAt).toBe('2027-05-18');
    expect(resolveLifeStage(adult, { limits, now: today }).lifeStageNextAt).toBe('2033-10-18');
    expect(resolveLifeStage(senior, { limits, now: today })).toMatchObject({ lifeStage: 'senior', lifeStageNextAt: null });
  });

  test('a birth date takes precedence over the registered age', () => {
    const pet = { size: 'medium', age_years: 1, age_recorded_at: '2026-10-18 09:00:00', birth_date: '2021-07-10' };
    expect(resolveLifeStage(pet, { limits, now: today })).toMatchObject({ lifeStage: 'adult', currentAgeYears: 5, currentAgeMonths: 3 });
  });

  test('counts only whole calendar months, clamping month ends', () => {
    expect(fullMonthsBetween(new Date('2026-10-18T00:00:00Z'), new Date('2027-05-17T23:00:00Z'))).toBe(6);
    expect(fullMonthsBetween(new Date('2026-01-31T00:00:00Z'), new Date('2026-02-28T00:00:00Z'))).toBe(1);
  });

  test('no stage without limits for the size class', () => {
    expect(resolveLifeStage({ size: 'medium', age_years: 2 }, { limits: {}, now: today }).lifeStage).toBeNull();
  });
});
