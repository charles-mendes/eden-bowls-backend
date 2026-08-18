const { toIsoDate } = require('../../core/stripe-subscription-map');
const { mapLedgerToDashboardDetail } = require('../../core/subscription-dashboard');

class SubscriptionsDetailRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.stripeBilling = options.stripeBilling || null;
  }

  async getDetail(userId, subscriptionId) {
    if (!this.ledgerRepository) {
      return null;
    }

    let row = await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
    if (!row) {
      return null;
    }

    if ((!row.petsSnapshot || !row.planSelection || !row.address) && this.ledgerRepository.findUserStateByUserId) {
      const state = await this.ledgerRepository.findUserStateByUserId(userId);
      if (state) {
        row = {
          ...row,
          petsSnapshot: row.petsSnapshot,
          planSelection: row.planSelection || state.planSelection,
          address: row.address || state.address,
          shipping: row.shipping || state.shipping
        };
      }
    }

    const extras = {
      paymentMethodBrand: row.paymentMethodBrand,
      paymentMethodLast4: row.paymentMethodLast4,
      billingHistory: [],
      stripeTimeline: []
    };

    if (this.stripeBilling && this.stripeBilling.retrieveSubscription) {
      try {
        const subscription = await this.stripeBilling.retrieveSubscription(subscriptionId);
        const pm = subscription.default_payment_method && typeof subscription.default_payment_method === 'object'
          ? subscription.default_payment_method.card || {}
          : {};
        if (pm.last4) {
          extras.paymentMethodLast4 = String(pm.last4);
        }
        if (pm.brand) {
          extras.paymentMethodBrand = String(pm.brand);
        }
      } catch (_error) {
        // ledger remains the source of truth
      }
    }

    if (this.stripeBilling && this.stripeBilling.listInvoicesForSubscription) {
      try {
        const invoices = await this.stripeBilling.listInvoicesForSubscription(subscriptionId);
        extras.billingHistory = invoices.map((invoice) => ({
          order_id: 0,
          invoice_id: invoice.id,
          date: toIsoDate(invoice.created),
          amount: Number(((invoice.amount_paid || invoice.total || 0) / 100).toFixed(2)),
          currency: String(invoice.currency || 'usd').toUpperCase(),
          status: String(invoice.status || ''),
          items: []
        }));
      } catch (_error) {
        extras.billingHistory = [];
      }
    }

    return {
      subscription: mapLedgerToDashboardDetail(row, extras)
    };
  }
}

module.exports = {
  SubscriptionsDetailRepository
};
