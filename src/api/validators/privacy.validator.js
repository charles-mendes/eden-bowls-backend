const { z } = require('zod');
const { HttpError } = require('../../core/http-error');
const {
  REQUEST_TYPES,
  REQUEST_STATUSES,
  IDENTITY_STATUSES,
  REQUEST_CHANNELS
} = require('../../core/privacy');

function parseOrThrow(schema, input) {
  const parsed = schema.safeParse(input || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }
  return parsed.data;
}

const cookieSchema = z.object({
  analytics: z.enum(['granted', 'denied']),
  ads: z.enum(['granted', 'denied']).optional().default('denied'),
  source: z.enum(['banner', 'preferences', 'gpc', 'do_not_sell']).optional()
});

const marketingSchema = z.object({
  marketingOptIn: z.boolean()
});

const createRequestSchema = z.object({
  type: z.enum(REQUEST_TYPES),
  market: z.enum(['BR', 'US', 'com', 'com.br']).optional(),
  locale: z.string().trim().max(16).optional(),
  note: z.string().trim().max(2000).optional()
});

const adminCreateRequestSchema = z.object({
  type: z.enum(REQUEST_TYPES),
  userId: z.coerce.number().int().positive(),
  market: z.enum(['BR', 'US']).optional(),
  locale: z.string().trim().max(16).optional(),
  note: z.string().trim().max(2000).optional(),
  channel: z.enum(REQUEST_CHANNELS).optional().default('email')
});

const adminListQuerySchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
  identityStatus: z.enum(IDENTITY_STATUSES).optional(),
  overdue: z.enum(['true', 'false', '1', '0']).optional(),
  userId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional(),
  perPage: z.coerce.number().int().positive().optional()
});

const extendSchema = z.object({
  reason: z.string().trim().min(3).max(255)
});

const completeSchema = z.object({
  note: z.string().trim().max(2000).optional()
});

function parseCookieInput(input) {
  const data = parseOrThrow(cookieSchema, input);
  return {
    analytics: data.analytics,
    ads: 'denied',
    source: data.source || 'preferences'
  };
}

function parseMarketingInput(input) {
  return parseOrThrow(marketingSchema, input);
}

function parseCreateRequestInput(input) {
  return parseOrThrow(createRequestSchema, input);
}

function parseAdminCreateRequestInput(input) {
  return parseOrThrow(adminCreateRequestSchema, input);
}

function parseAdminListQuery(query) {
  const data = parseOrThrow(adminListQuerySchema, query);
  const overdueRaw = data.overdue;
  return {
    status: data.status,
    type: data.type,
    identityStatus: data.identityStatus,
    userId: data.userId,
    overdue: overdueRaw === undefined ? undefined : overdueRaw === 'true' || overdueRaw === '1',
    page: data.page,
    perPage: data.perPage
  };
}

function parseRequestId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, 'Invalid request id.', { code: 'invalid_request_id' });
  }
  return id;
}

function parseExtendInput(input) {
  return parseOrThrow(extendSchema, input);
}

function parseCompleteInput(input) {
  return parseOrThrow(completeSchema, input || {});
}

module.exports = {
  parseCookieInput,
  parseMarketingInput,
  parseCreateRequestInput,
  parseAdminCreateRequestInput,
  parseAdminListQuery,
  parseRequestId,
  parseExtendInput,
  parseCompleteInput
};
