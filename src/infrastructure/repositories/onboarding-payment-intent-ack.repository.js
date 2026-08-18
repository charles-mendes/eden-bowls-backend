const { HttpError } = require('../../core/http-error');

class OnboardingPaymentIntentAckRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
  }

  async acknowledge(userId, payload = {}) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

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

    const rows = await this.dataSource.query(
      `SELECT \`checkout_reference\` FROM \`${this.tableName}\` WHERE \`user_id\` = ? LIMIT 1`,
      [userId]
    );
    const checkout = this.parseJson(Array.isArray(rows) && rows[0] ? rows[0].checkout_reference : null);
    const expectedPaymentIntentId = String(checkout && (checkout.stripe_payment_intent_id || checkout.payment_intent_id) || '').trim();

    if (expectedPaymentIntentId && expectedPaymentIntentId !== paymentIntentId) {
      throw new HttpError(409, 'Payment intent does not match the checkout.', { code: 'payment_intent_mismatch' });
    }

    const paidStatuses = ['succeeded', 'processing', 'requires_capture'];
    const updatedCheckout = {
      ...(checkout || {}),
      stripe_payment_intent_id: paymentIntentId,
      stripe_payment_intent_status: paymentIntentStatus,
      payment_state: paidStatuses.includes(paymentIntentStatus) ? 'paid' : 'pending',
      payment_acknowledged_at: new Date().toISOString()
    };
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`checkout_reference\` = ? WHERE \`user_id\` = ?`,
      [JSON.stringify(updatedCheckout), userId]
    );

    return {
      order_id: Number(updatedCheckout.order_id || 0),
      stripe_payment_intent_id: paymentIntentId,
      stripe_payment_intent_status: paymentIntentStatus,
      payment_state: updatedCheckout.payment_state,
      acked: true
    };
  }

  parseJson(value) {
    if (!value) {
      return null;
    }
    if (typeof value === 'object') {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}

module.exports = {
  OnboardingPaymentIntentAckRepository
};
