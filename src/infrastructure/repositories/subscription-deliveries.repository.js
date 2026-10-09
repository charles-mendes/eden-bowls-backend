const { HttpError } = require('../../core/http-error');
const {
  extractSubscriptionPeriod,
  mapStripeStatus,
  parseJsonColumn
} = require('../../core/stripe-subscription-map');
const { catalogFrom, packsPerMonth } = require('../../core/subscription-dashboard');
const { ledgerStripeAccount } = require('../../core/stripe-account');
const { resolveStripeBilling } = require('../stripe/stripe-accounts');
const { dateKey, timeZoneFor, zonedParts } = require('../../core/delivery-closed-days');
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

function mapDeliverySubscription(row, { cycle = null, paidDeliveries = 1, paidCycle = null } = {}) {
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
    subtotal,
    pendingDeliveryChanges: pendingFor(row),
    // The paid delivery still on its way. While it exists, the next renewal is the following delivery.
    paidCycle: paidCycle && paidCycle.deliveryDate ? {
      status: paidCycle.status,
      preparationDay: paidCycle.preparationDay,
      deliveryDate: paidCycle.deliveryDate
    } : null,
    currentPaid: Boolean(paidCycle && paidCycle.deliveryDate)
  };
}

// A pending change belongs to the unpaid charge it was recorded against; once that charge moved, it is stale.
function pendingFor(row) {
  const pending = parseJsonColumn(row.pendingDeliveryChanges);
  const chargeAt = toDate(row.currentPeriodEnd);
  const after = pending ? toDate(pending.after_charge_at) : null;
  if (!pending || !chargeAt || !after || after.getTime() !== chargeAt.getTime()) return null;
  return pending;
}

class SubscriptionDeliveriesRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.productionRepository = options.productionRepository || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.shippingService = options.shippingService || null;
    this.logger = options.logger || { warn() {}, error() {} };
    this.now = options.now || (() => new Date());
  }

  async findForUser(subscriptionId, userId) {
    if (!this.ledgerRepository) {
      throw new HttpError(503, 'Deliveries service is not available.');
    }
    const row = await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
    if (!row) return null;

    const chargeAt = toDate(row.currentPeriodEnd);
    const market = ledgerStripeAccount(row) === 'br' ? 'BR' : 'US';
    const timeZone = timeZoneFor(market);
    const today = timeZone ? (() => {
      const parts = zonedParts(this.now(), timeZone);
      return dateKey(parts.year, parts.month, parts.day);
    })() : null;
    const [cycle, paidDeliveries, paidCycle] = await Promise.all([
      chargeAt && this.productionRepository
        ? this.productionRepository.findBySubscriptionAndPeriodEnd(row.id, chargeAt)
        : null,
      row.chargedDeliveries != null ? row.chargedDeliveries : this.countPaidDeliveries(row),
      today && this.productionRepository && typeof this.productionRepository.findOpenPaidCycle === 'function'
        ? this.productionRepository.findOpenPaidCycle(row.id, today)
        : null
    ]);
    return mapDeliverySubscription(row, { cycle, paidDeliveries, paidCycle });
  }

  // Every deliverable subscription of a market, shaped like findForUser. A row with no charged count stays
  // unknown (null) instead of asking Stripe, so only its next delivery is projected.
  async listForMarket(market) {
    if (!this.ledgerRepository || typeof this.ledgerRepository.listDeliverableByAccount !== 'function') {
      throw new HttpError(503, 'Deliveries service is not available.');
    }
    const timeZone = timeZoneFor(market);
    const parts = zonedParts(this.now(), timeZone);
    const today = dateKey(parts.year, parts.month, parts.day);
    const rows = await this.ledgerRepository.listDeliverableByAccount(market === 'BR' ? 'br' : 'us');
    const subscriptions = [];
    for (const row of rows) {
      const chargeAt = toDate(row.currentPeriodEnd);
      const [cycle, paidCycle] = await Promise.all([
        chargeAt && this.productionRepository
          ? this.productionRepository.findBySubscriptionAndPeriodEnd(row.id, chargeAt)
          : null,
        this.productionRepository && typeof this.productionRepository.findOpenPaidCycle === 'function'
          ? this.productionRepository.findOpenPaidCycle(row.id, today)
          : null
      ]);
      subscriptions.push(mapDeliverySubscription(row, {
        cycle,
        paidDeliveries: row.chargedDeliveries,
        paidCycle
      }));
    }
    return subscriptions;
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

  async recordPendingChanges(subscription, changes) {
    if (!this.ledgerRepository || typeof this.ledgerRepository.setPendingDeliveryChanges !== 'function') {
      throw new HttpError(503, 'Deliveries service is not available.');
    }
    await this.ledgerRepository.setPendingDeliveryChanges(subscription.stripeSubscriptionId, changes);
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
