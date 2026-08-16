const { HttpError } = require('../core/http-error');

class OnboardingDiscountEligibilityService {
  constructor(repository) {
    this.repository = repository;
  }

  async getEligibility({ userId, market }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding discount eligibility repository is not available.');
    }

    const data = await this.repository.getEligibility(userId || null);
    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingDiscountEligibilityService
};