const { HttpError } = require('../core/http-error');

class OnboardingPetsService {
  constructor(repository) {
    this.repository = repository;
  }

  async listPets({ userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pets repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.listPets(userId);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingPetsService
};
