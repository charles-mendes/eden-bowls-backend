const { HttpError } = require('../../core/http-error');
const { discountAmountFromSubtotal } = require('../../core/first-purchase-discount');

function parseJsonColumn(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return null;
  }
}

class OnboardingSubscriptionCheckoutRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async getPlanSelection(userId) {
    this.ensureDataSource();

    const rows = await this.dataSource.query(
      `SELECT \`plan_selection\` FROM \`${this.tableName}\` WHERE \`user_id\` = ? LIMIT 1`,
      [userId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return parseJsonColumn(row && row.plan_selection);
  }

  async checkout(userId, payload = {}) {
    this.ensureDataSource();

    const billing = payload.billing || {};
    const paymentMethodId = payload.payment_method_id || payload.paymentMethodId || '';
    const checkoutMode = payload.checkout_mode || payload.flow || 'order_first';
    const appliedPercent = Number(payload.discount_applied_percent) || 0;
    const promotionCodeId = payload.stripe_promotion_code_id || null;
    const subtotal = 25;
    const checkout = {
      order_id: 101,
      order_key: 'order-key',
      status: 'pending',
      total: 29.99,
      subtotal,
      product_tax: 2.5,
      shipping_total: 2.49,
      shipping_tax: 0.25,
      shipping_total_with_tax: 2.74,
      currency: 'USD',
      payment_url: paymentMethodId ? 'https://checkout.stripe.test/pay' : undefined,
      subscription_ids: [1],
      flexible_subscription_id: 7,
      stripe_subscription_id: checkoutMode === 'subscription_first' ? 'sub_123' : 'sub_456',
      stripe_client_secret: checkoutMode === 'subscription_first' ? 'secret_123' : undefined,
      payment_state: paymentMethodId ? 'requires_confirmation' : 'requires_payment_method',
      has_payment_method: Boolean(paymentMethodId),
      reused: false,
      billing: {
        first_name: billing.first_name || '',
        last_name: billing.last_name || '',
        email: billing.email || '',
        phone: billing.phone || '',
        company: billing.company || ''
      },
      checkout_mode: checkoutMode,
      checkout_trace_id: 'trace-123',
      discount_eligibility: payload.discount_eligibility || null,
      discount_applied_percent: appliedPercent,
      stripe_promotion_code_id: promotionCodeId,
      stripe_coupon_id: payload.stripe_coupon_id || null,
      stripe_discount_percent: appliedPercent,
      stripe_discount_amount: discountAmountFromSubtotal(subtotal, appliedPercent),
      stripe_discount_duration: payload.stripe_discount_duration || null,
      discounts: promotionCodeId ? [{ promotion_code: promotionCodeId }] : []
    };

    const planSelection = payload.plan_selection || null;
    if (planSelection) {
      await this.dataSource.query(
        `INSERT INTO \`${this.tableName}\` (\`user_id\`, \`checkout_reference\`, \`plan_selection\`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE \`checkout_reference\` = VALUES(\`checkout_reference\`), \`plan_selection\` = VALUES(\`plan_selection\`)`,
        [userId, JSON.stringify(checkout), JSON.stringify(planSelection)]
      );
    } else {
      await this.dataSource.query(
        `INSERT INTO \`${this.tableName}\` (\`user_id\`, \`checkout_reference\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`checkout_reference\` = VALUES(\`checkout_reference\`)`,
        [userId, JSON.stringify(checkout)]
      );
    }

    return checkout;
  }
}

module.exports = {
  OnboardingSubscriptionCheckoutRepository
};
