const { HttpError } = require('./http-error');
const { SIZE_CLASSES, normalizeBreedName } = require('./life-stage-seed');

const LIFE_STAGE_LIMITS_INVALID = 'life_stage_limits_invalid';
const LIFE_STAGE_BREED_INVALID = 'life_stage_breed_invalid';
const MONTHS_RANGE = { min: 1, max: 240 };
const MAX_BREED_LENGTH = 120;

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function monthsOf(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(number) && number >= MONTHS_RANGE.min && number <= MONTHS_RANGE.max ? number : null;
}

/**
 * Stage limits from a request, `{ <size_class>: { adult_from_months, senior_from_months } }` for one or more
 * size classes, or 422 `life_stage_limits_invalid` listing every invalid field. Both months go from 1 to 240
 * and senior must be greater than adult (nutrition-parameters).
 */
function parseLifeStageLimits(input) {
  const source = objectOf(input);
  const invalid = [];
  const limits = {};
  const keys = Object.keys(source);
  if (keys.length === 0) {
    invalid.push('limits');
  }
  for (const key of keys) {
    if (!SIZE_CLASSES.includes(key)) {
      invalid.push(key);
      continue;
    }
    const row = objectOf(source[key]);
    const adult = monthsOf(row.adult_from_months);
    const senior = monthsOf(row.senior_from_months);
    if (adult === null) invalid.push(`${key}.adult_from_months`);
    if (senior === null) invalid.push(`${key}.senior_from_months`);
    if (adult !== null && senior !== null && senior <= adult) invalid.push(`${key}.senior_from_months`);
    limits[key] = { adultFromMonths: adult, seniorFromMonths: senior };
  }
  if (invalid.length) {
    const fields = [...new Set(invalid)];
    throw new HttpError(422, `Invalid life-stage limits: ${fields.join(', ')}.`, { code: LIFE_STAGE_LIMITS_INVALID, fields });
  }
  return limits;
}

function nameOf(value) {
  const text = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  return text && text.length <= MAX_BREED_LENGTH ? text : null;
}

/**
 * A breed of `life_stage_breeds` from a request, with both names normalized as the evaluation reads them, or
 * 422 `life_stage_breed_invalid`. `partial` accepts only the fields sent (an edit or a deactivation).
 */
function parseLifeStageBreed(input, { partial = false } = {}) {
  const source = objectOf(input);
  const invalid = [];
  const breed = {};
  for (const [field, key] of [['name_pt', 'namePt'], ['name_en', 'nameEn']]) {
    if (partial && source[field] === undefined) continue;
    const name = nameOf(source[field]);
    if (!name || !normalizeBreedName(name)) {
      invalid.push(field);
      continue;
    }
    breed[key] = name;
    breed[`${key}Normalized`] = normalizeBreedName(name);
  }
  if (!partial || source.size_class !== undefined) {
    if (SIZE_CLASSES.includes(source.size_class)) {
      breed.sizeClass = source.size_class;
    } else {
      invalid.push('size_class');
    }
  }
  if (source.active !== undefined) {
    if (typeof source.active === 'boolean') {
      breed.active = source.active;
    } else {
      invalid.push('active');
    }
  } else if (!partial) {
    breed.active = true;
  }
  if (partial && Object.keys(breed).length === 0 && invalid.length === 0) {
    invalid.push('breed');
  }
  if (invalid.length) {
    throw new HttpError(422, `Invalid life-stage breed: ${invalid.join(', ')}.`, { code: LIFE_STAGE_BREED_INVALID, fields: invalid });
  }
  return breed;
}

module.exports = {
  LIFE_STAGE_BREED_INVALID,
  LIFE_STAGE_LIMITS_INVALID,
  MONTHS_RANGE,
  parseLifeStageBreed,
  parseLifeStageLimits
};
