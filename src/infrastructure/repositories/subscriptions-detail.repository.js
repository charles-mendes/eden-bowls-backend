const { deliveryTimeline } = require('../../core/delivery-timeline');
const { activeCourierDelivery, courierTimeline } = require('../../core/courier-timeline');
const { isChargedDeliveryInvoice } = require('../../core/contract-deliveries');
const { upsTrackingUrl } = require('../../core/ups-tracking');
const { toIsoDate } = require('../../core/stripe-subscription-map');
const { mapLedgerToDashboardDetail } = require('../../core/subscription-dashboard');
const { ledgerStripeAccount } = require('../../core/stripe-account');
const { dashboardPlanNotice } = require('../../core/plan-notice');
const { resolveStripeBilling } = require('../stripe/stripe-accounts');

// Moving the next charge date sets trial_end, and Stripe answers with a paid R$ 0 subscription_update invoice.
// Nothing was charged or ordered, so it stays out of the billing history.
function isTrialMoveInvoice(invoice) {
  return String(invoice.billing_reason || '') === 'subscription_update' && !(Number(invoice.total) > 0);
}

function invoicePaidAt(invoice) {
  const paidAt = invoice.status_transitions && invoice.status_transitions.paid_at;
  const seconds = Number(paidAt || invoice.created || 0);
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

// A Brazil plan is delivered by courier (courier-delivery). The store only gets the stages and the link:
// never the method, cost, note, failure reason or staff.
function courierFields(invoice, rows) {
  if (invoice.status !== 'paid' || !isChargedDeliveryInvoice(invoice)) {
    return { tracking_url: null, out_for_delivery_at: null, delivered_at: null, delivery_timeline: null };
  }
  const active = activeCourierDelivery(rows);
  const timeline = courierTimeline(rows, { paidAt: invoicePaidAt(invoice) });
  return {
    tracking_url: active ? active.tracking_url || null : null,
    out_for_delivery_at: timeline.stages[1].at,
    delivered_at: timeline.stages[2].at,
    delivery_timeline: timeline
  };
}

class SubscriptionsDetailRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.settingsRepository = options.settingsRepository || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.upsShipmentRepository = options.upsShipmentRepository || null;
    this.courierDeliveryRepository = options.courierDeliveryRepository || null;
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
        const invoices = (await stripeBilling.listInvoicesForSubscription(subscriptionId))
          .filter((invoice) => !isTrialMoveInvoice(invoice));
        let shipmentByInvoice = new Map();
        if (this.upsShipmentRepository && typeof this.upsShipmentRepository.listByInvoiceIds === 'function') {
          const shipments = await this.upsShipmentRepository.listByInvoiceIds(
            invoices.map((invoice) => invoice.id)
          );
          shipmentByInvoice = new Map(
            shipments.map((shipment) => [String(shipment.stripe_invoice_id), shipment])
          );
        }
        // The delivery address decides, as on the admin detail: Brazil goes by courier, the US by UPS.
        const byCourier = String((row.address && row.address.country) || '').toUpperCase() === 'BR';
        const courierByInvoice = new Map();
        if (byCourier && this.courierDeliveryRepository && typeof this.courierDeliveryRepository.listByInvoiceIds === 'function') {
          for (const courierRow of await this.courierDeliveryRepository.listByInvoiceIds(invoices.map((invoice) => invoice.id))) {
            const key = String(courierRow.stripe_invoice_id);
            courierByInvoice.set(key, [...(courierByInvoice.get(key) || []), courierRow]);
          }
        }
        extras.billingHistory = invoices.map((invoice) => {
          const shipment = shipmentByInvoice.get(String(invoice.id));
          const courier = byCourier && this.courierDeliveryRepository
            ? courierFields(invoice, courierByInvoice.get(String(invoice.id)) || [])
            : null;
          return {
            order_id: 0,
            invoice_id: invoice.id,
            date: toIsoDate(invoice.created),
            amount: Number(((invoice.amount_paid || invoice.total || 0) / 100).toFixed(2)),
            currency: String(invoice.currency || 'usd').toUpperCase(),
            status: String(invoice.status || ''),
            items: [],
            tracking_number: shipment?.tracking_number || null,
            tracking_url: upsTrackingUrl(shipment?.tracking_number),
            tracking_status: shipment?.tracking_status || null,
            tracking_description: shipment?.tracking_description || null,
            label_created_at: shipment?.shipped_at || null,
            in_transit_at: shipment?.in_transit_at || null,
            out_for_delivery_at: shipment?.out_for_delivery_at || null,
            delivered_at: shipment?.delivered_at || null,
            shipped_at: shipment?.shipped_at || null,
            delivery_timeline: deliveryTimeline(shipment),
            ...(courier ? { tracking_number: null, ...courier } : {})
          };
        });
      } catch (_error) {
        extras.billingHistory = [];
      }
    }

    return {
      subscription: {
        ...mapLedgerToDashboardDetail(row, extras),
        plan_notice: await dashboardPlanNotice(row, this.settingsRepository)
      }
    };
  }
}

module.exports = {
  SubscriptionsDetailRepository
};
