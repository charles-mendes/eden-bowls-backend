const { HttpError } = require('../core/http-error');

function getPaymentMethodId(payload = {}) {
  return payload.payment_method_id || payload.paymentMethodId || '';
}

function getCheckoutMode(payload = {}) {
  return payload.checkout_mode || payload.flow || 'order_first';
}

class OnboardingSubscriptionCheckoutService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.authService = options.authService || null;
  }

  async checkout({ userId, payload = {} }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding subscription checkout repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    if (!this.authService) {
      throw new HttpError(503, 'Auth service is not available for critical operations.');
    }

    await this.authService.assertCriticalOperationAllowed(userId);

    const paymentMethodId = getPaymentMethodId(payload);
    const checkoutMode = getCheckoutMode(payload);
    const billing = payload.billing || {};

    const data = await this.repository.checkout(userId, {
      ...payload,
      payment_method_id: paymentMethodId,
      paymentMethodId,
      checkout_mode: checkoutMode,
      billing
    });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingSubscriptionCheckoutService,
  getPaymentMethodId,
  getCheckoutMode
};
