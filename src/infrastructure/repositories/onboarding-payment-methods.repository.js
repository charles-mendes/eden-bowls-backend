const { HttpError } = require('../../core/http-error');

class OnboardingPaymentMethodsRepository {
  constructor(options = {}) {
    this.customerStore = options.customerStore || null;
    this.stripeBilling = options.stripeBilling || null;
  }

  async listSavedPaymentMethods(userId) {
    const customerId = this.customerStore ? await this.customerStore.getCustomerId(userId) : '';
    if (!customerId) {
      return [];
    }

    if (!this.stripeBilling) {
      throw new HttpError(503, 'STRIPE_SECRET_KEY is not configured.', { code: 'stripe_secret_missing' });
    }

    return this.stripeBilling.listCardPaymentMethods(customerId);
  }
}

module.exports = {
  OnboardingPaymentMethodsRepository
};
