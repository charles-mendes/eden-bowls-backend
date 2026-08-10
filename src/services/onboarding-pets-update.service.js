const { HttpError } = require('../core/http-error');

class OnboardingPetUpdateService {
  constructor(repository) {
    this.repository = repository;
  }

  async updatePet({ sessionId, petId, payload, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pet update repository is not available.');
    }

    const result = await this.repository.updatePet(sessionId, petId, payload, { currentUser, sessionToken });

    return {
      success: true,
      data: result
    };
  }
}

module.exports = {
  OnboardingPetUpdateService
};
