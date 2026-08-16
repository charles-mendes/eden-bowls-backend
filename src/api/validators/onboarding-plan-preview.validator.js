const { z } = require('zod');

const planPreviewPetSchema = z.object({
  pet_id: z.string().trim().max(64).optional(),
  pet_name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  selected_flavors: z.array(z.string().trim().min(1).max(64)).max(20),
  flavor_weights: z.array(z.number().finite().nonnegative()).max(20),
  name: z.string().trim().max(120).optional(),
  breed: z.string().trim().max(120).optional(),
  age_years: z.union([z.string(), z.number()]).optional(),
  age_months: z.union([z.string(), z.number()]).optional(),
  weight: z.union([z.string(), z.number()]).optional(),
  weight_input: z.union([z.string(), z.number()]).optional(),
  weight_unit: z.enum(['kg', 'lb']).optional(),
  size: z.string().trim().max(32).optional(),
  activity_level: z.string().trim().max(32).optional(),
  pet_condition: z.string().trim().max(32).optional(),
  neutered: z.boolean().optional()
});

const planPreviewPayloadSchema = z.object({
  subscription_term_months: z.union([z.literal(1), z.literal(3), z.literal(6)]),
  pets: z.array(planPreviewPetSchema).min(1).max(20),
  country: z.enum(['US', 'BR']).optional(),
  domain: z.enum(['com', 'com.br']).optional()
});

function parseOnboardingPlanPreviewInput(payload = {}) {
  return planPreviewPayloadSchema.parse(payload || {});
}

module.exports = {
  parseOnboardingPlanPreviewInput
};