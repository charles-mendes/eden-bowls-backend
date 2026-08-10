const { HttpError } = require('../core/http-error');

class OnboardingPetCreateService {
  constructor(repository) {
    this.repository = repository;
  }

  async createPet({ sessionId, payload, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pet create repository is not available.');
    }

    const result = await this.repository.createPet(sessionId, payload, { currentUser, sessionToken });

    return {
      success: true,
      data: result
    };
  }
}

module.exports = {
  OnboardingPetCreateService
};
