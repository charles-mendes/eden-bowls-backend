const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const simulateSchema = z.object({
  country: z.enum(['BR', 'US']).default('US'),
  pet: z.object({
    name: z.string().optional().default(''),
    type: z.enum(['dog', 'cat']).default('dog'),
    life_stage: z.enum(['puppy', 'adult', 'senior']).default('adult'),
    age: z.coerce.number().int().min(0).optional().default(4),
    age_years: z.coerce.number().int().min(0).optional(),
    age_months: z.coerce.number().int().min(0).optional().default(0),
    weight: z.coerce.number().optional().default(20),
    weight_unit: z.enum(['kg', 'lb']).optional().default('kg'),
    breed: z.string().optional().default(''),
    neutered: z.coerce.boolean().optional().default(true)
  }).default({}),
  questionnaire: z.object({
    nivel_atividade: z.enum(['BAIXO', 'MODERADO', 'ALTO']).default('BAIXO'),
    score_corporal: z.enum(['ABAIXO', 'ADEQUADO', 'ACIMA']).default('ADEQUADO')
  }).default({})
});

function parseNutritionSimulateInput(input) {
  const parsed = simulateSchema.safeParse(input || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }

  const country = parsed.data.country === 'BR' ? 'BR' : 'US';
  const pet = parsed.data.pet;
  const ageYears = pet.age_years ?? pet.age;
  return {
    country,
    pet: {
      ...pet,
      age: ageYears,
      age_years: ageYears,
      age_months: pet.age_months,
      weight_unit: pet.weight_unit === 'lb' ? 'lb' : 'kg'
    },
    questionnaire: parsed.data.questionnaire
  };
}

module.exports = {
  parseNutritionSimulateInput
};
