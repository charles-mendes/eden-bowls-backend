const { HttpError } = require('../core/http-error');
const { buildForPet } = require('../core/nutrition-recommendation');
const { convertWeight } = require('../core/market');

const LIFE_STAGE_TO_STATE = {
  puppy: 'crescimento',
  adult: 'manutencao',
  senior: 'senior'
};

function formatDailyAmount(gramsDay, country) {
  if (country === 'BR') {
    return `${gramsDay} g/dia`;
  }

  const ounces = convertWeight(gramsDay / 1000, 'kg', 'lb') * 16;
  return `${ounces.toFixed(1)} oz/day`;
}

function formatWeight(weightKg, country) {
  if (country === 'BR') {
    return `${Number(weightKg).toFixed(2)} kg`;
  }

  return `${convertWeight(weightKg, 'kg', 'lb').toFixed(2)} lb`;
}

class AdminNutritionService {
  simulate({ country, pet = {}, questionnaire = {} }) {
    const market = country === 'BR' ? 'BR' : 'US';
    const locale = market === 'BR' ? 'pt-BR' : 'en-US';
    const weight = Number(pet.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new HttpError(422, 'Peso inválido. Informe peso maior que zero.');
    }

    const result = buildForPet(
      {
        name: pet.name,
        type: pet.type,
        life_stage: LIFE_STAGE_TO_STATE[pet.life_stage] || pet.life_stage,
        age: pet.age,
        weight,
        breed: pet.breed,
        neutered: pet.neutered
      },
      {
        nivel_atividade: questionnaire.nivel_atividade,
        score_corporal: questionnaire.score_corporal
      },
      locale
    );

    if (result && result.error) {
      throw new HttpError(422, 'Peso inválido. Informe peso maior que zero.');
    }

    return {
      success: true,
      data: {
        energia_kcal_dia: result.energia_kcal_dia,
        quantidade_g_dia: result.quantidade_g_dia,
        refeicoes: result.refeicoes,
        quantidade_por_refeicao: result.quantidade_por_refeicao,
        fator_aplicado: result.fator_aplicado,
        porte: result.porte,
        especie: result.especie,
        nem_kcal_kg: result.nem_kcal_kg,
        display: {
          daily: formatDailyAmount(result.quantidade_g_dia, market),
          weight: formatWeight(weight, market)
        }
      }
    };
  }
}

module.exports = {
  AdminNutritionService
};
