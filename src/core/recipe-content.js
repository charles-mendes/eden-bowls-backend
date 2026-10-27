const { HttpError } = require('./http-error');
const { canonicalFlavorKey } = require('./flavors');

const RECIPE_CONTENT_MARKETS = ['BR', 'US'];

// Recipe banner image accepted by the store (recipe-content): the size of public/images/recipe-*.png.
const RECIPE_IMAGE_WIDTH = 1024;
const RECIPE_IMAGE_HEIGHT = 636;
// Square package thumbnail of the plan flavor picker (recipe-content): 400 px for retina screens, or 200 px.
const RECIPE_PLAN_IMAGE_SIZES = [400, 200];
const MAX_RECIPE_IMAGE_BYTES = 5 * 1024 * 1024;
const RECIPE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
// sharp's decoded format for each accepted type, so a renamed GIF is refused.
const RECIPE_IMAGE_FORMATS = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
const RECIPE_IMAGE_OUTPUT_MIME = 'image/webp';
const RECIPE_IMAGE_OUTPUT_EXT = 'webp';
const RECIPE_IMAGE_WEBP_QUALITY = 85;
const RECIPE_IMAGE_INVALID = 'recipe_image_invalid';
const RECIPE_CONTENT_IN_USE = 'recipe_content_in_use';

// Explicit link of a variation to a recipe (recipe-content): blank means no recipe.
const RECIPE_KEY_META = '_recipe_key';
const RECIPE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_RECIPE_KEY_LENGTH = 64;
const RECIPE_KEY_INVALID = 'recipe_key_invalid';

// null for no recipe; refuses anything that is not a lowercase slug.
function parseRecipeKey(value) {
  if (value == null) {
    return null;
  }
  const key = String(value).trim();
  if (!key) {
    return null;
  }
  if (key.length > MAX_RECIPE_KEY_LENGTH || !RECIPE_KEY_PATTERN.test(key)) {
    throw new HttpError(422, 'Recipe key must use lowercase letters, digits and single hyphens, up to 64 characters.', {
      code: RECIPE_KEY_INVALID
    });
  }
  return key;
}

function normalizeRecipeMarket(value) {
  const market = String(value || '').trim().toUpperCase();
  return RECIPE_CONTENT_MARKETS.includes(market) ? market : '';
}

// Content key of a variation or a store recipe key: the canonical flavor key, so `chicken` and `turkey`
// share one row and adult variations without a stored slug fall back to their flavor label.
function recipeKeyOf(value, market) {
  return canonicalFlavorKey(value, market);
}

// Label fields, named as in the store's recipe Markdown so the store can use them as they are.
const LABEL_TEXT_FIELDS = ['productName', 'netWeight', 'freshnessNote', 'energyKg', 'energyPackage', 'manufacturer', 'manufacturerLocation'];
const LABEL_LIST_FIELDS = ['ingredients', 'notices', 'storage', 'feeding'];
const MAX_LABEL_TEXT_LENGTH = 500;
const MAX_LABEL_LIST_ITEMS = 40;
const RECIPE_LABEL_INVALID = 'recipe_label_invalid';

function labelError(field, message) {
  return new HttpError(422, message, { code: RECIPE_LABEL_INVALID, field });
}

function labelText(value, field) {
  if (value == null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw labelError(field, `${field} must be text.`);
  }
  const text = value.trim();
  if (text.length > MAX_LABEL_TEXT_LENGTH) {
    throw labelError(field, `${field} must have at most ${MAX_LABEL_TEXT_LENGTH} characters.`);
  }
  return text;
}

function labelList(value, field, mapItem) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw labelError(field, `${field} must be a list.`);
  }
  const items = value.map((item, index) => mapItem(item, `${field}[${index}]`)).filter(Boolean);
  if (items.length > MAX_LABEL_LIST_ITEMS) {
    throw labelError(field, `${field} must have at most ${MAX_LABEL_LIST_ITEMS} items.`);
  }
  return items;
}

function analysisRow(row, field) {
  if (row == null) {
    return null;
  }
  if (typeof row !== 'object' || Array.isArray(row)) {
    throw labelError(field, `${field} must have nutrient and value.`);
  }
  const nutrient = labelText(row.nutrient, `${field}.nutrient`);
  const value = labelText(row.value, `${field}.value`);
  if (!nutrient && !value) {
    return null;
  }
  if (!nutrient || !value) {
    throw labelError(field, `${field} must have nutrient and value.`);
  }
  return { nutrient, value };
}

// Normalized label from a request: trimmed text, blank list rows dropped, unknown keys ignored.
function parseRecipeLabel(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw labelError('label', 'label must be an object.');
  }
  const label = {};
  for (const field of LABEL_TEXT_FIELDS) {
    label[field] = labelText(input[field], field);
  }
  for (const field of LABEL_LIST_FIELDS) {
    label[field] = labelList(input[field], field, (item, itemField) => labelText(item, itemField) || null);
  }
  label.analysis = labelList(input.analysis, 'analysis', analysisRow);
  return label;
}

