const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const querySchema = z.object({
  status: z.string().trim().max(32).optional(),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  search: z.string().trim().max(120).optional()
}).passthrough();

// `to` is the last day of the period, inclusive.
function parseNfeListQuery(query = {}) {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    throw new HttpError(422, 'Invalid NF-e filters.', { code: 'invalid_nfe_filters' });
  }
  const { status, from, to, search } = parsed.data;
  const end = to ? new Date(`${to}T00:00:00Z`) : null;
  if (end) end.setUTCDate(end.getUTCDate() + 1);
  return {
    status: status || undefined,
    from: from ? new Date(`${from}T00:00:00Z`) : undefined,
    to: end || undefined,
    search: search || undefined
  };
}

module.exports = {
  parseNfeListQuery
};
