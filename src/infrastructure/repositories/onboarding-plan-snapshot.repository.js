const { listFlavorOptions } = require('../../core/flavors');
const { MARKETS, resolveMarket } = require('../../core/market');
const { consumptionLabels } = require('../../core/simplified-consumption');

const PLAN_TERMS = [
  { subscription_term_months: 1, discount_percent: 10 },
  { subscription_term_months: 3, discount_percent: 25 },
  { subscription_term_months: 6, discount_percent: 40 }
];

class OnboardingPlanSnapshotRepository {
  constructor(options = {}) {
    this.recommendationRepository = options.recommendationRepository || null;
  }

  async getSnapshot(userId, marketInput) {
    const market = marketInput && marketInput.country ? marketInput : resolveMarket(marketInput);
    const recommendation = this.recommendationRepository
      ? await this.recommendationRepository.getRecommendation(userId, market)
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
      flavor_options: listFlavorOptions(market),
      plan_terms: PLAN_TERMS
    };
  }
}

module.exports = {
  OnboardingPlanSnapshotRepository,
  MARKETS,
  PLAN_TERMS
};
