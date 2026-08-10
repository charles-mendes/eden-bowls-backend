class OnboardingSubscriptionCheckoutRepository {
  async checkout(sessionId, payload = {}, context = {}) {
    const billing = payload.billing || {};
    const paymentMethodId = payload.payment_method_id || payload.paymentMethodId || '';
    const checkoutMode = payload.checkout_mode || payload.flow || 'order_first';

    return {
      session_id: sessionId,
      order_id: 101,
      order_key: 'order-key',
      status: 'pending',
      total: 29.99,
      subtotal: 25,
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
      checkout_trace_id: 'trace-123'
    };
  }
}

module.exports = {
  OnboardingSubscriptionCheckoutRepository
};
