const { HttpError } = require('../core/http-error');
const crypto = require('crypto');

class OnboardingPetCreateService {
  constructor(repository) {
    this.repository = repository;
  }

  async createPet({ userId, payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pet create repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const result = await this.repository.createPet(userId, crypto.randomUUID(), payload);

    return {
      success: true,
      data: result
    };
  }
}

module.exports = {
  OnboardingPetCreateService
};
