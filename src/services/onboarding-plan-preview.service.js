const { HttpError } = require('../core/http-error');

class OnboardingPlanPreviewService {
  constructor(repository) {
    this.repository = repository;
  }

  async previewPlan({ sessionId, payload, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding plan preview repository is not available.');
    }

    const data = await this.repository.previewPlan(sessionId, payload, { currentUser, sessionToken });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingPlanPreviewService
};
