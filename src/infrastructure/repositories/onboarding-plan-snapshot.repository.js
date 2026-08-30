const { PLAN_TERMS } = require('../../core/first-purchase-discount');
const { flavorOptionsFromLabels, listFlavorOptions } = require('../../core/flavors');
const { MARKETS, resolveMarket } = require('../../core/market');
const { consumptionLabels } = require('../../core/simplified-consumption');

class OnboardingPlanSnapshotRepository {
  constructor(options = {}) {
    this.recommendationRepository = options.recommendationRepository || null;
    this.productsRepository = options.productsRepository || null;
  }

  async getSnapshot(userId, marketInput, petsOverride) {
    const market = marketInput && marketInput.country ? marketInput : resolveMarket(marketInput);
    const recommendation = this.recommendationRepository
      ? await this.recommendationRepository.getRecommendation(userId, market, petsOverride)
      : null;
    const simplified = recommendation && recommendation.simplified
      ? recommendation.simplified
      : {
        country: market.country,
        period_days: 30,
        labels: consumptionLabels(market),
        pets: []
      };
    const labels = simplified.labels || consumptionLabels(market);
    const pets = Array.isArray(simplified.pets) ? simplified.pets : [];

    return {
      country: market.country,
      currency: market.currency,
      labels,
      consumption: {
        labels,
        pets
      },
      pets,
      flavor_options: await this.resolveFlavorOptions(market),
      plan_terms: PLAN_TERMS
    };
  }

  async resolveFlavorOptions(market) {
    if (!this.productsRepository || typeof this.productsRepository.listFlavorLabelsByCountry !== 'function') {
      return listFlavorOptions(market);
    }

    try {
      const labels = await this.productsRepository.listFlavorLabelsByCountry(market.country);
      const options = flavorOptionsFromLabels(labels, market);
      return options.length > 0 ? options : listFlavorOptions(market);
    } catch (_error) {
      return listFlavorOptions(market);
    }
  }
}

module.exports = {
  OnboardingPlanSnapshotRepository,
  MARKETS,
  PLAN_TERMS
};
