const { MARKETS, formatMass, formatPacks, resolveMarket } = require('../../core/market');

function buildConsumptionPet(market) {
  return {
    pet_id: 'pet-1',
    pet_name: 'Milo',
    daily: { value: 200, unit: 'g', grams: 200, formatted: formatMass(200, market) },
    monthly: { value: 6000, unit: 'g', grams: 6000, formatted: formatMass(6000, market) },
    packs: {
      count: 2,
      pack_size_grams: 500,
      pack_size_value: 2,
      pack_size_unit: 'pack',
      formatted: formatPacks(2, market)
    }
  };
}

class OnboardingPlanSnapshotRepository {
  async getSnapshot(userId, marketInput) {
    const market = marketInput && marketInput.country ? marketInput : resolveMarket(marketInput);
    const pet = buildConsumptionPet(market);

    return {
      country: market.country,
      currency: market.currency,
      labels: market.labels,
      consumption: {
        labels: market.labels,
        pets: [pet]
      },
      pets: [pet],
      flavor_options: [
        { key: 'chicken', label: market.flavorLabels.chicken }
      ],
      plan_terms: [
        { subscription_term_months: 1, discount_percent: 10 },
        { subscription_term_months: 3, discount_percent: 25 },
        { subscription_term_months: 6, discount_percent: 40 }
      ]
    };
  }
}

module.exports = {
  OnboardingPlanSnapshotRepository,
  MARKETS
};
