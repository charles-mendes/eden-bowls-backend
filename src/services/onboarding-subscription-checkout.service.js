const { HttpError } = require('../core/http-error');

function getPaymentMethodId(payload = {}) {
  return payload.payment_method_id || payload.paymentMethodId || '';
}

function getCheckoutMode(payload = {}) {
  return payload.checkout_mode || payload.flow || 'order_first';
}

class OnboardingSubscriptionCheckoutService {
  constructor(repository) {
    this.repository = repository;
  }

  async checkout({ sessionId, payload = {}, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding subscription checkout repository is not available.');
    }

    const paymentMethodId = getPaymentMethodId(payload);
    const checkoutMode = getCheckoutMode(payload);
    const billing = payload.billing || {};

    const data = await this.repository.checkout(sessionId, {
      ...payload,
      payment_method_id: paymentMethodId,
      paymentMethodId,
      checkout_mode: checkoutMode,
      billing
    }, { currentUser, sessionToken });

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
