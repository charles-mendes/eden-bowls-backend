const { DateTime } = require('luxon');
const { parseStripeAccountInput } = require('../core/stripe-account');
const { presentProductionQueueItem } = require('../core/production-queue-presenter');
const { constrainMarketQuery, shouldEnforceMarketScope } = require('../core/admin-market-scope');
const { resolveTimezone } = require('./admin-production.service');
const { presentContact } = require('./customer-contacts.service');

// Overdue work older than this is a data problem, not today's work; the production page still lists it.
const OVERDUE_DAYS = 30;
const MAX_ITEMS = 200;
const NFE_ACTION_STATUSES = ['blocked_missing_document', 'rejected', 'error'];

function emptyCounts() {
  return { overdue: 0, today: 0, tomorrow: 0 };
}

// A purchase UPS never confirmed (pending or unknown) is not a missing label: buying again is refused.
function upsLabelState(status) {
  if (!status) return 'missing';
  return status === 'pending' || status === 'unknown' ? 'unresolved' : 'created';
}

// Brazil by the delivery address, as the courier queue decides.
function isPaidBrazilDelivery(item) {
  return item.paymentState === 'paid' && Boolean(item.paidInvoiceId) && String(item.country || '').toUpperCase() === 'BR';
}

function marketOf(item) {
  return item.stripeAccount === 'br' ? 'BR' : 'US';
}

// One read of what has to happen today: the production cycles due by tomorrow, the US labels still missing,
// and the closed days that change the plan.
// delivery-address-issues: a problem is stale for Today from the same 72 hours the panel uses.
const STALE_ISSUE_HOURS = 72;

function accountOf(market) {
  return market === 'BR' ? 'br' : 'us';
}

class AdminTodayService {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository;
    this.upsShipmentRepository = options.upsShipmentRepository || null;
    this.courierDeliveryService = options.courierDeliveryService || null;
    this.courierDeliveryRepository = options.courierDeliveryRepository || null;
    this.blingNfeRepository = options.blingNfeRepository || null;
    this.blingNfeService = options.blingNfeService || null;
    this.customerContactsRepository = options.customerContactsRepository || null;
    this.profileRepository = options.profileRepository || null;
    this.deliveryAddressIssuesRepository = options.deliveryAddressIssuesRepository || null;
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

