const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const WINDOW_DAYS = [7, 14, 30];
const PRODUCTION_STATUSES = ['to_prepare', 'in_production', 'ready', 'blocked'];

function parseBooleanQuery(value, defaultValue = true) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(raw)) {
    return true;
  }
  if (['0', 'false', 'no'].includes(raw)) {
    return false;
  }
  throw new HttpError(400, 'Invalid includeOverdue.', { code: 'invalid_include_overdue' });
}

const listQuerySchema = z.object({
  windowDays: z.union([z.string(), z.number()]).optional(),
  includeOverdue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  account: z.string().optional(),
  productionStatus: z.string().optional(),
  q: z.string().optional(),
  timezone: z.string().optional()
});

const patchBodySchema = z.object({
  status: z.enum(PRODUCTION_STATUSES),
  periodEnd: z.string().min(1),
  note: z.string().optional()
});

function parseProductionQueueQuery(query = {}) {
  const parsed = listQuerySchema.safeParse(query || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }

  const windowDays = parsed.data.windowDays == null || String(parsed.data.windowDays).trim() === ''
    ? 7
    : Number(parsed.data.windowDays);
  if (!WINDOW_DAYS.includes(windowDays)) {
    throw new HttpError(400, 'windowDays must be 7, 14, or 30.', { code: 'invalid_window_days' });
  }

  const productionStatus = String(parsed.data.productionStatus || '').trim();
  if (productionStatus && !PRODUCTION_STATUSES.includes(productionStatus)) {
    throw new HttpError(400, 'Invalid productionStatus.', { code: 'invalid_production_status' });
  }

  return {
    windowDays,
    includeOverdue: parseBooleanQuery(parsed.data.includeOverdue, true),
    account: parsed.data.account ? String(parsed.data.account).trim() : '',
    productionStatus: productionStatus || '',
    q: parsed.data.q ? String(parsed.data.q).trim() : '',
    timezone: parsed.data.timezone ? String(parsed.data.timezone).trim() : ''
  };
}

function parseProductionQueuePatch(body = {}) {
  const parsed = patchBodySchema.safeParse(body || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }

  const note = parsed.data.note == null ? undefined : String(parsed.data.note).trim();
  if (parsed.data.status === 'blocked' && (!note || note.length < 1 || note.length > 255)) {
    throw new HttpError(400, 'A note of 1 to 255 characters is required to block a cycle.', {
      code: 'production_block_note_required'
    });
  }
  if (note && note.length > 255) {
    throw new HttpError(400, 'Note must be at most 255 characters.', { code: 'invalid_production_note' });
  }

  return {
    status: parsed.data.status,
    periodEnd: parsed.data.periodEnd,
    note: note || null
  };
}

module.exports = {
  PRODUCTION_STATUSES,
  parseProductionQueueQuery,
  parseProductionQueuePatch
};
