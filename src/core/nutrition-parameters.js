const { HttpError } = require('./http-error');
const { DEFAULT_NUTRITION_PARAMETERS, normalizeText } = require('./nutrition-recommendation');

const NUTRITION_PARAMETERS_INVALID = 'nutrition_parameters_invalid';
const FACTOR_RANGE = { min: 1, max: 400 };
const NEM_RANGE = { min: 1000, max: 8000 };
const FACTOR_SECTIONS = ['combination', 'state', 'base'];
const BREED_GROUPS = ['dogue', 'slow_metabolism', 'terranova'];
const MAX_BREED_LENGTH = 80;

function numberIn(value, range) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= range.min && number <= range.max
    ? Math.round(number * 100) / 100
    : null;
}

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * A parameter set from a request with exactly the keys of the published one (nutrition-parameters), or 422
 * `nutrition_parameters_invalid` listing every invalid field. Factors go from 1 to 400 and NEM from 1000 to
 * 8000; breeds are normalized and a breed may sit in one energy group only (`breed_groups.<group>:<breed>`).
 */
function parseNutritionParameters(input) {
  const source = objectOf(input);
  const invalid = [];
  const parameters = {};

  for (const section of FACTOR_SECTIONS) {
    const values = objectOf(source[section]);
    parameters[section] = {};
    for (const key of Object.keys(DEFAULT_NUTRITION_PARAMETERS[section])) {
      const value = numberIn(values[key], FACTOR_RANGE);
      if (value === null) invalid.push(`${section}.${key}`);
      parameters[section][key] = value;
    }
  }

  const nem = objectOf(source.nem);
  parameters.nem = {};
  for (const key of Object.keys(DEFAULT_NUTRITION_PARAMETERS.nem)) {
    const value = numberIn(nem[key], NEM_RANGE);
    if (value === null) invalid.push(`nem.${key}`);
    parameters.nem[key] = value;
  }

  const groups = objectOf(source.breed_groups);
  const groupOf = new Map();
  parameters.breed_groups = {};
  for (const group of BREED_GROUPS) {
    const list = groups[group];
    if (!Array.isArray(list)) {
      invalid.push(`breed_groups.${group}`);
      parameters.breed_groups[group] = [];
      continue;
    }
    const breeds = [];
    for (const item of list) {
      const breed = normalizeText(item);
      if (!breed || breed.length > MAX_BREED_LENGTH) {
        invalid.push(`breed_groups.${group}`);
        continue;
      }
      if (breeds.includes(breed)) continue;
      const other = groupOf.get(breed);
      if (other) {
        invalid.push(`breed_groups.${group}:${breed}`);
        continue;
      }
      groupOf.set(breed, group);
      breeds.push(breed);
    }
    parameters.breed_groups[group] = breeds;
  }

  if (invalid.length) {
    const fields = [...new Set(invalid)];
    throw new HttpError(422, `Invalid nutrition parameters: ${fields.join(', ')}.`, { code: NUTRITION_PARAMETERS_INVALID, fields });
  }
  return parameters;
}

module.exports = {
  BREED_GROUPS,
  FACTOR_RANGE,
  NEM_RANGE,
  NUTRITION_PARAMETERS_INVALID,
  parseNutritionParameters
};
