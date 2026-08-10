class OnboardingPlanSelectionRepository {
  async setPlanSelection(sessionId, payload = {}, context = {}) {
    return {
      session_id: sessionId,
      plan_selection: {
        subscription_term_months: payload.subscription_term_months || 1,
        catalog_pricing: {
          source: 'custom_meal_plan_builder',
          country: 'US',
          currency: 'USD',
          line_items: [
            {
              pet_id: 'pet-1',
              flavor: 'chicken',
              quantity: 2,
              unit_price: 10,
              line_total: 20
            }
          ],
          subtotal: 20,
          discounted_first_month_total: 20
        },
        flavors_by_pet: [
          { pet_id: 'pet-1', flavors: ['chicken'] }
        ],
        pets: [
          { pet_id: 'pet-1', pet_name: 'Milo', enabled: true }
        ],
        validated_with: {
          recommendation_version: 'v1',
          validated_at: '2026-08-09T00:00:00.000Z'
        },
        updated_at: '2026-08-09T00:00:00.000Z'
      }
    };
  }
}

module.exports = {
  OnboardingPlanSelectionRepository
};
