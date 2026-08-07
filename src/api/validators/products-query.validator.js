const { z } = require('zod');
const { HttpError } = require('../../core/http-error');
const { PRODUCTS_ERROR } = require('../contracts/products-errors');

const rawProductsQuerySchema = z
  .object({
    category_slug: z.union([z.string(), z.number()]).optional(),
    country: z.union([z.string(), z.number()]).optional(),
    currency: z.union([z.string(), z.number()]).optional()
  })
  .strip();

const COUNTRY_TO_CURRENCY = {
  BR: 'BRL',
  US: 'USD'
};

function sanitizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_.\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
}

function toUpper(value) {
  return sanitizeText(value).toUpperCase();
}

function parseProductsQuery(input) {
  const parsed = rawProductsQuerySchema.parse(input || {});
  const categorySlug = sanitizeSlug(parsed.category_slug);
  const country = toUpper(parsed.country);
  const inputCurrency = toUpper(parsed.currency);

  if (!categorySlug) {
    throw new HttpError(PRODUCTS_ERROR.INVALID_CATEGORY_SLUG.status, PRODUCTS_ERROR.INVALID_CATEGORY_SLUG.message, {
      code: PRODUCTS_ERROR.INVALID_CATEGORY_SLUG.code
    });
  }

  if (!COUNTRY_TO_CURRENCY[country]) {
    throw new HttpError(PRODUCTS_ERROR.INVALID_COUNTRY.status, PRODUCTS_ERROR.INVALID_COUNTRY.message, {
      code: PRODUCTS_ERROR.INVALID_COUNTRY.code
    });
  }

  const currency = inputCurrency || COUNTRY_TO_CURRENCY[country];

  if (currency !== COUNTRY_TO_CURRENCY[country]) {
    throw new HttpError(
      PRODUCTS_ERROR.COUNTRY_CURRENCY_MISMATCH.status,
      PRODUCTS_ERROR.COUNTRY_CURRENCY_MISMATCH.message,
      {
        code: PRODUCTS_ERROR.COUNTRY_CURRENCY_MISMATCH.code
      }
    );
  }

  return {
    categorySlug,
    country,
    currency
  };
}

module.exports = {
  parseProductsQuery,
  COUNTRY_TO_CURRENCY,
  sanitizeSlug,
  sanitizeText
};