    const [labeled, courierByInvoice, refused] = await Promise.all([
      this.labeledInvoices(items),
      this.courierStates(items),
      this.refusedPaymentContacts(items)
    ]);
    const byMarket = { BR: emptyCounts(), US: emptyCounts() };
    const totals = emptyCounts();
    const presented = items.map((item) => {
      const market = marketOf(item);
      byMarket[market][item.dueBucket] += 1;
      totals[item.dueBucket] += 1;
      const needsLabel = market === 'US' && item.paymentState === 'paid';
      const { paidInvoiceId, ...rest } = item;
      const presentedItem = {
        ...rest,
        market,
        upsLabel: needsLabel ? upsLabelState(labeled.get(paidInvoiceId)) : null,
        courierDelivery: isPaidBrazilDelivery(item) ? (courierByInvoice.get(paidInvoiceId) || 'none') : null
      };
      if (item.paymentState === 'past_due') {
        presentedItem.lastContact = refused.contacts.get(String(item.id)) || null;
        presentedItem.phone = refused.phones.get(String(item.userId)) || null;
      }
      return presentedItem;
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
        fulfillment: await this.fulfillment(actor, query, account),
        closedDays: await this.closedDays(today, stripeAccounts, account)
      }
    };
  }

  // Counted by their own queries, so the 200-item cut of the list never hides work. A market outside the actor's
  // scope, or not on screen, counts 0.
  async fulfillment(actor = {}, query = {}, account) {
    let markets = account ? [account === 'br' ? 'BR' : 'US'] : ['BR', 'US'];
    if (shouldEnforceMarketScope(actor)) {
      markets = markets.filter((market) => constrainMarketQuery(actor, {}).markets.includes(market));
    }
    const brazil = markets.includes('BR');
    const us = markets.includes('US');
    const courier = brazil && this.courierDeliveryService
      ? this.courierDeliveryService.countQueue(actor)
      : { toDispatch: 0, onTheRoadLong: 0, failed: 0 };
    const nfe = brazil && this.blingNfeRepository
      ? this.blingNfeRepository.countByStatuses(NFE_ACTION_STATUSES)
      : Object.fromEntries(NFE_ACTION_STATUSES.map((status) => [status, 0]));
    const ups = us && this.upsShipmentRepository && typeof this.upsShipmentRepository.countUnresolved === 'function'
      ? this.upsShipmentRepository.countUnresolved()
      : 0;
    const [courierCounts, nfeCounts, upsUnresolved, blingConnected, addressIssues, marketExceptions] = await Promise.all([
      courier, nfe, ups, this.blingState(actor), this.addressIssueCounts(markets), this.marketExceptionCounts(markets)
    ]);
    return {
      courierToDispatch: courierCounts.toDispatch,
      courierOnTheRoadLong: courierCounts.onTheRoadLong,
      courierFailed: courierCounts.failed,
      nfeMissingDocument: nfeCounts.blocked_missing_document,
      nfeRejected: nfeCounts.rejected,
      nfeError: nfeCounts.error,
      upsUnresolved,
      blingConnected,
      addressIssues,
      marketExceptions
    };
  }

  // Open address problems per market of the Stripe account, and the ones open for 72 hours or more: the point
  // from which the panel shows "Sem correção há N dias". A market not counted is 0.
  async addressIssueCounts(markets) {
    const counts = { BR: { open: 0, stale: 0 }, US: { open: 0, stale: 0 } };
    const repository = this.deliveryAddressIssuesRepository;
    if (!markets.length || !repository || typeof repository.countOpenByAccount !== 'function') return counts;
    const byAccount = await repository.countOpenByAccount({
      staleBefore: new Date(this.now().getTime() - STALE_ISSUE_HOURS * 3600 * 1000),
      stripeAccounts: markets.map(accountOf)
    });
    for (const market of markets) {
      const found = byAccount.get(accountOf(market));
      if (found) counts[market] = { open: found.open, stale: found.stale };
    }
    return counts;
  }

  // Subscriptions in market exception per market of the Stripe account, without the list's 200 cut.
  async marketExceptionCounts(markets) {
    const counts = { BR: 0, US: 0 };
    if (!markets.length || !this.ledgerRepository || typeof this.ledgerRepository.countMarketExceptions !== 'function') return counts;
    const byAccount = await this.ledgerRepository.countMarketExceptions({ stripeAccounts: markets.map(accountOf) });
    for (const market of markets) counts[market] = byAccount.get(accountOf(market)) || 0;
    return counts;
  }

  // Only who can connect Bling hears about it; null where Bling is not configured (no NF-e in that environment).
  async blingState(actor = {}) {
    const permissions = Array.isArray(actor.permissions) ? actor.permissions : [];
    if (!permissions.includes('bling.connect') || !this.blingNfeService) return null;
    try {
      const { data } = await this.blingNfeService.connectionStatus();
      return data && data.configured ? Boolean(data.connected) : null;
    } catch (_error) {
      return false;
    }
  }

  // The latest courier attempt of each paid Brazil invoice; a canceled one counts as none.
  async courierStates(items) {
    const invoiceIds = items.filter(isPaidBrazilDelivery).map((item) => item.paidInvoiceId);
    const states = new Map();
    if (!invoiceIds.length || !this.courierDeliveryRepository) return states;
    const rows = await this.courierDeliveryRepository.listByInvoiceIds(invoiceIds);
    const latest = new Map();
    for (const row of rows) {
      if (row.status === 'canceled') continue;
      const kept = latest.get(row.stripe_invoice_id);
      if (!kept || Number(row.id) > Number(kept.id)) latest.set(row.stripe_invoice_id, row);
    }
    for (const [invoiceId, row] of latest) states.set(invoiceId, row.status);
    return states;
  }

  // The last contact and the account phone of each refused payment, one query each.
  async refusedPaymentContacts(items) {
    const refused = items.filter((item) => item.paymentState === 'past_due');
    const empty = { contacts: new Map(), phones: new Map() };
    if (!refused.length) return empty;
    const [contacts, people] = await Promise.all([
      this.customerContactsRepository ? this.customerContactsRepository.latestBySubscriptions(refused.map((item) => item.id)) : new Map(),
      this.profileRepository && typeof this.profileRepository.listDeliveryContacts === 'function'
        ? this.profileRepository.listDeliveryContacts(refused.map((item) => item.userId).filter(Boolean))
        : new Map()
    ]);
    const lastContacts = new Map();
    for (const [subscriptionId, row] of contacts) lastContacts.set(String(subscriptionId), presentContact(row));
    const phones = new Map();
    for (const [userId, contact] of people) if (contact.phone) phones.set(String(userId), contact.phone);
    return { contacts: lastContacts, phones };
  }

  async labeledInvoices(items) {
    const invoiceIds = items
      .filter((item) => marketOf(item) === 'US' && item.paidInvoiceId)
      .map((item) => item.paidInvoiceId);
    if (!invoiceIds.length || !this.upsShipmentRepository) {
      return new Map();
    }
    // Every row not voided: one invoice holds at most one (uq_ups_shipments_active_invoice).
    const shipments = await this.upsShipmentRepository.listActiveByInvoiceIds(invoiceIds);
    return new Map(shipments.map((shipment) => [shipment.stripe_invoice_id, shipment.status]));
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
