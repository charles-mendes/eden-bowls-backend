const { mapDeliverySubscription } = require('../infrastructure/repositories/subscription-deliveries.repository');
const { projectOne } = require('./customer-deliveries.service');

// The one rule for a delivery date from a payment (or, before payment, from now): preparation is the first
// valid day of the market whose local midnight is at or after that moment, and the delivery follows the
// market rule (Brazil the same day; United States next-day pickup plus transit). The production queue, the
// order confirmation email, and the checkout estimate all call this, so they never disagree.
class DeliveryEstimator {
  constructor(options = {}) {
    this.calendar = options.calendar || null;
  }

  async estimate({ market, at, transitDays }) {
    const moment = at instanceof Date ? at : new Date(at);
    if (!market || Number.isNaN(moment.getTime())) return null;
    const rows = this.calendar && typeof this.calendar.listActive === 'function' ? await this.calendar.listActive() : [];
    const projected = projectOne(market, moment, rows, Number(transitDays) || 0);
    return projected ? { preparationDay: projected.preparationDay, deliveryDate: projected.deliveryDate } : null;
  }

  async estimateForLedger({ ledgerRow, at }) {
    const delivery = mapDeliverySubscription(ledgerRow || {});
    return this.estimate({ market: delivery.market, at, transitDays: delivery.transitDays });
  }
}

module.exports = {
  DeliveryEstimator
};
