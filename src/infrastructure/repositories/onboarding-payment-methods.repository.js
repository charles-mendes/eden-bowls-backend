class OnboardingPaymentMethodsRepository {
  async listSavedPaymentMethods(sessionId, context = {}) {
    return [
      {
        id: 'pm_123',
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2028,
        is_default: true
      }
    ];
  }
}

module.exports = {
  OnboardingPaymentMethodsRepository
};
