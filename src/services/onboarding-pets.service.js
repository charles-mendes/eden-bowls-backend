const { HttpError } = require('../core/http-error');

class OnboardingPetsService {
  constructor(repository) {
    this.repository = repository;
  }

  async listPets({ sessionId, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pets repository is not available.');
    }

    const data = await this.repository.listPets(sessionId, { currentUser, sessionToken });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingPetsService
};
