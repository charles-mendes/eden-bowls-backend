const { HttpError } = require('../core/http-error');

class OnboardingPaymentIntentAckService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.authService = options.authService || null;
  }

  async acknowledge({ userId, payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding payment intent ack repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    if (!this.authService) {
      throw new HttpError(503, 'Auth service is not available for critical operations.');
    }

    await this.authService.assertCriticalOperationAllowed(userId);

    const result = await this.repository.acknowledge(userId, payload);

    return {
      success: true,
      data: result
    };
  }
}

module.exports = {
  OnboardingPaymentIntentAckService
};
