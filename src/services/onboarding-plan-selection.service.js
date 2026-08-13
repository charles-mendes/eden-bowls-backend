const { HttpError } = require('../core/http-error');

class OnboardingPlanSelectionService {
  constructor(repository) {
    this.repository = repository;
  }

  async setPlanSelection({ userId, payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding plan selection repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.setPlanSelection(userId, payload);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingPlanSelectionService
};
