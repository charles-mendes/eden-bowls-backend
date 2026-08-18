const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const editPetSchema = z.object({
  pet_id: z.string().trim().max(64).optional(),
  pet_name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  selected_flavors: z.array(z.string().trim().min(1).max(64)).max(20),
  flavor_weights: z.array(z.number().finite().nonnegative()).max(20)
});

const editAddressSchema = z.object({
  country: z.string().trim().max(8).optional(),
  state: z.string().trim().max(64).optional(),
  postal_code: z.string().trim().max(32).optional(),
  zipCode: z.string().trim().max(32).optional(),
  zipcode: z.string().trim().max(32).optional(),
  line1: z.string().trim().max(255).optional(),
  address: z.string().trim().max(255).optional(),
  street: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
  neighborhood: z.string().trim().max(120).optional(),
  complement: z.string().trim().max(120).optional(),
  number: z.string().trim().max(32).optional()
}).passthrough();

const editShippingSchema = z.object({
  method_id: z.string().trim().max(64).optional(),
  rate_id: z.string().trim().max(64).optional(),
  label: z.string().trim().max(255).optional(),
  cost: z.number().finite().nonnegative().optional(),
  tax_total: z.number().finite().nonnegative().optional(),
  total: z.number().finite().nonnegative().optional()
}).passthrough();

const subscriptionsEditPayloadSchema = z.object({
  subscription_term_months: z.union([z.literal(1), z.literal(3), z.literal(6)]),
  pets: z.array(editPetSchema).min(1).max(20),
  address: editAddressSchema.optional(),
  shipping: editShippingSchema.optional(),
  payment_method_id: z.string().trim().max(128).optional(),
  expected_current_hash: z.string().trim().max(128).optional()
});

function wrapZod(parse) {
  try {
    return parse();
  } catch (error) {
    if (error && error.name === 'ZodError') {
      const first = Array.isArray(error.issues) ? error.issues[0] : null;
      const path = first && Array.isArray(first.path) ? first.path.join('.') : '';
      if (path.includes('subscription_term_months')) {
        throw new HttpError(422, 'Subscription term must be 1, 3, or 6 months.', {
          code: 'invalid_subscription_term'
        });
      }
      throw new HttpError(422, first && first.message ? first.message : 'Invalid edit payload.', {
        code: 'invalid_plan',
        issues: error.issues
      });
    }
    throw error;
  }
}

function parseSubscriptionsEditPreviewInput(payload = {}) {
  return wrapZod(() => subscriptionsEditPayloadSchema.parse(payload || {}));
}

function parseSubscriptionsEditCommitInput(payload = {}) {
  const parsed = wrapZod(() => subscriptionsEditPayloadSchema.parse(payload || {}));
  const hash = String(parsed.expected_current_hash || '').trim();
  if (!hash) {
    throw new HttpError(422, 'expected_current_hash is required.', {
      code: 'expected_current_hash_required'
    });
  }

  return {
    ...parsed,
    expected_current_hash: hash
  };
}

module.exports = {
  parseSubscriptionsEditPreviewInput,
  parseSubscriptionsEditCommitInput
};
