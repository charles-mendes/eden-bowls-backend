const { HttpError } = require('../core/http-error');

class OnboardingPaymentMethodsService {
  constructor(repository) {
    this.repository = repository;
  }

  async listSavedPaymentMethods({ sessionId, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding payment methods repository is not available.');
    }

    const data = await this.repository.listSavedPaymentMethods(sessionId, { currentUser, sessionToken });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingPaymentMethodsService
};
