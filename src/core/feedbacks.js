const FEEDBACK_CATEGORIES = ['tutor', 'tutora'];
const FEEDBACK_COUNTRIES = ['BR', 'US'];
const FEEDBACK_PHOTO_MIME_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};
const MAX_FEEDBACK_PHOTO_BYTES = 3 * 1024 * 1024;
const FEEDBACK_PHOTO_WIDTH = 400;
const FEEDBACK_PHOTO_HEIGHT = 300;
const FEEDBACK_PHOTO_OUTPUT_MIME = 'image/webp';
const FEEDBACK_PHOTO_OUTPUT_EXT = 'webp';
const PUBLIC_FEEDBACK_LIMIT = 50;

function normalizeFeedbackCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  return FEEDBACK_COUNTRIES.includes(country) ? country : '';
}

function normalizeFeedbackCategory(value) {
  const category = String(value || '').trim().toLowerCase();
  return FEEDBACK_CATEGORIES.includes(category) ? category : '';
}

function parseBooleanQuery(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

module.exports = {
  FEEDBACK_CATEGORIES,
  FEEDBACK_COUNTRIES,
  FEEDBACK_PHOTO_MIME_TYPES,
  MAX_FEEDBACK_PHOTO_BYTES,
  FEEDBACK_PHOTO_WIDTH,
  FEEDBACK_PHOTO_HEIGHT,
  FEEDBACK_PHOTO_OUTPUT_MIME,
  FEEDBACK_PHOTO_OUTPUT_EXT,
  PUBLIC_FEEDBACK_LIMIT,
  normalizeFeedbackCategory,
  normalizeFeedbackCountry,
  parseBooleanQuery
};
