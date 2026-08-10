class OnboardingPetCreateRepository {
  async createPet(sessionId, payload = {}) {
    return {
      session: { session_id: sessionId, pets: [] },
      pet: {
        id: 'pet-1',
        name: payload.name || 'Pet',
        breed: payload.breed || 'Unknown',
        type: 'dog',
        age_years: Number(payload.ageYears || 0),
        age_months: Number(payload.ageMonths || 0),
        age: Number(payload.ageYears || 0),
        weight_input: Number(payload.weight || 0),
        weight_unit: payload.weightUnit || 'kg',
        weight_kg: Number(payload.weight || 0),
        weight: Number(payload.weight || 0),
        size: payload.size || 'medium',
        activity_level: payload.activityLevel || 'medium',
        pet_condition: payload.petCondition || 'ideal',
        neutered: Boolean(payload.neutered),
        image_url: ''
      }
    };
  }
}

module.exports = {
  OnboardingPetCreateRepository
};
