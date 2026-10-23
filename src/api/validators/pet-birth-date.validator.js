const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const MAX_AGE_YEARS = 30;
const OUT_OF_RANGE_MESSAGES = {
  BR: {
    future: 'A data de nascimento não pode estar no futuro.',
    too_old: 'A data de nascimento não pode ser de mais de 30 anos atrás.'
  },
  US: {
    future: 'The birth date cannot be in the future.',
    too_old: 'The birth date cannot be more than 30 years ago.'
  }
};

// An optional calendar date (YYYY-MM-DD). An empty string or null clears it.
const birthDateSchema = z.union([
  z.string().trim().refine((value) => {
    if (value === '') {
      return true;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, { message: 'birth_date must be a valid date in YYYY-MM-DD format.' }),
  z.null()
]).optional();

function normalizeBirthDate(value) {
  if (value === undefined) {
    return undefined;
  }
  return value === null || value === '' ? null : value;
}

// A birth date after today or more than 30 years before today (UTC) is refused, in the market's language.
function assertBirthDateInRange(value, market, now = new Date()) {
  if (!value) {
    return;
  }
  const today = now.toISOString().slice(0, 10);
  const oldest = new Date(Date.UTC(now.getUTCFullYear() - MAX_AGE_YEARS, now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  const reason = value > today ? 'future' : (value < oldest ? 'too_old' : null);
  if (!reason) {
    return;
  }
  const messages = OUT_OF_RANGE_MESSAGES[market && market.country === 'BR' ? 'BR' : 'US'];
  throw new HttpError(422, messages[reason], { code: 'birth_date_out_of_range', reason });
}

module.exports = {
  assertBirthDateInRange,
  birthDateSchema,
  normalizeBirthDate
};
