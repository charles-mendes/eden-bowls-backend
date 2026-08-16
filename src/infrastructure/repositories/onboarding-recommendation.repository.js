const { buildForPet } = require('../../core/nutrition-recommendation');
const { buildPackagingRecommendation, buildSimplifiedRecommendation } = require('../../core/simplified-consumption');
const { resolveMarket } = require('../../core/market');
const { normalizeDraftPets } = require('../../core/onboarding-draft-pets');

class OnboardingRecommendationRepository {
  constructor(petsRepository) {
    this.petsRepository = petsRepository || null;
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

    return {
      country: market.country,
      recommendations,
      packaging,
      simplified,
      version: 'v1'
    };
  }
}

module.exports = {
  OnboardingRecommendationRepository
};
