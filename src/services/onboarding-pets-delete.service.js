const { HttpError } = require('../core/http-error');

class OnboardingPetDeleteService {
  constructor(repository) {
    this.repository = repository;
  }

  async deletePet({ userId, petId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pet delete repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const deletedAt = new Date().toISOString();
    const result = await this.repository.deletePet(userId, petId, deletedAt);
    if (!result) {
      throw new HttpError(404, 'Pet not found.', { code: 'pet_not_found' });
    }

    return {
      success: true,
      data: result
    };
  }
}

module.exports = {
  OnboardingPetDeleteService
};
