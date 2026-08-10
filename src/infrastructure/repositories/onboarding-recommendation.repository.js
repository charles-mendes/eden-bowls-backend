class OnboardingRecommendationRepository {
  async getRecommendation(sessionId, context = {}) {
    return {
      session_id: sessionId,
      country: 'US',
      recommendations: [
        {
          pet_id: 'pet-1',
          pet_name: 'Milo',
          energy_kcal_dia: 500,
          quantidade_g_dia: 300,
          porte: 'medium',
          especie: 'dog'
        }
      ],
      packaging: {
        selected_frequency: 'monthly',
        period_days: 30,
        suggested_frequency: 'monthly',
        suggested_period_days: 30,
        package_sizes_grams: [300, 500],
        total_target_grams: 300,
        suggested_bags_by_size: {
          300: 1,
          500: 0
        }
      },
      simplified: {
        country: 'US',
        period_days: 30,
        labels: {
          daily: 'Per day',
          monthly: 'Per month',
          packs: 'Packs'
        },
        pets: [
          {
            pet_id: 'pet-1',
            pet_name: 'Milo',
            daily: { value: 200, unit: 'g', grams: 200, formatted: '200 g' },
            monthly: { value: 6000, unit: 'g', grams: 6000, formatted: '6,000 g' },
            packs: { count: 2, pack_size_grams: 500, pack_size_value: 2, pack_size_unit: 'pack', formatted: '2 packs' }
          }
        ]
      },
      version: 'v1'
    };
  }
}

module.exports = {
  OnboardingRecommendationRepository
};
