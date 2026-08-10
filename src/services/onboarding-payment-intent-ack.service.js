const { HttpError } = require('../core/http-error');

class OnboardingPaymentIntentAckService {
  constructor(repository) {
    this.repository = repository;
  }

  async acknowledge({ sessionId, payload, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding payment intent ack repository is not available.');
    }

    const result = await this.repository.acknowledge(sessionId, payload, { currentUser, sessionToken });

    return {
      success: true,
      data: result
    };
  }
}

module.exports = {
  OnboardingPaymentIntentAckService
};
