const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const optionalNumber = z.union([z.number(), z.string(), z.null()]).optional();

const shippingSettingsSchema = z.object({
  br: z.object({
    enabled: z.coerce.boolean().optional(),
    label: z.string().optional(),
    center: z.object({
      name: z.string().optional(),
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zipcode: z.string().optional(),
      lat: optionalNumber,
      lng: optionalNumber
    }).optional(),
    rule: z.object({
      per_km: optionalNumber,
      road_factor: optionalNumber,
      min_fee: optionalNumber,
      max_fee: optionalNumber,
      max_distance_km: optionalNumber,
      km_per_day: optionalNumber,
      min_days: optionalNumber,
      max_days: optionalNumber
    }).optional()
  }).optional(),
  us: z.object({
    enabled: z.coerce.boolean().optional(),
    cost: optionalNumber,
    carrier: z.string().optional(),
    delivery: z.string().optional(),
    label: z.string().optional()
  }).optional()
});

const shippingTestSchema = z.object({
  zipCode: z.string().min(1),
  country: z.enum(['BR', 'US']).default('BR')
});

function parseShippingSettingsInput(input) {
  const parsed = shippingSettingsSchema.safeParse(input || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }
  return parsed.data;
}

function parseShippingTestInput(input) {
  const parsed = shippingTestSchema.safeParse(input || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }
  return parsed.data;
}

module.exports = {
  parseShippingSettingsInput,
  parseShippingTestInput
};
