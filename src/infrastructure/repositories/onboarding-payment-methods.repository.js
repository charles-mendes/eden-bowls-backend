const { HttpError } = require('../../core/http-error');
const { resolveStripeAccountFromCountry, STRIPE_ACCOUNTS } = require('../../core/stripe-account');
const { resolveStripeBilling } = require('../../infrastructure/stripe/stripe-accounts');

class OnboardingPaymentMethodsRepository {
  constructor(options = {}) {
    this.customerStore = options.customerStore || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.stripeBrEnabled = options.stripeBrEnabled;
  }

  async listSavedPaymentMethods(userId, { country } = {}) {
    let stripeAccount = STRIPE_ACCOUNTS.US;
    try {
      stripeAccount = resolveStripeAccountFromCountry(country || 'US');
    } catch {
      stripeAccount = STRIPE_ACCOUNTS.US;
    }

    if (stripeAccount === STRIPE_ACCOUNTS.BR && this.stripeBrEnabled === false) {
      return [];
    }

    const customerId = this.customerStore ? await this.customerStore.getCustomerId(userId, stripeAccount) : '';
    if (!customerId) {
      return [];
    }

    const stripeBilling = resolveStripeBilling(this, stripeAccount);
    return stripeBilling.listCardPaymentMethods(customerId);
  }
}

module.exports = {
  OnboardingPaymentMethodsRepository
};
