const { z } = require('zod');

const onboardingPetCreatePayloadSchema = z.object({
  name: z.string().trim().min(1).optional(),
  breed: z.string().trim().min(1).optional(),
  age_years: z.union([z.string(), z.number()]).optional(),
  age_months: z.union([z.string(), z.number()]).optional(),
  weight: z.union([z.string(), z.number()]).optional(),
  weight_unit: z.enum(['kg', 'lb']).optional(),
  size: z.enum(['small', 'medium', 'large']).optional(),
  activity_level: z.enum(['low', 'medium', 'high']).optional(),
  pet_condition: z.enum(['underweight', 'ideal', 'overweight']).optional(),
  neutered: z.boolean().optional()
});

function parseOnboardingPetCreateInput(payload = {}) {
  const parsed = onboardingPetCreatePayloadSchema.parse(payload || {});
  return {
    name: parsed.name || '',
    breed: parsed.breed || '',
    age_years: Number(parsed.age_years ?? 0),
    age_months: Number(parsed.age_months ?? 0),
    weight: Number(parsed.weight ?? 0),
    weight_unit: parsed.weight_unit || 'kg',
    size: parsed.size || 'medium',
    activity_level: parsed.activity_level || 'medium',
    pet_condition: parsed.pet_condition || 'ideal',
    neutered: parsed.neutered ?? false
  };
}

module.exports = {
  parseOnboardingPetCreateInput
};
