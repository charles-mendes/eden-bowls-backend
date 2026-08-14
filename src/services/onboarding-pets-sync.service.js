const { HttpError } = require('../core/http-error');

class OnboardingPetsSyncService {
  constructor(repository) {
    this.repository = repository;
  }

  async syncPets({ userId, payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pets sync repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.syncPets(userId, payload.pets);
    return { success: true, data };
  }
}

module.exports = {
  OnboardingPetsSyncService
};