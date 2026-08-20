const { z } = require('zod');
const { HttpError } = require('../../core/http-error');
const { VALID_SUBSCRIPTION_TERMS } = require('../../core/first-purchase-discount');

const mappingSchema = z.object({
  1: z.string().optional().nullable(),
  3: z.string().optional().nullable(),
  6: z.string().optional().nullable()
}).passthrough();

const createCouponSchema = z.object({
  term_months: z.coerce.number().int(),
  code: z.string().trim().min(1),
  name: z.string().trim().optional().default(''),
  max_redemptions: z.coerce.number().int().min(0).optional().default(0),
  assign_first_purchase_slot: z.coerce.boolean().optional().default(true)
});

function parsePromoMappingInput(input) {
  const parsed = mappingSchema.safeParse(input || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }
  return parsed.data;
}

function parseCreateCouponInput(input) {
  const parsed = createCouponSchema.safeParse(input || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }

  if (!VALID_SUBSCRIPTION_TERMS.includes(parsed.data.term_months)) {
    throw new HttpError(400, 'Invalid subscription term.', { code: 'invalid_term' });
  }

  if (!parsed.data.code) {
    throw new HttpError(400, 'Invalid promotion code.', { code: 'invalid_promotion_code' });
  }

  return parsed.data;
}

module.exports = {
  parseCreateCouponInput,
  parsePromoMappingInput
};
