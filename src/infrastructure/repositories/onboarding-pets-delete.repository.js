class OnboardingPetDeleteRepository {
  async deletePet(sessionId, petId, context = {}) {
    return {
      session: { session_id: sessionId, pets: [] },
      removed_pet: {
        id: petId,
        deleted_at: '2026-08-09T00:00:00.000Z',
        deleted_by_user_id: context.currentUser && context.currentUser.id ? context.currentUser.id : 1,
        deleted_reason: 'user_request'
      }
    };
  }
}

module.exports = {
  OnboardingPetDeleteRepository
};
