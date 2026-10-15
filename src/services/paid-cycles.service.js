const { extractSubscriptionPeriod } = require('../core/stripe-subscription-map');
const { DeliveryEstimator } = require('./delivery-estimator.service');

function unixToDate(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number * 1000) : null;
}

// A cycle enters production only once its invoice is paid. The cycle is keyed by the charge it belongs to
// (the start of the period that invoice opened). Preparation is the first valid day whose local midnight is at
// or after the payment, so a payment that arrives late (past_due) moves preparation and the delivery date.
class PaidCyclesService {
  constructor(options = {}) {
    this.productionRepository = options.productionRepository || null;
    this.estimator = options.estimator || new DeliveryEstimator({ calendar: options.calendar || null });
    this.now = options.now || (() => new Date());
  }

  paidAtOf(invoice) {
    return unixToDate(invoice && invoice.status_transitions && invoice.status_transitions.paid_at) || this.now();
  }

  // The delivery this invoice pays for; the order confirmation email uses the same result.
  async estimateFor({ ledgerRow, invoice }) {
    const paidAt = this.paidAtOf(invoice);
    const estimate = await this.estimator.estimateForLedger({ ledgerRow, at: paidAt });
    return estimate ? { ...estimate, paidAt } : null;
  }

  async recordPaid({ ledgerRow, subscription, invoice, estimate = null }) {
    if (!this.productionRepository || !ledgerRow || !ledgerRow.id) return null;
    const line = invoice && invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data[0] : null;
    const periodStart = unixToDate(extractSubscriptionPeriod(subscription || {}).start)
      || unixToDate(line && line.period && line.period.start);
    if (!periodStart) return null;
    const projected = estimate || await this.estimateFor({ ledgerRow, invoice });
    return this.productionRepository.markPaid({
      subscriptionId: ledgerRow.id,
      periodEnd: periodStart,
      paidAt: projected && projected.paidAt ? projected.paidAt : this.paidAtOf(invoice),
      invoiceId: invoice && invoice.id,
      preparationDay: projected && projected.preparationDay,
      deliveryDate: projected && projected.deliveryDate
    });
  }
}

module.exports = {
  PaidCyclesService
};
