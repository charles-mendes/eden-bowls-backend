const { SIZE_CLASSES, normalizeBreedName } = require('./life-stage-seed');

// Calendar dates are compared in UTC, the timezone the database stores them in.
function toUtcDate(value) {
  if (value == null || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const text = String(value).trim();
  const isoLike = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z`
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z`
      : text;
  const date = new Date(isoLike);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addMonths(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

// Whole calendar months from `from` to `to`: 2026-10-18 to 2027-05-18 is 7, to 2027-05-17 is 6.
function fullMonthsBetween(from, to) {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (months > 0 && addMonths(from, months) > to) {
    months -= 1;
  }
  return Math.max(0, months);
}

function wholeNumber(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

// The age reference: the birth date when given, else the registered age at age_recorded_at (L-02, L-03).
function ageAnchor(pet) {
  const birthDate = toUtcDate(pet.birth_date ?? pet.birthDate);
  if (birthDate) {
    return { date: birthDate, monthsAtDate: 0 };
  }
  const recordedAt = toUtcDate(pet.age_recorded_at ?? pet.ageRecordedAt) || new Date();
  const recordedDay = new Date(Date.UTC(recordedAt.getUTCFullYear(), recordedAt.getUTCMonth(), recordedAt.getUTCDate()));
  const registered = wholeNumber(pet.age_years ?? pet.ageYears) * 12 + wholeNumber(pet.age_months ?? pet.ageMonths);
  return { date: recordedDay, monthsAtDate: registered };
}

function currentAgeMonths(pet, now = new Date()) {
  const anchor = ageAnchor(pet);
  return anchor.monthsAtDate + fullMonthsBetween(anchor.date, now);
}

function resolveSizeClass(pet, breedClasses = new Map()) {
  const breed = normalizeBreedName(pet.breed);
  if (breed && breedClasses.has(breed)) {
    return breedClasses.get(breed);
  }
  const size = String(pet.size || '').trim().toLowerCase();
  return SIZE_CLASSES.includes(size) && size !== 'giant' ? size : 'medium';
}

// Resolves the stage of one dog with the limits of its market (decision 2 of the change design).
function resolveLifeStage(pet, { limits = {}, breedClasses = new Map(), now = new Date() } = {}) {
  const sizeClass = resolveSizeClass(pet, breedClasses);
  const limit = limits[sizeClass];
  const ageMonths = currentAgeMonths(pet, now);
  const age = {
    sizeClass,
    currentAgeYears: Math.floor(ageMonths / 12),
    currentAgeMonths: ageMonths % 12
  };
  if (!limit) {
    return { ...age, lifeStage: null, lifeStageNextAt: null };
  }

  let lifeStage = 'senior';
  let nextLimit = null;
  if (ageMonths < limit.adultFromMonths) {
    lifeStage = 'puppy';
    nextLimit = limit.adultFromMonths;
  } else if (ageMonths < limit.seniorFromMonths) {
    lifeStage = 'adult';
    nextLimit = limit.seniorFromMonths;
  }

  const anchor = ageAnchor(pet);
  const lifeStageNextAt = nextLimit == null
    ? null
    : formatDate(addMonths(anchor.date, nextLimit - anchor.monthsAtDate));
  return { ...age, lifeStage, lifeStageNextAt };
}

module.exports = {
  addMonths,
  currentAgeMonths,
  fullMonthsBetween,
  resolveLifeStage,
  resolveSizeClass,
  toUtcDate
};
