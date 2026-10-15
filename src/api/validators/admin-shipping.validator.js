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
      number: z.string().optional(),
      complement: z.string().optional(),
      neighborhood: z.string().optional(),
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
    label: z.string().optional(),
    quote_mode: z.enum(['fixed', 'ups']).optional(),
    fallback_enabled: z.coerce.boolean().optional(),
    ship_from: z.object({
      name: z.string().optional(),
      street: z.string().optional(),
      street2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zipcode: z.string().optional(),
      country: z.string().optional()
    }).optional(),
    package: z.object({
      weight_lb: optionalNumber,
      length_in: optionalNumber,
      width_in: optionalNumber,
      height_in: optionalNumber
    }).optional(),
    allowed_service_codes: z.union([z.array(z.string()), z.string()]).optional()
  }).optional()
});

const shippingTestSchema = z.object({
  zipCode: z.string().min(1),
  country: z.enum(['BR', 'US']).default('BR')
});

const headquartersAddressSchema = z.object({
  street: z.string().max(191).optional(),
  number: z.string().max(32).optional(),
  complement: z.string().max(128).optional(),
  neighborhood: z.string().max(128).optional(),
  street2: z.string().max(191).optional(),
  city: z.string().max(128).optional(),
  state: z.string().max(8).optional(),
  zipcode: z.string().max(16).optional()
});

const headquartersValidateSchema = z.object({
  country: z.enum(['BR', 'US']),
  address: headquartersAddressSchema
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

function parseHeadquartersValidateInput(input) {
  const parsed = headquartersValidateSchema.safeParse(input || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }
  return parsed.data;
}

module.exports = {
  parseHeadquartersValidateInput,
  parseShippingSettingsInput,
  parseShippingTestInput
};
