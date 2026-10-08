const { DateTime } = require('luxon');
const { parseStripeAccountInput } = require('../core/stripe-account');
const { presentProductionQueueItem } = require('../core/production-queue-presenter');
const { constrainMarketQuery, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const { resolveTimezone } = require('./admin-production.service');

// Overdue work older than this is a data problem, not today's work; the production page still lists it.
const OVERDUE_DAYS = 30;
const MAX_ITEMS = 200;

function emptyCounts() {
  return { overdue: 0, today: 0, tomorrow: 0 };
}

function marketOf(item) {
  return item.stripeAccount === 'br' ? 'BR' : 'US';
}

// One read of what has to happen today: the production cycles due by tomorrow, the US labels still missing,
// and the closed days that change the plan.
class AdminTodayService {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository;
    this.upsShipmentRepository = options.upsShipmentRepository || null;
    this.calendar = options.calendar || null;
    this.now = options.now || (() => new Date());
  }

  async overview(query = {}, actor = {}) {
    const timezone = resolveTimezone(query.timezone);
    const now = this.now();
    const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
    const toSql = (value) => value.toUTC().toFormat('yyyy-MM-dd HH:mm:ss');

    let account = query.account ? parseStripeAccountInput(query.account) : undefined;
    let stripeAccounts;
    if (shouldEnforceMarketScope(actor)) {
      const scoped = constrainMarketQuery(actor, query);
      stripeAccounts = scoped.stripeAccounts;
      account = scoped.stripeAccount || account;
    }

    const result = await this.ledgerRepository.listQueue({
      startOfToday: toSql(today),
      windowEndExclusive: toSql(today.plus({ days: 2 })),
      overdueFloor: toSql(today.minus({ days: OVERDUE_DAYS })),
      includeOverdue: true,
      account,
      stripeAccounts,
      offset: 0,
      perPage: MAX_ITEMS
    });

    const items = result.items
      .map((row) => ({ ...presentProductionQueueItem(row, { timezone, now, actor }), paidInvoiceId: row.paidInvoiceId || null }))
      .filter((item) => ['overdue', 'today', 'tomorrow'].includes(item.dueBucket));

    const labeled = await this.labeledInvoices(items);
    const byMarket = { BR: emptyCounts(), US: emptyCounts() };
    const totals = emptyCounts();
    const presented = items.map((item) => {
      const market = marketOf(item);
      byMarket[market][item.dueBucket] += 1;
      totals[item.dueBucket] += 1;
      const needsLabel = market === 'US' && item.paymentState === 'paid';
      const { paidInvoiceId, ...rest } = item;
      return {
        ...rest,
        market,
        upsLabel: needsLabel ? (labeled.has(paidInvoiceId) ? 'created' : 'missing') : null
      };
    });

    return {
      success: true,
      data: {
        generatedAt: now.toISOString(),
        timezone,
        today: today.toISODate(),
        totals,
        byMarket,
        truncated: result.total > MAX_ITEMS,
        total: result.total,
        items: presented,
        closedDays: await this.closedDays(today, stripeAccounts, account)
      }
    };
  }

  async labeledInvoices(items) {
    const invoiceIds = items
      .filter((item) => marketOf(item) === 'US' && item.paidInvoiceId)
      .map((item) => item.paidInvoiceId);
    if (!invoiceIds.length || !this.upsShipmentRepository) {
      return new Set();
    }
    const shipments = await this.upsShipmentRepository.listByInvoiceIds(invoiceIds);
    return new Set(shipments.map((shipment) => shipment.stripe_invoice_id));
  }

  async closedDays(today, stripeAccounts, account) {
    if (!this.calendar) {
      return [];
    }
    const markets = new Set(
      (account ? [account] : (stripeAccounts && stripeAccounts.length ? stripeAccounts : ['br', 'us']))
        .map((value) => (String(value).toLowerCase() === 'br' ? 'BR' : 'US'))
    );
    const days = [today.toISODate(), today.plus({ days: 1 }).toISODate()];
    const rows = await this.calendar.listActive();
    return rows
      .filter((row) => markets.has(row.market) && days.includes(row.closedOn))
      .map((row) => ({
        market: row.market,
        date: row.closedOn,
        label: row.label,
        closesPreparation: row.closesPreparation,
        closesPickup: row.closesPickup,
        closesDelivery: row.closesDelivery
      }));
  }
}

module.exports = {
  AdminTodayService
};
