const { HttpError } = require('../../core/http-error');

class OnboardingPaymentIntentAckRepository {
  constructor() {
    this.sessionTableName = 'wp_hsr_onboarding_sessions';
  }

  async acknowledge(sessionId, payload = {}, context = {}) {
    const paymentIntentId = String(payload.paymentIntentId || '').trim();
    const paymentIntentStatus = String(payload.paymentIntentStatus || '').trim();

    if (!paymentIntentId.startsWith('pi_')) {
      throw new HttpError(422, 'Invalid payment intent id.', { code: 'invalid_payment_intent_id' });
    }

    const allowedStatuses = [
      'succeeded',
      'processing',
      'requires_capture',
      'requires_payment_method',
      'requires_action',
      'requires_confirmation',
      'canceled'
    ];

    if (!allowedStatuses.includes(paymentIntentStatus)) {
      throw new HttpError(422, 'Invalid payment intent status.', { code: 'invalid_payment_intent_status' });
    }

    return {
      orderId: 42,
      stripePaymentIntentId: paymentIntentId,
      stripePaymentIntentStatus: paymentIntentStatus,
      paymentState: paymentIntentStatus === 'succeeded' || paymentIntentStatus === 'processing' ? 'paid' : 'pending',
      acked: true
    };
  }
}

module.exports = {
  OnboardingPaymentIntentAckRepository
};
