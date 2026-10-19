const { z } = require('zod');

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

module.exports = {
  birthDateSchema,
  normalizeBirthDate
};
