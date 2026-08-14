const { z } = require('zod');

const petSchema = z.object({
  local_id: z.string().trim().min(1).max(36),
  name: z.string().trim().min(1).max(120),
  breed: z.string().trim().max(120).optional(),
  age_years: z.union([z.string(), z.number()]).optional(),
  age_months: z.union([z.string(), z.number()]).optional(),
  weight: z.union([z.string(), z.number()]).optional(),
  weight_unit: z.enum(['kg', 'lb']).optional(),
  size: z.enum(['small', 'medium', 'large']).optional(),
  activity_level: z.enum(['low', 'medium', 'high']).optional(),
  pet_condition: z.enum(['underweight', 'ideal', 'overweight']).optional(),
  neutered: z.boolean().optional()
});

function parseOnboardingPetsSyncInput(payload = {}) {
  return z.object({ pets: z.array(petSchema).min(1).max(20) }).parse(payload || {});
}

module.exports = {
  parseOnboardingPetsSyncInput
};