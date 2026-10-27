const { buildForPet } = require('../../core/nutrition-recommendation');
const { buildPackagingRecommendation, buildSimplifiedRecommendation } = require('../../core/simplified-consumption');
const { resolveMarket } = require('../../core/market');
const { normalizeDraftPets } = require('../../core/onboarding-draft-pets');

// Packaging of the market's plan product ({ packSizesGrams, planDays, largePackLimit }), or {} so the
// recommendation keeps the packaging of before when the catalog cannot be read.
async function planPackagingFor(source, country) {
  if (!source || typeof source.findPlanPackaging !== 'function') {
    return {};
  }
  try {
    return (await source.findPlanPackaging(country)) || {};
  } catch (_error) {
    return {};
  }
}

class OnboardingRecommendationRepository {
  constructor(petsRepository, options = {}) {
    this.petsRepository = petsRepository || null;
    this.productsRepository = options.productsRepository || null;
    this.lifeStageService = options.lifeStageService || null;
    this.recipeEnergyService = options.recipeEnergyService || null;
  }

  async loadPets(userId) {
    if (!userId || !this.petsRepository) {
      return [];
    }

    const data = await this.petsRepository.listPets(userId);
    return Array.isArray(data && data.pets) ? data.pets : [];
  }

  async resolvePets(userId, petsOverride) {
    const draftPets = normalizeDraftPets(petsOverride);
    if (draftPets.length > 0) {
      return draftPets;
    }

    return this.loadPets(userId);
  }

  async getRecommendation(userId, marketInput, petsOverride) {
    const market = marketInput && marketInput.country ? marketInput : resolveMarket(marketInput);
    const pets = await this.resolvePets(userId, petsOverride);
    const annotated = await this.annotatePets(userId, market, pets);
    const energies = await this.energiesFor(market, pets, annotated);
    const recommendations = pets.map((pet, index) => buildForPet(
      pet,
      energies[index] ? { nem_kcal_kg: energies[index] } : null,
      market.locale
    ));
    const planPackaging = await planPackagingFor(this.productsRepository, market.country);
    const simplified = buildSimplifiedRecommendation(recommendations, market, planPackaging);
    const packaging = buildPackagingRecommendation(recommendations, planPackaging);
    this.annotateLifeStages(annotated, simplified);

    return {
      country: market.country,
      recommendations,
      packaging,
      simplified,
      version: 'v1'
    };
  }
}

// Draft pets that already exist in the account age from the account record, which holds age_recorded_at.
OnboardingRecommendationRepository.prototype.annotatePets = async function annotatePets(userId, market, pets) {
  if (!this.lifeStageService) {
    return null;
  }
  const accountPets = userId ? await this.loadPets(userId) : [];
  const accountById = new Map(accountPets.map((pet) => [String(pet.id || ''), pet]));
  return this.lifeStageService.annotate(pets, market.country, (pet) => accountById.get(String(pet.pet_id || pet.id || '')) || pet);
};

// kcal/kg per pet from the mean energyKg of its line, null to keep the engine default (cats, no catalog).
OnboardingRecommendationRepository.prototype.energiesFor = async function energiesFor(market, pets, annotated) {
  if (!this.recipeEnergyService) {
    return pets.map(() => null);
  }
  return Promise.all(pets.map((pet, index) => {
    const type = String(pet.type || pet.especie || 'dog').toLowerCase();
    if (type === 'cat' || type === 'gato') {
      return null;
    }
    const stage = annotated && annotated[index] ? annotated[index].life_stage : null;
    return this.recipeEnergyService.forLifeStage(market.country, stage);
  }));
};

OnboardingRecommendationRepository.prototype.annotateLifeStages = function annotateLifeStages(annotated, simplified) {
  if (!annotated || !simplified || !Array.isArray(simplified.pets)) {
    return;
  }
  const byId = new Map();
  annotated.forEach((pet, index) => {
    byId.set(String(pet.pet_id || pet.id || '') || `#${index}`, pet);
  });
  simplified.pets = simplified.pets.map((entry, index) => {
    const match = byId.get(String(entry.pet_id || '')) || annotated[index];
    if (!match) {
      return entry;
    }
    const { life_stage, life_stage_next_at, size_class, current_age_years, current_age_months, allowed_life_stages } = match;
    return {
      ...entry,
      life_stage,
      life_stage_next_at,
      size_class,
      current_age_years,
      current_age_months,
      ...(allowed_life_stages ? { allowed_life_stages } : {})
    };
  });
};

module.exports = {
  planPackagingFor,
  OnboardingRecommendationRepository
};
