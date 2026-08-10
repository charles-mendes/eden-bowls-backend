const { HttpError } = require('../core/http-error');

class OnboardingPlanSelectionService {
  constructor(repository) {
    this.repository = repository;
  }

  async setPlanSelection({ sessionId, payload, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding plan selection repository is not available.');
    }

    const data = await this.repository.setPlanSelection(sessionId, payload, { currentUser, sessionToken });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingPlanSelectionService
};
