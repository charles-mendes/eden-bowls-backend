const { HttpError } = require('./http-error');
const { LARGE_PACK_THRESHOLD, MAX_LARGE_PACK_LIMIT, PERIOD_DAYS } = require('./simplified-consumption');

// Plan settings of a market (plan-settings): plan days and large-pack limit, the values the recommendation used
// from the market's plan product before they moved out of the catalog.
const PLAN_SETTINGS_MARKETS = ['BR', 'US'];
const PLAN_DAYS_INVALID = 'plan_days_invalid';
const LARGE_PACK_LIMIT_INVALID = 'large_pack_limit_invalid';

function wholeNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

// The recommendation only takes whole days above zero, so 28.5 is refused instead of silently becoming 30.
function parsePlanDays(value) {
  const days = wholeNumber(value);
  if (days == null || days <= 0) {
    throw new HttpError(422, 'Plan days must be a whole number greater than zero.', { code: PLAN_DAYS_INVALID });
  }
  return days;
}

function parseLargePackLimit(value) {
  const limit = wholeNumber(value);
  if (limit == null || limit < 1 || limit > MAX_LARGE_PACK_LIMIT) {
    throw new HttpError(422, `Large pack limit must be a whole number from 1 to ${MAX_LARGE_PACK_LIMIT}.`, {
      code: LARGE_PACK_LIMIT_INVALID
    });
  }
  return limit;
}

// Value stored from a legacy product meta: what the recommendation read from it, else the fallback.
function seedPlanDays(value) {
  const days = wholeNumber(value);
  return days != null && days > 0 ? days : PERIOD_DAYS;
}

function seedLargePackLimit(value) {
  const limit = wholeNumber(value);
  return limit != null && limit >= 1 && limit <= MAX_LARGE_PACK_LIMIT ? limit : LARGE_PACK_THRESHOLD;
}

module.exports = {
  LARGE_PACK_LIMIT_INVALID,
  PLAN_DAYS_INVALID,
  PLAN_SETTINGS_MARKETS,
  parseLargePackLimit,
  parsePlanDays,
  seedLargePackLimit,
  seedPlanDays
};
