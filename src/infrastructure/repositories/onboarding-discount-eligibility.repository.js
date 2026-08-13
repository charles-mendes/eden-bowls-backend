class OnboardingDiscountEligibilityRepository {
  async getEligibility(userId) {
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