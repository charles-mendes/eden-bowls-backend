const { extractSubscriptionPeriod } = require('../core/stripe-subscription-map');
const { mapDeliverySubscription } = require('../infrastructure/repositories/subscription-deliveries.repository');
const { projectOne } = require('./customer-deliveries.service');

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
    this.calendar = options.calendar || null;
    this.now = options.now || (() => new Date());
  }

  async recordPaid({ ledgerRow, subscription, invoice }) {
    if (!this.productionRepository || !ledgerRow || !ledgerRow.id) return null;
    const line = invoice && invoice.lines && Array.isArray(invoice.lines.data) ? invoice.lines.data[0] : null;
    const periodStart = unixToDate(extractSubscriptionPeriod(subscription || {}).start)
      || unixToDate(line && line.period && line.period.start);
    if (!periodStart) return null;
    const paidAt = unixToDate(invoice && invoice.status_transitions && invoice.status_transitions.paid_at) || this.now();
    const delivery = mapDeliverySubscription(ledgerRow);
    const rows = this.calendar && typeof this.calendar.listActive === 'function' ? await this.calendar.listActive() : [];
    const projected = projectOne(delivery.market, paidAt, rows, Number(delivery.transitDays) || 0);
    return this.productionRepository.markPaid({
      subscriptionId: ledgerRow.id,
      periodEnd: periodStart,
      paidAt,
      invoiceId: invoice && invoice.id,
      preparationDay: projected && projected.preparationDay,
      deliveryDate: projected && projected.deliveryDate
    });
  }
}

module.exports = {
  PaidCyclesService
};
