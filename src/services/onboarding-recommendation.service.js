const { HttpError } = require('../core/http-error');

class OnboardingRecommendationService {
  constructor(repository) {
    this.repository = repository;
  }

  async getRecommendation({ userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding recommendation repository is not available.');
    }

    const data = await this.repository.getRecommendation(userId || null);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingRecommendationService
};