// Label state reported to the admin and used by activation. US labels need at least one notice of any text,
// since puppy and senior recipes may carry another AAFCO statement than the adult ones.
function labelCompleteness(label, market) {
  if (!label) {
    return { status: 'missing', missing: [] };
  }
  const missing = [];
  const hasItems = (field) => Array.isArray(label[field]) && label[field].length > 0;
  if (!hasItems('ingredients')) missing.push('ingredients');
  if (!hasItems('analysis')) missing.push('analysis');
  if (!String(label.energyKg || '').trim()) missing.push('energyKg');
  if (!String(label.energyPackage || '').trim()) missing.push('energyPackage');
  if (normalizeRecipeMarket(market) === 'US' && !hasItems('notices')) missing.push('notices');
  return { status: missing.length ? 'incomplete' : 'complete', missing };
}

// Energy density written on a label ("1.200 kcal/kg", "1,500 kcal/kg", "1200") in kcal/kg, or null.
// A dot or comma followed by exactly three digits is a thousands separator in both markets.
function parseEnergyKcalPerKg(value) {
  const match = String(value || '').match(/\d[\d.,]*/);
  if (!match) {
    return null;
  }
  const raw = match[0].replace(/[.,]$/, '');
  const digits = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? raw.replace(/[.,]/g, '') : raw.replace(',', '.');
  const kcal = Number(digits);
  return Number.isFinite(kcal) && kcal > 0 ? kcal : null;
}

// Recipe page presentation, saved whole: text limits in characters, after trimming.
const PRESENTATION_TEXT_LIMITS = { title: 120, tagline: 80, resume: 300 };
const MAX_PRESENTATION_HIGHLIGHTS = 8;
const MAX_PRESENTATION_HIGHLIGHT_LENGTH = 60;
const PRESENTATION_COLOR_FIELDS = ['color', 'accentColor', 'pillBg', 'pillText', 'pillBorder'];
const PRESENTATION_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const RECIPE_PRESENTATION_INVALID = 'recipe_presentation_invalid';

function presentationText(value, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= limit ? text : null;
}

// Normalized presentation from a request, or 422 listing every invalid field. Unknown keys are ignored.
function parseRecipePresentation(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const invalid = [];
  const presentation = {};
  for (const [field, limit] of Object.entries(PRESENTATION_TEXT_LIMITS)) {
    presentation[field] = presentationText(source[field], limit);
    if (!presentation[field]) invalid.push(field);
  }
  const highlights = Array.isArray(source.highlights) ? source.highlights : [];
  presentation.highlights = highlights.map((item) => presentationText(item, MAX_PRESENTATION_HIGHLIGHT_LENGTH));
  if (!highlights.length || highlights.length > MAX_PRESENTATION_HIGHLIGHTS) {
    invalid.push('highlights');
  } else {
    presentation.highlights.forEach((item, index) => {
      if (!item) invalid.push(`highlights[${index}]`);
    });
  }
  const colors = source.colors && typeof source.colors === 'object' ? source.colors : {};
  presentation.colors = {};
  for (const field of PRESENTATION_COLOR_FIELDS) {
    const value = typeof colors[field] === 'string' ? colors[field].trim() : '';
    if (PRESENTATION_COLOR_PATTERN.test(value)) {
      presentation.colors[field] = value.toUpperCase();
    } else {
      invalid.push(`colors.${field}`);
    }
  }
  if (invalid.length) {
    throw new HttpError(422, `Invalid presentation fields: ${invalid.join(', ')}.`, { code: RECIPE_PRESENTATION_INVALID, fields: invalid });
  }
  return presentation;
}

module.exports = {
  parseRecipePresentation,
  PRESENTATION_TEXT_LIMITS,
  MAX_PRESENTATION_HIGHLIGHTS,
  MAX_PRESENTATION_HIGHLIGHT_LENGTH,
  PRESENTATION_COLOR_FIELDS,
  RECIPE_PRESENTATION_INVALID,
  parseEnergyKcalPerKg,
  RECIPE_KEY_META,
  RECIPE_KEY_INVALID,
  parseRecipeKey,
  RECIPE_CONTENT_MARKETS,
  normalizeRecipeMarket,
  recipeKeyOf,
  labelCompleteness,
  parseRecipeLabel,
  LABEL_TEXT_FIELDS,
  LABEL_LIST_FIELDS,
  RECIPE_LABEL_INVALID,
  RECIPE_IMAGE_WIDTH,
  RECIPE_IMAGE_HEIGHT,
  RECIPE_PLAN_IMAGE_SIZES,
  MAX_RECIPE_IMAGE_BYTES,
  RECIPE_IMAGE_MIME_TYPES,
  RECIPE_IMAGE_FORMATS,
  RECIPE_IMAGE_OUTPUT_MIME,
  RECIPE_IMAGE_OUTPUT_EXT,
  RECIPE_IMAGE_WEBP_QUALITY,
  RECIPE_IMAGE_INVALID,
  RECIPE_CONTENT_IN_USE
};
