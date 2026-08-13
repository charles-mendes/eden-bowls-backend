const { HttpError } = require('../core/http-error');

class OnboardingPlanPreviewService {
  constructor(repository) {
    this.repository = repository;
  }

  async previewPlan({ userId, payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding plan preview repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.previewPlan(userId, payload);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingPlanPreviewService
};
