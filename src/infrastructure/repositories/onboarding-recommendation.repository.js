const { buildForPet } = require('../../core/nutrition-recommendation');
const { buildPackagingRecommendation, buildSimplifiedRecommendation } = require('../../core/simplified-consumption');
const { resolveMarket } = require('../../core/market');

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

  async getRecommendation(userId, marketInput) {
    const market = marketInput && marketInput.country ? marketInput : resolveMarket(marketInput);
    const pets = await this.loadPets(userId);
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
