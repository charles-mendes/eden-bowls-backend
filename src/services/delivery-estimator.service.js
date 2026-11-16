const { mapDeliverySubscription } = require('../infrastructure/repositories/subscription-deliveries.repository');
const { projectOne } = require('./customer-deliveries.service');

// The one rule for a delivery date from a payment (or, before payment, from now): preparation is that moment's
// local day when it is a preparation day of the market's standard week and the moment comes before its closing
// time (before opening counts); otherwise the next preparation day (firstPrepDay). The delivery follows the
// market rule (Brazil the business days the operator picked, 0 = same day; United States next-day pickup plus
// transit). The production queue, the order confirmation email, and the checkout estimate all call this, so they
// never disagree.
class DeliveryEstimator {
  constructor(options = {}) {
    this.calendar = options.calendar || null;
  }

  async estimate({ market, at, transitDays }) {
    const moment = at instanceof Date ? at : new Date(at);
    if (!market || Number.isNaN(moment.getTime())) return null;
    const rows = await this.readCalendar();
    const projected = projectOne(market, moment, rows, Number(transitDays) || 0);
    return projected ? { preparationDay: projected.preparationDay, deliveryDate: projected.deliveryDate } : null;
  }

  // The closed days and the standard week together; a calendar without `snapshot` reads with the default week.
  async readCalendar() {
    if (this.calendar && typeof this.calendar.snapshot === 'function') return this.calendar.snapshot();
    if (this.calendar && typeof this.calendar.listActive === 'function') return this.calendar.listActive();
    return [];
  }

  async estimateForLedger({ ledgerRow, at }) {
    const delivery = mapDeliverySubscription(ledgerRow || {});
    return this.estimate({ market: delivery.market, at, transitDays: delivery.transitDays });
  }
}

module.exports = {
  DeliveryEstimator
};
