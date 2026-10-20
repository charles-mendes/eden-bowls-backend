const { z } = require('zod');
const { MARKETS } = require('../../core/market');
const { assertBirthDateInRange, birthDateSchema, normalizeBirthDate } = require('./pet-birth-date.validator');

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
  neutered: z.boolean().optional(),
  birth_date: birthDateSchema,
  birthDate: birthDateSchema,
  country: z.enum(['US', 'BR']).optional(),
  domain: z.enum(['com', 'com.br']).optional()
});

function parseOnboardingPetCreateInput(payload = {}, market = MARKETS.US, now = new Date()) {
  const parsed = onboardingPetCreatePayloadSchema.parse(payload || {});
  const birthDate = normalizeBirthDate(parsed.birth_date !== undefined ? parsed.birth_date : parsed.birthDate) ?? null;
  assertBirthDateInRange(birthDate, market, now);
  return {
    name: parsed.name || '',
    breed: parsed.breed || '',
    age_years: Number(parsed.age_years ?? 0),
    age_months: Number(parsed.age_months ?? 0),
    weight: Number(parsed.weight ?? 0),
    weight_unit: parsed.weight_unit || market.weightUnit,
    size: parsed.size || 'medium',
    activity_level: parsed.activity_level || 'medium',
    pet_condition: parsed.pet_condition || 'ideal',
    neutered: parsed.neutered ?? false,
    birth_date: birthDate
  };
}

module.exports = {
  parseOnboardingPetCreateInput
};
