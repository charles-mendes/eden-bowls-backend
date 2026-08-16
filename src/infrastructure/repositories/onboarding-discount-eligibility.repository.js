class OnboardingDiscountEligibilityRepository {
  async getEligibility(userId) {
    if (!userId) {
      return {
        validated: false,
        eligible: null,
        reason: 'NOT_AUTHENTICATED'
      };
    }

    return {
      validated: true,
      eligible: true,
      reason: null
    };
  }
}

module.exports = {
  OnboardingDiscountEligibilityRepository
};