class OnboardingPetUpdateRepository {
  async updatePet(sessionId, petId, payload = {}, context = {}) {
    return {
      session: { session_id: sessionId, pets: [] },
      pet: {
        id: petId,
        name: payload.name || 'Milo',
        breed: payload.breed || 'Labrador',
        type: 'dog',
        age_years: payload.age_years ?? 3,
        age_months: payload.age_months ?? 0,
        age: payload.age_years ?? 3,
        weight_input: payload.weight ?? 12,
        weight_unit: payload.weight_unit || 'kg',
        weight_kg: payload.weight ?? 12,
        weight: payload.weight ?? 12,
        size: payload.size || 'large',
        activity_level: payload.activity_level || 'high',
        pet_condition: payload.pet_condition || 'ideal',
        neutered: payload.neutered ?? true,
        image_url: ''
      }
    };
  }
}

module.exports = {
  OnboardingPetUpdateRepository
};
