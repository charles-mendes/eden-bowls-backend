const { buildForPet } = require('../../core/nutrition-recommendation');
const { buildPackagingRecommendation, buildSimplifiedRecommendation } = require('../../core/simplified-consumption');
const { resolveMarket } = require('../../core/market');
const { normalizeDraftPets } = require('../../core/onboarding-draft-pets');

class OnboardingRecommendationRepository {
  constructor(petsRepository, options = {}) {
    this.petsRepository = petsRepository || null;
    this.lifeStageService = options.lifeStageService || null;
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
    const recommendations = pets.map((pet) => buildForPet(pet, null, market.locale));
    const simplified = buildSimplifiedRecommendation(recommendations, market);
    const packaging = buildPackagingRecommendation(recommendations);
    await this.annotateLifeStages(userId, market, pets, simplified);

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
OnboardingRecommendationRepository.prototype.annotateLifeStages = async function annotateLifeStages(userId, market, pets, simplified) {
  if (!this.lifeStageService || !simplified || !Array.isArray(simplified.pets)) {
    return;
  }
  const accountPets = userId ? await this.loadPets(userId) : [];
  const accountById = new Map(accountPets.map((pet) => [String(pet.id || ''), pet]));
  const byId = new Map();
  const annotated = await this.lifeStageService.annotate(pets, market.country, (pet) => accountById.get(String(pet.pet_id || pet.id || '')) || pet);
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
  OnboardingRecommendationRepository
};
