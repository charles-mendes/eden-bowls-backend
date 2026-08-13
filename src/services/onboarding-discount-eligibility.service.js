const { HttpError } = require('../core/http-error');

class OnboardingDiscountEligibilityService {
  constructor(repository) {
    this.repository = repository;
  }

  async getEligibility({ userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding discount eligibility repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.getEligibility(userId);
    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingDiscountEligibilityService
};