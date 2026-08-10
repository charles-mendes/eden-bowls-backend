const { HttpError } = require('../core/http-error');

class OnboardingPetDeleteService {
  constructor(repository) {
    this.repository = repository;
  }

  async deletePet({ sessionId, petId, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pet delete repository is not available.');
    }

    const result = await this.repository.deletePet(sessionId, petId, { currentUser, sessionToken });

    return {
      success: true,
      data: result
    };
  }
}

module.exports = {
  OnboardingPetDeleteService
};
