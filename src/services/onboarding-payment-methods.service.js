const { HttpError } = require('../core/http-error');

class OnboardingPaymentMethodsService {
  constructor(repository) {
    this.repository = repository;
  }

  async listSavedPaymentMethods({ userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding payment methods repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.listSavedPaymentMethods(userId);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingPaymentMethodsService
};
