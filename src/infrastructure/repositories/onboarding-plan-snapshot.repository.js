const { PLAN_TERMS } = require('../../core/first-purchase-discount');
const {
  allowFlavorCatalogFallback,
  flavorOptionsFromCatalog,
  listFlavorOptions
} = require('../../core/flavors');
const { HttpError } = require('../../core/http-error');
const { MARKETS, resolveMarket } = require('../../core/market');
const { consumptionLabels } = require('../../core/simplified-consumption');

class OnboardingPlanSnapshotRepository {
  constructor(options = {}) {
    this.recommendationRepository = options.recommendationRepository || null;
    this.productsRepository = options.productsRepository || null;
    this.allowCatalogFallback = options.allowCatalogFallback;
  }

  allowsCatalogFallback() {
    if (typeof this.allowCatalogFallback === 'boolean') {
      return this.allowCatalogFallback;
    }
    return allowFlavorCatalogFallback();
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

  publicFlavorOptions(options) {
    return (Array.isArray(options) ? options : []).map((option) => ({
      key: option.key,
      label: option.label
    }));
  }

  emptyCatalogError() {
    return new HttpError(503, 'Flavor catalog is unavailable.', { code: 'catalog_flavors_unavailable' });
  }

  async resolveFlavorOptions(market) {
    const fallback = () => {
      if (!this.allowsCatalogFallback()) {
        throw this.emptyCatalogError();
      }
      return this.publicFlavorOptions(listFlavorOptions(market));
    };

    if (!this.productsRepository) {
      return fallback();
    }

    try {
      let rows = [];
      if (typeof this.productsRepository.listFlavorOptionsByCountry === 'function') {
        rows = await this.productsRepository.listFlavorOptionsByCountry(market.country);
      } else if (typeof this.productsRepository.listFlavorLabelsByCountry === 'function') {
        rows = await this.productsRepository.listFlavorLabelsByCountry(market.country);
      } else {
        return fallback();
      }

      const options = flavorOptionsFromCatalog(rows, market);
      if (options.length > 0) {
        return this.publicFlavorOptions(options);
      }

      return fallback();
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      return fallback();
    }
  }
}

module.exports = {
  OnboardingPlanSnapshotRepository,
  MARKETS,
  PLAN_TERMS
};
