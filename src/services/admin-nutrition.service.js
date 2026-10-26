const { HttpError } = require('../core/http-error');
const { buildForPet } = require('../core/nutrition-recommendation');
const { convertWeight } = require('../core/market');
const { constrainMarketQuery, shouldEnforceMarketScope } = require('../core/admin-market-scope');

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
  constructor(options = {}) {
    this.recipeEnergyService = options.recipeEnergyService || null;
  }

  // kcal/kg for the simulation: the chosen recipe's energyKg, else the mean of the pet's line.
  // Cats and an unwired catalog keep the engine default.
  async resolveEnergy(market, recipeKey, pet) {
    if (!this.recipeEnergyService || pet.type === 'cat') {
      return { kcalKg: null, source: 'default' };
    }
    if (recipeKey) {
      const kcalKg = await this.recipeEnergyService.forRecipe(market, recipeKey);
      if (!kcalKg) {
        throw new HttpError(422, 'A receita não tem energia (energyKg) cadastrada no rótulo.', {
          code: 'recipe_energy_missing',
          recipe_key: recipeKey
        });
      }
      return { kcalKg, source: 'recipe' };
    }
    const kcalKg = await this.recipeEnergyService.forLifeStage(market, pet.life_stage);
    return kcalKg ? { kcalKg, source: 'life_stage_average' } : { kcalKg: null, source: 'default' };
  }

  // Recipes the simulator can pick, with their energy density.
  async listRecipes({ country }, actor = {}) {
    if (shouldEnforceMarketScope(actor)) {
      constrainMarketQuery(actor, { country });
    }
    const market = country === 'BR' ? 'BR' : 'US';
    const items = this.recipeEnergyService ? await this.recipeEnergyService.listRecipes(market) : [];
    return { success: true, data: { market, items } };
  }

  async simulate({ country, recipeKey = '', pet = {}, questionnaire = {} }, actor = {}) {
    if (shouldEnforceMarketScope(actor)) {
      constrainMarketQuery(actor, { country });
    }
    const market = country === 'BR' ? 'BR' : 'US';
    const locale = market === 'BR' ? 'pt-BR' : 'en-US';
    const weight = Number(pet.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new HttpError(422, 'Peso inválido. Informe peso maior que zero.');
    }

    const energy = await this.resolveEnergy(market, recipeKey, pet);
    const result = buildForPet(
      {
        name: pet.name,
        type: pet.type,
        life_stage: LIFE_STAGE_TO_STATE[pet.life_stage] || pet.life_stage,
        age: pet.age,
        age_years: pet.age_years ?? pet.age,
        age_months: pet.age_months,
        weight,
        weight_unit: pet.weight_unit === 'lb' ? 'lb' : 'kg',
        breed: pet.breed,
        neutered: pet.neutered
      },
      {
        nivel_atividade: questionnaire.nivel_atividade,
        score_corporal: questionnaire.score_corporal,
        nem_kcal_kg: energy.kcalKg
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
        nem_source: energy.source,
        recipe_key: energy.source === 'recipe' ? recipeKey : null,
        display: {
          daily: formatDailyAmount(result.quantidade_g_dia, market),
          weight: formatWeight(result.pet.weight, market)
        }
      }
    };
  }
}

module.exports = {
  AdminNutritionService
};
