const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const WINDOW_DAYS = [7, 14, 30];
const MOVEMENT_TYPES = ['production', 'separation', 'separation_reversal', 'adjustment'];
const ADJUSTMENT_REASONS = ['loss', 'expired', 'count', 'sample', 'other'];
const MAX_QUANTITY = 10000;

const itemKeySchema = {
  market: z.string().trim().min(1).optional(),
  flavorKey: z.string().trim().min(1).max(64),
  packSizeGrams: z.coerce.number().int().min(1).max(100000)
};
const noteSchema = z.string().trim().max(255).optional().nullable();

const productionSchema = z.object({
  ...itemKeySchema,
  quantity: z.coerce.number().int().min(1).max(MAX_QUANTITY),
  note: noteSchema
});

const adjustmentSchema = z.object({
  ...itemKeySchema,
  quantity: z.coerce.number().int().min(-MAX_QUANTITY).max(MAX_QUANTITY).refine((value) => value !== 0),
  reason: z.enum(ADJUSTMENT_REASONS),
  note: noteSchema
});

const minimumSchema = z.object({
  ...itemKeySchema,
  minLevel: z.coerce.number().int().min(0).max(MAX_QUANTITY).nullable()
});

function parse(schema, body) {
  const parsed = schema.safeParse(body || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }
  return parsed.data;
}

function optionalText(value) {
  return value == null || String(value).trim() === '' ? '' : String(value).trim();
}

function parseStockOverviewQuery(query = {}) {
  const raw = optionalText(query.windowDays);
  const windowDays = raw ? Number(raw) : 7;
  if (!WINDOW_DAYS.includes(windowDays)) {
    throw new HttpError(400, 'windowDays must be 7, 14, or 30.', { code: 'invalid_window_days' });
  }
  return { market: optionalText(query.market), windowDays };
}

function parseStockMovementsQuery(query = {}) {
  const type = optionalText(query.type);
  if (type && !MOVEMENT_TYPES.includes(type)) {
    throw new HttpError(400, 'Invalid movement type.', { code: 'invalid_stock_movement_type' });
  }
  const grams = optionalText(query.packSizeGrams);
  const packSizeGrams = grams ? Number(grams) : null;
  if (grams && !(Number.isInteger(packSizeGrams) && packSizeGrams > 0)) {
    throw new HttpError(400, 'packSizeGrams must be a whole number of grams.', { code: 'invalid_pack_size_grams' });
  }
  return {
    market: optionalText(query.market),
    flavorKey: optionalText(query.flavorKey),
    packSizeGrams,
    type
  };
}

function parseStockProduction(body) {
  const data = parse(productionSchema, body);
  return { ...data, note: data.note || null };
}

function parseStockAdjustment(body) {
  const data = parse(adjustmentSchema, body);
  if (data.reason === 'other' && !data.note) {
    throw new HttpError(400, 'A note is required when the reason is other.', { code: 'stock_adjustment_note_required' });
  }
  return { ...data, note: data.note || null };
}

function parseStockMinimum(body) {
  return parse(minimumSchema, body);
}

module.exports = {
  ADJUSTMENT_REASONS,
  MOVEMENT_TYPES,
  parseStockAdjustment,
  parseStockMinimum,
  parseStockMovementsQuery,
  parseStockOverviewQuery,
  parseStockProduction
};
