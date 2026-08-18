const { HttpError } = require('../core/http-error');
const {
  validatePreviewPayload,
  validateSubscriptionTerm
} = require('./onboarding-plan-preview.service');

function withMarket(planSelection, payload, market) {
  return {
    ...planSelection,
    country: market && market.country ? market.country : payload && payload.country,
    currency: market && market.currency ? market.currency : payload && payload.currency,
    updated_at: new Date().toISOString()
  };
}

class OnboardingPlanSelectionService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.planPreviewRepository = options.planPreviewRepository || null;
  }

  async setPlanSelection({ userId, payload, market }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding plan selection repository is not available.');
    }

    if (!userId) {
      return {
        success: true,
        data: {
          plan_selection: withMarket(payload || {}, payload, market)
        }
      };
    }

    if (!this.planPreviewRepository) {
      throw new HttpError(503, 'Onboarding plan preview repository is not available.');
    }

    validateSubscriptionTerm(payload);
    validatePreviewPayload(payload);

    const resolved = await this.planPreviewRepository.previewPlan(userId, payload, market);
    const planSelection = withMarket({
      ...resolved,
      pets: Array.isArray(payload && payload.pets) ? payload.pets : resolved.pets,
      catalog_pricing: resolved.catalog_pricing,
      flavors_by_pet: resolved.flavors_by_pet,
      validated_with: resolved.validated_with
    }, payload, market);

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
