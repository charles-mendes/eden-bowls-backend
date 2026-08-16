const { resolveMarket } = require('../../core/market');

class OnboardingPlanPreviewRepository {
  async previewPlan(userId, payload = {}, marketInput) {
    const market = marketInput && marketInput.country ? marketInput : resolveMarket(marketInput);
    const currency = market.currency;

    return {
      subscription_term_months: payload.subscription_term_months || 1,
      country: market.country,
      currency,
      totals: {
        grand_total: 20,
        grand_total_monthly: 20,
        first_month_total: 20
      },
      pricing: {
        grand_total: 20,
        grand_total_monthly: 20,
        first_month_total: 20
      },
      grand_total: 20,
      grand_total_monthly: 20,
      first_month_total: 20,
      pets: [
        {
          pet_id: 'pet-1',
          pet_name: 'Milo',
          monthly_total: 20,
          total: 20,
          first_month_total: 20
        }
      ],
      line_items: [
        {
          pet_id: 'pet-1',
          pet_name: 'Milo',
          flavor: 'chicken',
          quantity: 2,
          pack_size_grams: 500,
          pack_size_label: '500 g',
          variation_id: 100,
          product_id: 200,
          currency,
          unit_price: 10,
          line_total: 20
        }
      ]
    };
  }
}

module.exports = {
  OnboardingPlanPreviewRepository
};
