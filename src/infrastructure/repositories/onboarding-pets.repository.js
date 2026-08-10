class OnboardingPetsRepository {
  async listPets(sessionId, context = {}) {
    return {
      session_id: sessionId,
      pets: [
        {
          id: 'pet-1',
          name: 'Milo',
          breed: 'Labrador',
          age_years: 2,
          age_months: 0,
          age: 2,
          weight_input: 10,
          weight_unit: 'kg',
          weight_kg: 10,
          weight: 10,
          size: 'large',
          activity_level: 'high',
          pet_condition: 'ideal',
          neutered: true,
          image_url: ''
        }
      ]
    };
  }
}

module.exports = {
  OnboardingPetsRepository
};
