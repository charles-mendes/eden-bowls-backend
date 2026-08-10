class OnboardingShippingSelectRepository {
  async selectShipping(sessionId, shipping, context = {}) {
    return {
      session_id: sessionId,
      shipping,
      subtotal: 20,
      product_tax: 2,
      product_tax_percent: 10,
      tax_jurisdiction: 'US-CA'
    };
  }
}

module.exports = {
  OnboardingShippingSelectRepository
};
