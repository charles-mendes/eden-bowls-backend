const { HttpError } = require('../core/http-error');

class OnboardingPlanSelectionService {
  constructor(repository) {
    this.repository = repository;
  }

  async setPlanSelection({ userId, payload, market }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding plan selection repository is not available.');
    }

    const planSelection = {
      ...(payload || {}),
      country: market && market.country ? market.country : payload && payload.country,
      currency: market && market.currency ? market.currency : payload && payload.currency,
      updated_at: new Date().toISOString()
    };

    if (!userId) {
      return {
        success: true,
        data: {
          plan_selection: planSelection
        }
      };
    }

    const data = await this.repository.setPlanSelection(userId, planSelection);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingPlanSelectionService
};
