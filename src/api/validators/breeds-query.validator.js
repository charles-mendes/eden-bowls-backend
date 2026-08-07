const { z } = require('zod');

const rawBreedsQuerySchema = z
  .object({
    search: z.union([z.string(), z.number()]).optional(),
    lang: z.union([z.string(), z.number()]).optional(),
    limit: z.union([z.string(), z.number()]).optional()
  })
  .strip();

function sanitizeText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
}

function normalizeLang(value) {
  return String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'pt';
}

function normalizeLimit(value) {
  const parsedLimit = Number(value);

  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return 10;
  }

  return Math.max(1, Math.min(500, Math.trunc(parsedLimit)));
}

function parseBreedsQuery(input) {
  const parsed = rawBreedsQuerySchema.parse(input || {});

  return {
    search: sanitizeText(parsed.search),
    lang: normalizeLang(parsed.lang),
    limit: normalizeLimit(parsed.limit)
  };
}

module.exports = {
  parseBreedsQuery,
  sanitizeText,
  normalizeLang,
  normalizeLimit
};