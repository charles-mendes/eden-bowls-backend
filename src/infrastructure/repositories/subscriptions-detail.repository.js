const { toIsoDate } = require('../../core/stripe-subscription-map');
const { mapLedgerToDashboardDetail } = require('../../core/subscription-dashboard');
const { ledgerStripeAccount } = require('../../core/stripe-account');
const { resolveStripeBilling } = require('../stripe/stripe-accounts');

class SubscriptionsDetailRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.upsShipmentRepository = options.upsShipmentRepository || null;
    this.productsRepository = options.productsRepository || null;
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
      stripeTimeline: [],
      catalogFlavorOptions: []
    };

    if (this.productsRepository && typeof this.productsRepository.listFlavorOptionsByCountry === 'function') {
      try {
        const country = ledgerStripeAccount(row) === 'br' ? 'BR' : 'US';
        extras.catalogFlavorOptions = await this.productsRepository.listFlavorOptionsByCountry(country);
      } catch (_error) {
        extras.catalogFlavorOptions = [];
      }
    }

    let stripeBilling = this.stripeBilling;
    try {
      stripeBilling = resolveStripeBilling(this, ledgerStripeAccount(row));
    } catch (_error) {
      stripeBilling = this.stripeBilling;
    }

    if (stripeBilling && stripeBilling.retrieveSubscription) {
      try {
        const subscription = await stripeBilling.retrieveSubscription(subscriptionId);
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

    if (stripeBilling && stripeBilling.listInvoicesForSubscription) {
      try {
        const invoices = await stripeBilling.listInvoicesForSubscription(subscriptionId);
        let shipmentByInvoice = new Map();
        if (this.upsShipmentRepository && typeof this.upsShipmentRepository.listByInvoiceIds === 'function') {
          const shipments = await this.upsShipmentRepository.listByInvoiceIds(
            invoices.map((invoice) => invoice.id)
          );
          shipmentByInvoice = new Map(
            shipments.map((shipment) => [String(shipment.stripe_invoice_id), shipment])
          );
        }
        extras.billingHistory = invoices.map((invoice) => {
          const shipment = shipmentByInvoice.get(String(invoice.id));
          return {
            order_id: 0,
            invoice_id: invoice.id,
            date: toIsoDate(invoice.created),
            amount: Number(((invoice.amount_paid || invoice.total || 0) / 100).toFixed(2)),
            currency: String(invoice.currency || 'usd').toUpperCase(),
            status: String(invoice.status || ''),
            items: [],
            tracking_number: shipment?.tracking_number || null,
            shipped_at: shipment?.shipped_at || null
          };
        });
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
