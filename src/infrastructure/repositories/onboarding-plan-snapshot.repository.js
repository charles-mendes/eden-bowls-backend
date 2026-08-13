class OnboardingPlanSnapshotRepository {
  async getSnapshot(userId) {
    return {
      country: 'US',
      currency: 'USD',
      labels: {
        daily: 'Per day',
        monthly: 'Per month',
        packs: 'Packs'
      },
      consumption: {
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
      pets: [
        {
          pet_id: 'pet-1',
          pet_name: 'Milo',
          daily: { value: 200, unit: 'g', grams: 200, formatted: '200 g' },
          monthly: { value: 6000, unit: 'g', grams: 6000, formatted: '6,000 g' },
          packs: { count: 2, pack_size_grams: 500, pack_size_value: 2, pack_size_unit: 'pack', formatted: '2 packs' }
        }
      ],
      flavor_options: [
        { key: 'chicken', label: 'Chicken' }
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
  OnboardingPlanSnapshotRepository
};
