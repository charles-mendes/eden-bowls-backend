const { z } = require('zod');
const { normalizeDraftPets } = require('../../core/onboarding-draft-pets');

const optionalText = z.string().trim().max(120).optional();
const optionalNumberLike = z.union([z.string(), z.number()]).optional();

const recommendationPetSchema = z.object({
  pet_id: z.string().trim().max(64).optional(),
  id: z.string().trim().max(64).optional(),
  name: optionalText,
  pet_name: optionalText,
  breed: optionalText,
  age_years: optionalNumberLike,
  age_months: optionalNumberLike,
  age: optionalNumberLike,
  weight: optionalNumberLike,
  weight_input: optionalNumberLike,
  weight_unit: z.enum(['kg', 'lb']).optional(),
  size: z.string().trim().max(32).optional(),
  activity_level: z.string().trim().max(32).optional(),
  pet_condition: z.string().trim().max(32).optional(),
  neutered: z.boolean().optional()
});

const recommendationPetsPayloadSchema = z.object({
  pets: z.array(recommendationPetSchema).max(20).optional(),
  country: z.enum(['US', 'BR']).optional(),
  domain: z.enum(['com', 'com.br']).optional()
});

function parseOnboardingRecommendationPetsInput(payload = {}) {
  const parsed = recommendationPetsPayloadSchema.parse(payload || {});
  return {
    pets: normalizeDraftPets(parsed.pets)
  };
}

module.exports = {
  parseOnboardingRecommendationPetsInput,
  recommendationPetSchema
};
