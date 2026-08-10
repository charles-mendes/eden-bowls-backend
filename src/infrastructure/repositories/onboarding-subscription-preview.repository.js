class OnboardingSubscriptionPreviewRepository {
  async getFallbackPriceIds(sessionId, payload = {}, context = {}) {
    return ['price_456'];
  }

  async preview(sessionId, payload = {}, context = {}) {
    return {
      subtotal: 25,
      tax: 2.5,
      total: 27.5,
      currency: 'usd'
    };
  }
}

module.exports = {
  OnboardingSubscriptionPreviewRepository
};
