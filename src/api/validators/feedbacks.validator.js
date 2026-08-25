const { z } = require('zod');
const { HttpError } = require('../../core/http-error');
const { parsePageQuery } = require('./admin-pagination');
const {
  FEEDBACK_CATEGORIES,
  FEEDBACK_COUNTRIES,
  normalizeFeedbackCategory,
  normalizeFeedbackCountry,
  parseBooleanQuery
} = require('../../core/feedbacks');

const photoSchema = z.object({
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  imageBase64: z.string().min(1)
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(191),
  category: z.string().trim().min(1),
  country: z.string().trim().min(1),
  place: z.string().trim().min(1).max(191),
  comment: z.string().trim().min(1).max(4000),
  active: z.boolean().optional().default(true),
  photo: photoSchema.nullable().optional()
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(191).optional(),
  category: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
  place: z.string().trim().min(1).max(191).optional(),
  comment: z.string().trim().min(1).max(4000).optional(),
  active: z.boolean().optional(),
  photo: photoSchema.nullable().optional()
});

const activeSchema = z.object({
  active: z.boolean()
});

function parseOrThrow(schema, input, message) {
  const parsed = schema.safeParse(input || {});
  if (!parsed.success) {
    throw new HttpError(400, message, parsed.error.issues);
  }
  return parsed.data;
}

function assertCategory(value) {
  const category = normalizeFeedbackCategory(value);
  if (!category) {
    throw new HttpError(400, 'Invalid category.', { code: 'invalid_category' });
  }
  return category;
}

function assertCountry(value) {
  const country = normalizeFeedbackCountry(value);
  if (!country) {
    throw new HttpError(400, 'Invalid country.', { code: 'invalid_country' });
  }
  return country;
}

function parseFeedbackId(value) {
  const id = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new HttpError(400, 'Invalid feedback id.', { code: 'invalid_id' });
  }
  return id;
}

function parseFeedbackListQuery(query = {}) {
  const pagination = parsePageQuery(query);
  const countryRaw = query.country;
  const country = countryRaw === undefined || countryRaw === null || countryRaw === ''
    ? undefined
    : assertCountry(countryRaw);

  const active = parseBooleanQuery(query.active);
  if (query.active !== undefined && query.active !== null && query.active !== '' && typeof active !== 'boolean') {
    throw new HttpError(400, 'Invalid status filter.', { code: 'invalid_active' });
  }

  return {
    ...pagination,
    country,
    active,
    search: String(query.search || query.name || '').trim()
  };
}

function parsePublicFeedbackQuery(query = {}) {
  const country = assertCountry(query.country);
  return { country };
}

function parseCreateFeedbackInput(input = {}) {
  const data = parseOrThrow(createSchema, input, 'Invalid request payload.');
  return {
    ...data,
    category: assertCategory(data.category),
    country: assertCountry(data.country),
    photo: data.photo === undefined ? undefined : data.photo
  };
}

function parseUpdateFeedbackInput(input = {}) {
  const data = parseOrThrow(updateSchema, input, 'Invalid request payload.');
  if (data.category !== undefined) {
    data.category = assertCategory(data.category);
  }
  if (data.country !== undefined) {
    data.country = assertCountry(data.country);
  }
  return data;
}

function parseFeedbackActiveInput(input = {}) {
  return parseOrThrow(activeSchema, input, 'Invalid request payload.').active;
}

module.exports = {
  FEEDBACK_CATEGORIES,
  FEEDBACK_COUNTRIES,
  parseCreateFeedbackInput,
  parseFeedbackActiveInput,
  parseFeedbackId,
  parseFeedbackListQuery,
  parsePublicFeedbackQuery,
  parseUpdateFeedbackInput
};
