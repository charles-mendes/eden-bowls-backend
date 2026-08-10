class SubscriptionsEditPreviewRepository {
  async preview(subscriptionId, payload = {}, context = {}) {
    const subscriptionTermMonths = Number(payload.subscription_term_months || 1);

    return {
      subscription_id: subscriptionId,
      expected_current_hash: 'hash-123',
      term_change: subscriptionTermMonths !== 1,
      current: {
        subscription_term_months: 1,
        items: [],
        address: payload.address || {}
      },
      proposed: {
        subscription_term_months: subscriptionTermMonths,
        items: payload.pets || [],
        address: payload.address || {}
      },
      proration: {
        direction: 'none',
        amount_due_now: 0,
        credit_applied: 0,
        currency: 'USD'
      },
      next_cycle: {
        subtotal: 30,
        tax: 0,
        total: 30,
        currency: 'USD'
      },
      discount: {
        eligible: false,
        reason: 'edit_no_first_purchase_promo',
        percent: 0
      }
    };
  }
}

module.exports = {
  SubscriptionsEditPreviewRepository
};
