const { HttpError } = require('../core/http-error');

class OnboardingRecommendationService {
  constructor(repository) {
    this.repository = repository;
  }

  async getRecommendation({ userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding recommendation repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.getRecommendation(userId);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingRecommendationService
};
