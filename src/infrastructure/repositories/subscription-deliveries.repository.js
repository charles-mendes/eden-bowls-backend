const { HttpError } = require('../../core/http-error');
const {
  extractSubscriptionPeriod,
  mapStripeStatus,
  parseJsonColumn
} = require('../../core/stripe-subscription-map');
const { catalogFrom, packsPerMonth } = require('../../core/subscription-dashboard');
const { ledgerStripeAccount } = require('../../core/stripe-account');
const { resolveStripeBilling } = require('../stripe/stripe-accounts');
const {
  contractChargedCount,
  resolveAutoRenew,
  stripeChargedInvoiceCount
} = require('../../core/contract-deliveries');

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapDeliverySubscription(row, { cycle = null, paidDeliveries = 1 } = {}) {
  const plan = parseJsonColumn(row.planSelection) || {};
  const shipping = parseJsonColumn(row.shipping) || {};
  const address = parseJsonColumn(row.address) || {};
  const catalog = catalogFrom(row);
  const market = ledgerStripeAccount(row) === 'br' ? 'BR' : 'US';
  const termMonths = Number(row.subscriptionTermMonths || plan.subscription_term_months || 1) || 1;
  const autoRenew = resolveAutoRenew(row);
  const subtotal = numberOrNull(catalog.subtotal);

  return {
    id: row.stripeSubscriptionId,
    ledgerId: row.id,
    userId: row.userId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    status: row.status,
    market,
    zipcode: String(address.zipcode || address.postal_code || '').replace(/\D/g, ''),
    chargeAt: toDate(row.currentPeriodEnd),
    termMonths,
    autoRenew,
    chargedCount: contractChargedCount(paidDeliveries, termMonths, autoRenew),
    transitDays: market === 'US'
      ? numberOrNull(address.business_days_in_transit != null ? address.business_days_in_transit : shipping.delivery_days)
      : null,
    distanceKm: market === 'BR' ? numberOrNull(shipping.distance != null ? shipping.distance : address.distance_km) : null,
    productionStatus: cycle ? cycle.status : undefined,
    nextShipmentDate: plan.next_shipment_date || shipping.next_shipment_date || null,
    packsPerMonth: packsPerMonth(catalog, plan),
    subtotal
  };
}

class SubscriptionDeliveriesRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.productionRepository = options.productionRepository || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.shippingService = options.shippingService || null;
    this.logger = options.logger || { warn() {}, error() {} };
  }

  async findForUser(subscriptionId, userId) {
    if (!this.ledgerRepository) {
      throw new HttpError(503, 'Deliveries service is not available.');
    }
    const row = await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
    if (!row) return null;

    const chargeAt = toDate(row.currentPeriodEnd);
    const [cycle, paidDeliveries] = await Promise.all([
      chargeAt && this.productionRepository
        ? this.productionRepository.findBySubscriptionAndPeriodEnd(row.id, chargeAt)
        : null,
      row.chargedDeliveries != null ? row.chargedDeliveries : this.countPaidDeliveries(row)
    ]);
    return mapDeliverySubscription(row, { cycle, paidDeliveries });
  }

  // Fallback for a ledger row with no charged count yet. Adjustment invoices (subscription_update,
  // prorations) are not deliveries. Returns null when Stripe cannot be read.
  async countPaidDeliveries(row) {
    try {
      const billing = resolveStripeBilling(this, ledgerStripeAccount(row));
      if (!billing || typeof billing.listPaidInvoicesForSubscription !== 'function') {
        throw new Error('Stripe billing is not available for this subscription account.');
      }
      const invoices = await billing.listPaidInvoicesForSubscription(row.stripeSubscriptionId);
      return stripeChargedInvoiceCount(invoices);
    } catch (error) {
      this.logger.error({
        subscriptionId: row.stripeSubscriptionId,
        code: error && error.details && error.details.code,
        message: error && error.message
      }, 'Charged deliveries could not be counted; the deliveries read omits the contract end.');
      return null;
    }
  }

  // The webhook confirms later; the ledger moves now so the read that follows shows the new charge.
  async recordChargeMoved(subscription, stripeSubscription) {
    if (!this.ledgerRepository || !stripeSubscription) return;
    const period = extractSubscriptionPeriod(stripeSubscription);
    await this.ledgerRepository.upsert({
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      status: mapStripeStatus(stripeSubscription),
      currentPeriodStart: period.start || undefined,
      currentPeriodEnd: period.end || stripeSubscription.trial_end || undefined
    });
  }

  async quoteTransitDays(subscription) {
    if (!this.shippingService || !subscription.zipcode) return null;
    try {
      const quote = await this.shippingService.calculateUs({ zipCode: subscription.zipcode });
      return numberOrNull(quote && quote.data ? quote.data.delivery_days : null);
    } catch (error) {
      this.logger.warn({ subscriptionId: subscription.stripeSubscriptionId, code: error && error.details && error.details.code },
        'Transit days could not be quoted for the deliveries read.');
      return null;
    }
  }

  async storeTransitDays(subscription, transitDays) {
    if (transitDays == null || !this.ledgerRepository) return;
    const row = await this.ledgerRepository.findByUserIdAndSubscriptionId(subscription.userId, subscription.stripeSubscriptionId);
    if (!row) return;
    const address = parseJsonColumn(row.address) || {};
    await this.ledgerRepository.upsert({
      stripeSubscriptionId: row.stripeSubscriptionId,
      address: { ...address, business_days_in_transit: transitDays }
    });
  }
}

module.exports = {
  SubscriptionDeliveriesRepository,
  contractChargedCount,
  mapDeliverySubscription
};
