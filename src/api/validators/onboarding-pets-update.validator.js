const { z } = require('zod');

const onboardingPetUpdatePayloadSchema = z.object({
  name: z.string().trim().min(1).optional(),
  breed: z.string().trim().min(1).optional(),
  age_years: z.union([z.string(), z.number()]).optional(),
  age_months: z.union([z.string(), z.number()]).optional(),
  weight: z.union([z.string(), z.number()]).optional(),
  weight_unit: z.enum(['kg', 'lb']).optional(),
  size: z.enum(['small', 'medium', 'large']).optional(),
  activity_level: z.enum(['low', 'medium', 'high']).optional(),
  pet_condition: z.enum(['underweight', 'ideal', 'overweight']).optional(),
  neutered: z.boolean().optional(),
  ageYears: z.union([z.string(), z.number()]).optional(),
  ageMonths: z.union([z.string(), z.number()]).optional(),
  weightUnit: z.enum(['kg', 'lb']).optional(),
  activityLevel: z.enum(['low', 'medium', 'high']).optional(),
  weightCondition: z.enum(['underweight', 'ideal', 'overweight']).optional()
});

function parseOnboardingPetUpdateInput(payload = {}) {
  const parsed = onboardingPetUpdatePayloadSchema.parse(payload || {});
  const normalized = {};

  if (parsed.name !== undefined) normalized.name = parsed.name;
  if (parsed.breed !== undefined) normalized.breed = parsed.breed;
  if (parsed.age_years !== undefined) normalized.age_years = Number(parsed.age_years);
  else if (parsed.ageYears !== undefined) normalized.age_years = Number(parsed.ageYears);
  if (parsed.age_months !== undefined) normalized.age_months = Number(parsed.age_months);
  else if (parsed.ageMonths !== undefined) normalized.age_months = Number(parsed.ageMonths);
  if (parsed.weight !== undefined) normalized.weight = Number(parsed.weight);
  if (parsed.weight_unit !== undefined) normalized.weight_unit = parsed.weight_unit;
  else if (parsed.weightUnit !== undefined) normalized.weight_unit = parsed.weightUnit;
  if (parsed.size !== undefined) normalized.size = parsed.size;
  if (parsed.activity_level !== undefined) normalized.activity_level = parsed.activity_level;
  else if (parsed.activityLevel !== undefined) normalized.activity_level = parsed.activityLevel;
  if (parsed.pet_condition !== undefined) normalized.pet_condition = parsed.pet_condition;
  else if (parsed.weightCondition !== undefined) normalized.pet_condition = parsed.weightCondition;
  if (parsed.neutered !== undefined) normalized.neutered = parsed.neutered;

  return normalized;
}

module.exports = {
  parseOnboardingPetUpdateInput
};
